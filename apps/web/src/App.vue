<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { publicConfig } from './config'
import { createContinuationTurn, createOpeningTurn } from './mocks/story'
import { mockContinueStory, mockGenerateStory, mockTaskStatus } from './services/mockStoryService'
import type {
  ActivityItem,
  ChatMessage,
  PersistedWorkspace,
  StoryChoice,
  VideoStatus,
} from './types'

const STORAGE_KEY = 'scenefork.phase-a.workspace.v1'
const ACTIVE_VIDEO_STATES: VideoStatus[] = ['submitting', 'queued', 'running', 'saving']

const nowTime = () =>
  new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())

const id = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

function emptyWorkspace(): PersistedWorkspace {
  return {
    phase: 'empty',
    idea: '',
    activeTurnId: null,
    turns: [],
    messages: [
      {
        id: id(),
        sender: 'assistant',
        body: '把一个故事念头交给我。我们会先生成当前片段，再一起选择故事的下一步。',
        time: nowTime(),
      },
    ],
    videoTask: {
      taskId: null,
      status: 'idle',
      startedAt: null,
      updatedAt: null,
      outcome: 'success',
      error: null,
    },
    activity: [
      {
        id: id(),
        label: 'Mock 工作区已就绪',
        detail: '尚未连接真实模型 API',
        time: nowTime(),
        tone: 'neutral',
      },
    ],
    selectedChoiceId: null,
  }
}

function loadWorkspace(): PersistedWorkspace {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return emptyWorkspace()
    const parsed = JSON.parse(stored) as PersistedWorkspace
    if (!parsed || !Array.isArray(parsed.turns) || !parsed.videoTask) return emptyWorkspace()
    return parsed
  } catch {
    return emptyWorkspace()
  }
}

const state = reactive<PersistedWorkspace>(loadWorkspace())
const draft = ref('')
const activeTab = ref<'conversation' | 'activity'>('conversation')
const settingsOpen = ref(false)
const promptEditorOpen = ref(false)
const nextOutcome = ref<'success' | 'failure' | 'unknown'>('success')
const inputError = ref('')
const isPlaying = ref(false)
const playhead = ref(0)
const nowTick = ref(Date.now())
const restoredNotice = ref(false)
const storyScroll = ref<HTMLElement | null>(null)

const activeTurn = computed(() =>
  state.turns.find((turn) => turn.id === state.activeTurnId) ?? state.turns.at(-1) ?? null,
)
const isVideoBusy = computed(() => ACTIVE_VIDEO_STATES.includes(state.videoTask.status))
const choicesEnabled = computed(() => state.videoTask.status === 'succeeded')
const canSend = computed(() => draft.value.trim().length >= 3 && state.phase !== 'story-generating')
const elapsedSeconds = computed(() => {
  if (!state.videoTask.startedAt) return 0
  return Math.max(0, Math.floor((nowTick.value - state.videoTask.startedAt) / 1000))
})
const videoStatusLabel = computed(() => {
  const labels: Record<VideoStatus, string> = {
    idle: '等待生成',
    submitting: '正在提交任务',
    queued: '已进入渲染队列',
    running: '正在生成视频',
    saving: '正在保存结果',
    succeeded: 'Mock 视频已就绪',
    failed: '生成失败',
    submission_unknown: '提交结果待确认',
  }
  return labels[state.videoTask.status]
})
const primaryInputPlaceholder = computed(() => {
  if (state.phase === 'empty') return '输入你的故事创意…'
  if (!choicesEnabled.value) return '视频完成后可以续写故事…'
  return '或者自由描述故事的下一步…'
})
const formattedPlayhead = computed(() => `0:${String(playhead.value).padStart(2, '0')}`)

let taskTimer: number | undefined
let playbackTimer: number | undefined
let noticeTimer: number | undefined

watch(
  state,
  (value) => window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)),
  { deep: true },
)

watch(
  () => state.videoTask.status,
  (status) => {
    if (status !== 'succeeded') {
      isPlaying.value = false
      playhead.value = 0
    }
  },
)

function pushMessage(sender: ChatMessage['sender'], body: string) {
  state.messages.push({ id: id(), sender, body, time: nowTime() })
  window.setTimeout(() => {
    storyScroll.value?.scrollTo({ top: storyScroll.value.scrollHeight, behavior: 'smooth' })
  })
}

function pushActivity(
  label: string,
  detail: string,
  tone: ActivityItem['tone'] = 'neutral',
) {
  state.activity.unshift({ id: id(), label, detail, time: nowTime(), tone })
  state.activity = state.activity.slice(0, 16)
}

async function submitDraft() {
  inputError.value = ''
  const value = draft.value.trim()
  if (value.length < 3) {
    inputError.value = '请至少输入 3 个字，让故事有一个清晰的起点。'
    return
  }

  if (state.phase === 'empty') {
    await startStory(value)
    return
  }

  if (!choicesEnabled.value) {
    inputError.value = '请先完成当前片段的 Mock 视频，再决定下一步。'
    return
  }

  await continueStory(value, null)
}

async function startStory(idea: string) {
  draft.value = ''
  state.idea = idea
  state.phase = 'story-generating'
  pushMessage('user', idea)
  pushActivity('正在生成故事片段', 'Mock Qwen 响应将在本地返回', 'active')

  await mockGenerateStory()
  const turn = createOpeningTurn(idea)
  state.turns = [turn]
  state.activeTurnId = turn.id
  state.phase = 'story-ready'
  pushMessage('assistant', `第一幕已经展开：${turn.summary}`)
  pushActivity('故事片段已生成', '4 个后续方向已准备好', 'success')
}

async function chooseDirection(choice: StoryChoice) {
  if (!choicesEnabled.value || state.phase === 'story-generating') return
  state.selectedChoiceId = choice.id
  await continueStory(choice.direction, choice.id, choice.label)
}

async function continueStory(direction: string, choiceId: string | null, label?: string) {
  state.phase = 'story-generating'
  draft.value = ''
  pushMessage('user', label ?? direction)
  pushActivity(
    '续写方向已确认',
    choiceId ? `固定选项 · ${label}` : '自定义剧情方向',
    'active',
  )

  await mockContinueStory()
  const turn = createContinuationTurn(direction, state.turns.length)
  state.turns.push(turn)
  state.activeTurnId = turn.id
  state.phase = 'story-ready'
  state.selectedChoiceId = null
  state.videoTask = {
    taskId: null,
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    outcome: 'success',
    error: null,
  }
  pushMessage('assistant', `${turn.title}：${turn.summary}`)
  pushActivity('下一片段已生成', '视频提示词可以在生成前编辑', 'success')
}

function startVideoGeneration() {
  if (!activeTurn.value || isVideoBusy.value || state.videoTask.status === 'succeeded') return
  const startedAt = Date.now()
  const outcome = nextOutcome.value
  nextOutcome.value = 'success'
  state.videoTask = {
    taskId: null,
    status: 'submitting',
    startedAt,
    updatedAt: startedAt,
    outcome,
    error: null,
  }
  promptEditorOpen.value = false
  pushActivity('视频任务提交中', 'Mock Wan · 1280×720 · 5 秒', 'active')
  updateVideoTask()
}

function updateVideoTask() {
  const task = state.videoTask
  if (!task.startedAt || !ACTIVE_VIDEO_STATES.includes(task.status)) return
  const previous = task.status
  const result = mockTaskStatus(task.startedAt, task.outcome)
  task.status = result.status
  task.taskId = result.taskId
  task.error = result.error
  task.updatedAt = Date.now()

  if (previous === result.status) return

  const activityByStatus: Partial<
    Record<VideoStatus, { label: string; detail: string; tone: ActivityItem['tone'] }>
  > = {
    queued: { label: '视频任务已入队', detail: result.taskId ?? 'Mock task', tone: 'active' },
    running: { label: '正在生成视频', detail: '供应商未提供真实百分比', tone: 'active' },
    saving: { label: '正在保存视频', detail: '模拟持久化到本地媒体目录', tone: 'active' },
    succeeded: { label: '视频已保存', detail: 'Mock 播放器现在可以预览', tone: 'success' },
    failed: { label: '视频生成失败', detail: result.error ?? '未知错误', tone: 'danger' },
    submission_unknown: {
      label: '提交结果待确认',
      detail: '已停止自动重试，避免重复计费',
      tone: 'danger',
    },
  }
  const activity = activityByStatus[result.status]
  if (activity) pushActivity(activity.label, activity.detail, activity.tone)
  if (result.status === 'succeeded') pushMessage('assistant', '当前片段已完成。选择一个方向，或者写下你自己的下一步。')
}

function retryVideo() {
  if (state.videoTask.status !== 'failed') return
  startVideoGeneration()
}

function confirmUnknownRetry() {
  if (state.videoTask.status !== 'submission_unknown') return
  state.videoTask = {
    taskId: null,
    status: 'idle',
    startedAt: null,
    updatedAt: Date.now(),
    outcome: 'success',
    error: null,
  }
  pushActivity('未知任务已人工确认', '现在可以再次明确提交', 'neutral')
}

function togglePlayback() {
  if (state.videoTask.status !== 'succeeded') return
  isPlaying.value = !isPlaying.value
}

function resetWorkspace() {
  const fresh = emptyWorkspace()
  Object.assign(state, fresh)
  draft.value = ''
  inputError.value = ''
  activeTab.value = 'conversation'
  settingsOpen.value = false
  isPlaying.value = false
  playhead.value = 0
  window.localStorage.removeItem(STORAGE_KEY)
}

function selectTurn(turnId: string) {
  if (state.phase === 'story-generating') return
  const turn = state.turns.find((item) => item.id === turnId)
  if (!turn) return
  state.activeTurnId = turnId
}

onMounted(() => {
  if (isVideoBusy.value) {
    restoredNotice.value = true
    pushActivity('已恢复进行中的任务', state.videoTask.taskId ?? '等待供应商任务 ID', 'active')
    noticeTimer = window.setTimeout(() => (restoredNotice.value = false), 4200)
  }
  taskTimer = window.setInterval(() => {
    nowTick.value = Date.now()
    updateVideoTask()
  }, publicConfig.mockVideoPollMs)
  playbackTimer = window.setInterval(() => {
    if (!isPlaying.value || state.videoTask.status !== 'succeeded') return
    const duration = activeTurn.value?.duration ?? 8
    if (playhead.value >= duration) {
      playhead.value = 0
      isPlaying.value = false
      return
    }
    playhead.value += 1
  }, 1000)
})

onBeforeUnmount(() => {
  if (taskTimer) window.clearInterval(taskTimer)
  if (playbackTimer) window.clearInterval(playbackTimer)
  if (noticeTimer) window.clearTimeout(noticeTimer)
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" aria-label="SceneFork 首页" @click="resetWorkspace">
        <span>Scene</span><strong>Fork</strong>
        <span class="phase-pill">MOCK</span>
      </button>
      <button class="icon-button settings-button" aria-label="打开演示设置" @click="settingsOpen = true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8.75A3.25 3.25 0 1 0 12 15.25 3.25 3.25 0 0 0 12 8.75Z" />
          <path d="M19.2 13.1c.05-.36.08-.72.08-1.1s-.03-.74-.08-1.1l2-1.56-1.9-3.28-2.46.99a8.3 8.3 0 0 0-1.9-1.1L14.57 3h-3.8l-.38 2.95a8.3 8.3 0 0 0-1.9 1.1l-2.46-.99-1.9 3.28 2 1.56A7.5 7.5 0 0 0 6.05 12c0 .38.03.74.08 1.1l-2 1.56 1.9 3.28 2.46-.99c.58.46 1.22.83 1.9 1.1l.38 2.95h3.8l.38-2.95a8.3 8.3 0 0 0 1.9-1.1l2.46.99 1.9-3.28-2.01-1.56Z" />
        </svg>
      </button>
      <div class="header-spacer"></div>
      <div class="connection-badge"><span></span> 本地演示 · 未连接 API</div>
    </header>

    <main class="workspace">
      <section class="canvas-panel">
        <div class="video-stage" :class="[`status-${state.videoTask.status}`, { playing: isPlaying }]">
          <div class="scene-backdrop" :class="`variant-${activeTurn?.imageVariant ?? 0}`"></div>
          <div class="stage-shade"></div>

          <div class="stage-badges">
            <span class="mock-badge">MOCK PREVIEW</span>
            <span v-if="activeTurn" class="scene-name">{{ activeTurn.title }}</span>
          </div>

          <transition name="notice">
            <div v-if="restoredNotice" class="restore-notice">
              <span class="spinner small"></span>
              已从本地恢复同一个视频任务
            </div>
          </transition>

          <div v-if="state.phase === 'empty'" class="stage-center empty-state">
            <span class="spark-icon">
              <svg viewBox="0 0 24 24"><path d="m12 2 1.35 5.15L18.5 8.5l-5.15 1.35L12 15l-1.35-5.15L5.5 8.5l5.15-1.35L12 2Zm6 11 .72 2.78L21.5 16.5l-2.78.72L18 20l-.72-2.78-2.78-.72 2.78-.72L18 13Z" /></svg>
            </span>
            <p class="eyebrow">从一句话开始</p>
            <h1>让你的故事，拥有下一种可能</h1>
            <p>在右侧写下一个念头，SceneFork 会为你展开第一幕。</p>
          </div>

          <div v-else-if="state.phase === 'story-generating'" class="stage-center generation-state">
            <span class="spinner large"></span>
            <p class="eyebrow">MOCK STORY ENGINE</p>
            <h2>{{ activeTurn ? '正在续写下一幕' : '正在构建故事世界' }}</h2>
            <p>整理角色、场景与四个不同的剧情方向…</p>
          </div>

          <div v-else-if="state.videoTask.status === 'idle'" class="stage-center ready-state">
            <p class="eyebrow">故事片段已就绪</p>
            <h2>{{ activeTurn?.title }}</h2>
            <p>{{ activeTurn?.summary }}</p>
            <button class="primary-button generate-button" @click="startVideoGeneration">
              <svg viewBox="0 0 24 24"><path d="m10 8 6 4-6 4V8Z" /><path d="M4.75 5.75A2.75 2.75 0 0 1 7.5 3h9A2.75 2.75 0 0 1 19.25 5.75v12.5A2.75 2.75 0 0 1 16.5 21h-9a2.75 2.75 0 0 1-2.75-2.75V5.75Z" /></svg>
              生成 Mock 视频
            </button>
            <button class="text-button" @click="promptEditorOpen = true">先编辑视频提示词</button>
          </div>

          <div v-else-if="isVideoBusy" class="stage-center task-state">
            <span class="spinner large"></span>
            <p class="eyebrow">{{ state.videoTask.status === 'saving' ? 'LOCAL MEDIA' : 'MOCK WAN 2.6' }}</p>
            <h2>{{ videoStatusLabel }}</h2>
            <p>已等待 {{ elapsedSeconds }} 秒 · 不展示虚构百分比</p>
            <span v-if="state.videoTask.taskId" class="task-id">{{ state.videoTask.taskId }}</span>
          </div>

          <div v-else-if="state.videoTask.status === 'failed'" class="stage-center error-state">
            <span class="error-icon">!</span>
            <p class="eyebrow">MOCK FAILURE</p>
            <h2>这次没有生成成功</h2>
            <p>{{ state.videoTask.error }}</p>
            <button class="primary-button" @click="retryVideo">手动重试</button>
          </div>

          <div v-else-if="state.videoTask.status === 'submission_unknown'" class="stage-center error-state unknown-state">
            <span class="error-icon">?</span>
            <p class="eyebrow">需要人工确认</p>
            <h2>任务是否提交成功尚不确定</h2>
            <p>{{ state.videoTask.error }}</p>
            <button class="secondary-button" @click="confirmUnknownRetry">我已核实，允许重新提交</button>
          </div>

          <button
            v-else-if="state.videoTask.status === 'succeeded'"
            class="center-play"
            :aria-label="isPlaying ? '暂停' : '播放'"
            @click="togglePlayback"
          >
            <svg v-if="!isPlaying" viewBox="0 0 24 24"><path d="m9 6 9 6-9 6V6Z" /></svg>
            <svg v-else viewBox="0 0 24 24"><path d="M7 6h4v12H7V6Zm6 0h4v12h-4V6Z" /></svg>
          </button>

          <div v-if="state.videoTask.status === 'succeeded'" class="player-controls">
            <button class="player-button" :aria-label="isPlaying ? '暂停' : '播放'" @click="togglePlayback">
              <svg v-if="!isPlaying" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z" /></svg>
              <svg v-else viewBox="0 0 24 24"><path d="M6 5h4v14H6V5Zm8 0h4v14h-4V5Z" /></svg>
            </button>
            <span class="timecode">{{ formattedPlayhead }} / 0:{{ String(activeTurn?.duration ?? 8).padStart(2, '0') }}</span>
            <div class="scrubber"><span :style="{ width: `${(playhead / (activeTurn?.duration ?? 8)) * 100}%` }"></span></div>
            <button class="player-button" aria-label="音量">
              <svg viewBox="0 0 24 24"><path d="M5 10v4h3l4 3V7l-4 3H5Zm10-1.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12" /></svg>
            </button>
            <button class="player-button" aria-label="全屏">
              <svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></svg>
            </button>
            <button class="export-button" disabled title="阶段 A 尚未实现真实视频合并与导出">
              <svg viewBox="0 0 24 24"><path d="M12 16V3m0 0L8 7m4-4 4 4M5 13v6h14v-6" /></svg>
              导出
            </button>
          </div>
        </div>

        <div class="timeline" aria-label="故事片段与后续方向">
          <div class="timeline-header">
            <div>
              <span class="section-kicker">STORY PATH</span>
              <strong>{{ state.turns.length ? `${state.turns.length} 个已生成片段` : '等待故事开始' }}</strong>
            </div>
            <span v-if="activeTurn" class="timeline-hint">
              {{ choicesEnabled ? '选择一个方向继续' : '后续方向将在视频完成后解锁' }}
            </span>
          </div>
          <div class="timeline-track">
            <button
              v-for="(turn, index) in state.turns"
              :key="turn.id"
              class="turn-card"
              :class="{ active: turn.id === state.activeTurnId }"
              @click="selectTurn(turn.id)"
            >
              <span class="thumb" :class="`variant-${turn.imageVariant}`">
                <span class="number-badge">{{ index + 1 }}</span>
                <span class="duration-badge">0:{{ String(turn.duration).padStart(2, '0') }}</span>
              </span>
              <span class="card-title">{{ turn.title }}</span>
              <span class="card-meta">Mock 片段</span>
            </button>

            <template v-if="activeTurn">
              <button
                v-for="(choice, index) in activeTurn.choices"
                :key="choice.id"
                class="turn-card choice-card"
                :disabled="!choicesEnabled || state.phase === 'story-generating'"
                @click="chooseDirection(choice)"
              >
                <span class="thumb choice-thumb" :class="`choice-${index + 1}`">
                  <span class="number-badge">{{ state.turns.length + index + 1 }}</span>
                  <span class="direction-badge">方向 {{ index + 1 }}</span>
                  <span v-if="!choicesEnabled" class="locked-badge">
                    <svg viewBox="0 0 24 24"><path d="M7 11V8a5 5 0 0 1 10 0v3m-11 0h12v10H6V11Z" /></svg>
                  </span>
                </span>
                <span class="card-title">{{ choice.label }}</span>
                <span class="card-meta">尚未生成视频</span>
              </button>
            </template>

            <div v-if="!state.turns.length" v-for="index in 4" :key="index" class="empty-turn-card">
              <span>{{ index }}</span>
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            </div>
          </div>
        </div>
      </section>

      <aside class="story-panel">
        <div class="tabs" role="tablist">
          <button :class="{ active: activeTab === 'conversation' }" role="tab" @click="activeTab = 'conversation'">创作</button>
          <button :class="{ active: activeTab === 'activity' }" role="tab" @click="activeTab = 'activity'">状态</button>
        </div>

        <div v-if="activeTab === 'conversation'" ref="storyScroll" class="panel-scroll conversation-scroll">
          <article
            v-for="message in state.messages"
            :key="message.id"
            class="message"
            :class="`message-${message.sender}`"
          >
            <span class="avatar" :class="message.sender">
              <svg v-if="message.sender === 'assistant'" viewBox="0 0 24 24"><path d="m12 2 1.2 4.8L18 8l-4.8 1.2L12 14l-1.2-4.8L6 8l4.8-1.2L12 2Zm6 11 .65 2.35L21 16l-2.35.65L18 19l-.65-2.35L15 16l2.35-.65L18 13Z" /></svg>
              <svg v-else viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Z" /></svg>
            </span>
            <div class="message-copy">
              <div class="message-meta"><strong>{{ message.sender === 'assistant' ? 'SceneFork' : '你' }}</strong><time>{{ message.time }}</time></div>
              <p>{{ message.body }}</p>
            </div>
          </article>

          <section v-if="activeTurn && state.phase !== 'story-generating'" class="story-card">
            <div class="story-card-head">
              <span>当前片段</span><strong>{{ activeTurn.title }}</strong>
            </div>
            <p>{{ activeTurn.storyText }}</p>
            <button class="prompt-toggle" @click="promptEditorOpen = !promptEditorOpen">
              <span>视频提示词</span>
              <svg viewBox="0 0 24 24" :class="{ rotated: promptEditorOpen }"><path d="m8 10 4 4 4-4" /></svg>
            </button>
            <div v-if="promptEditorOpen" class="prompt-editor">
              <textarea v-model="activeTurn.videoPrompt" :disabled="state.videoTask.status !== 'idle'" rows="5"></textarea>
              <small>仅当前片段使用；四个未选分支不会混入提示词。</small>
            </div>
          </section>

          <section v-if="activeTurn && choicesEnabled" class="choice-panel">
            <div class="choice-heading">
              <div><span>选择下一步</span><strong>故事会走向哪里？</strong></div>
              <span>4 个方向</span>
            </div>
            <button
              v-for="(choice, index) in activeTurn.choices"
              :key="choice.id"
              class="choice-row"
              @click="chooseDirection(choice)"
            >
              <span class="choice-index">0{{ index + 1 }}</span>
              <span><strong>{{ choice.label }}</strong><small>{{ choice.direction }}</small></span>
              <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
            </button>
          </section>
        </div>

        <div v-else class="panel-scroll activity-scroll">
          <div class="activity-summary">
            <span class="status-orb" :class="{ pulsing: isVideoBusy }"></span>
            <div><strong>{{ videoStatusLabel }}</strong><small>所有状态均为本地 Mock 演示</small></div>
          </div>
          <div class="activity-list">
            <article v-for="item in state.activity" :key="item.id" class="activity-item" :class="`tone-${item.tone}`">
              <span class="activity-dot"></span>
              <div><strong>{{ item.label }}</strong><p>{{ item.detail }}</p></div>
              <time>{{ item.time }}</time>
            </article>
          </div>
        </div>

        <form class="composer" @submit.prevent="submitDraft">
          <div v-if="inputError" class="input-error">{{ inputError }}</div>
          <textarea
            v-model="draft"
            :placeholder="primaryInputPlaceholder"
            :disabled="state.phase === 'story-generating' || (state.phase !== 'empty' && !choicesEnabled)"
            rows="3"
            @input="inputError = ''"
            @keydown.ctrl.enter.prevent="submitDraft"
          ></textarea>
          <div class="composer-actions">
            <div class="composer-tools">
              <button type="button" class="tool-button" disabled title="阶段 A 暂不支持上传参考图" aria-label="上传参考图（未实现）">
                <svg viewBox="0 0 24 24"><path d="M4 5h16v14H4V5Zm0 11 5-5 4 4 2-2 5 5M15.5 9A1.5 1.5 0 1 0 15.5 6a1.5 1.5 0 0 0 0 3Z" /></svg>
              </button>
              <button type="button" class="tool-button" @click="settingsOpen = true" aria-label="Mock 设置">
                <svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2m4 0h10M4 12h4m4 0h8M14 5v4M8 15v4m2-9v4" /></svg>
              </button>
              <span class="shortcut">Ctrl + Enter</span>
            </div>
            <button type="submit" class="send-button" :disabled="!canSend" aria-label="发送">
              <svg viewBox="0 0 24 24"><path d="m3 11 18-8-8 18-2-8-8-2Zm8 2 5-5" /></svg>
            </button>
          </div>
        </form>
      </aside>
    </main>

    <transition name="modal">
      <div v-if="settingsOpen" class="modal-backdrop" @mousedown.self="settingsOpen = false">
        <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div class="modal-header">
            <div><span class="section-kicker">PHASE A</span><h2 id="settings-title">Mock 演示设置</h2></div>
            <button class="icon-button" aria-label="关闭" @click="settingsOpen = false">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <p class="modal-intro">选择下一次视频任务的演示结果。这里不会发起网络请求，也不会产生模型费用。</p>
          <fieldset>
            <legend>下一次视频生成</legend>
            <label :class="{ selected: nextOutcome === 'success' }">
              <input v-model="nextOutcome" value="success" type="radio" />
              <span><strong>成功</strong><small>依次演示提交、排队、生成、保存与播放</small></span>
            </label>
            <label :class="{ selected: nextOutcome === 'failure' }">
              <input v-model="nextOutcome" value="failure" type="radio" />
              <span><strong>失败</strong><small>演示明确失败后的手动重试</small></span>
            </label>
            <label :class="{ selected: nextOutcome === 'unknown' }">
              <input v-model="nextOutcome" value="unknown" type="radio" />
              <span><strong>结果未知</strong><small>演示禁止自动重试与人工确认</small></span>
            </label>
          </fieldset>
          <div class="modal-note"><strong>刷新恢复</strong><span>生成期间直接刷新页面，即可验证恢复同一 Mock 任务。</span></div>
          <div class="modal-footer">
            <button class="danger-text-button" @click="resetWorkspace">清空本地演示</button>
            <button class="primary-button" @click="settingsOpen = false">完成</button>
          </div>
        </section>
      </div>
    </transition>
  </div>
</template>
