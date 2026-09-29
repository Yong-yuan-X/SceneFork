<script setup lang="ts">
import type { StoryResponse, VideoTaskResponse } from '@scenefork/shared'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { publicConfig } from './config'
import {
  createContinuationTurn,
  createIdleVideoTask,
  createOpeningTurn,
} from './mocks/story'
import { apiClient, ApiError } from './services/apiClient'
import {
  isElementFullscreen,
  readMediaVolume,
  setMediaVolume,
  toggleElementFullscreen,
  toggleMediaMute,
} from './services/mediaControls'
import { mockContinueStory, mockGenerateStory, mockTaskStatus } from './services/mockStoryService'
import type {
  ActivityItem,
  ChatMessage,
  PersistedWorkspace,
  StoryChoice,
  StoryTurn,
  VideoStatus,
  VideoTask,
} from './types'

const STORAGE_KEY = 'scenefork.workspace.v2'
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
    storyId: null,
    currentTurnId: null,
    providerMode: 'local',
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
    activity: [
      {
        id: id(),
        label: '工作区已就绪',
        detail: '正在确认后端 Provider 模式',
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
    if (
      !parsed ||
      !Array.isArray(parsed.turns) ||
      !parsed.turns.every((turn) => turn.videoTask) ||
      !['local', 'mock', 'real'].includes(parsed.providerMode)
    ) {
      return emptyWorkspace()
    }
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
const videoStage = ref<HTMLElement | null>(null)
const videoElement = ref<HTMLVideoElement | null>(null)
const volumePercent = ref(100)
const lastAudibleVolumePercent = ref(100)
const isMuted = ref(false)
const isFullscreen = ref(false)
const backendAvailable = ref(false)
const pollingBackend = ref(false)
let lastBackendPollAt = 0

const activeTurn = computed(() =>
  state.turns.find((turn) => turn.id === state.activeTurnId) ?? state.turns.at(-1) ?? null,
)
const activeVideoTask = computed(() => activeTurn.value?.videoTask ?? createIdleVideoTask())
const isVideoBusy = computed(() => ACTIVE_VIDEO_STATES.includes(activeVideoTask.value.status))
const isCurrentTurn = computed(() => activeTurn.value?.id === state.currentTurnId)
const choicesEnabled = computed(
  () => isCurrentTurn.value && activeVideoTask.value.status === 'succeeded',
)
const canSend = computed(() => draft.value.trim().length >= 3 && state.phase !== 'story-generating')
const isMockMode = computed(() => state.providerMode !== 'real')
const connectionLabel = computed(() => {
  if (state.providerMode === 'real') return '服务端 · 真实 API 模式'
  if (state.providerMode === 'mock') return '服务端 Mock · SQLite 持久化'
  return backendAvailable.value ? '本地 Mock' : '本地 Mock · 后端未连接'
})
const previewLabel = computed(() => (isMockMode.value ? 'MOCK PREVIEW' : 'GENERATED VIDEO'))
const elapsedSeconds = computed(() => {
  if (!activeVideoTask.value.startedAt) return 0
  return Math.max(0, Math.floor((nowTick.value - activeVideoTask.value.startedAt) / 1000))
})
const videoStatusLabel = computed(() => {
  const labels: Record<VideoStatus, string> = {
    idle: '等待生成',
    submitting: '正在提交任务',
    queued: '已进入渲染队列',
    running: '正在生成视频',
    saving: '正在保存结果',
    succeeded: isMockMode.value ? 'Mock 视频已就绪' : '视频已就绪',
    failed: '生成失败',
    submission_unknown: '提交结果待确认',
  }
  return labels[activeVideoTask.value.status]
})
const primaryInputPlaceholder = computed(() => {
  if (state.phase === 'empty') return '输入你的故事创意…'
  if (!isCurrentTurn.value) return '返回当前片段后可继续故事…'
  if (!choicesEnabled.value) return '视频完成后可以续写故事…'
  return '或者自由描述故事的下一步…'
})
const formattedPlayhead = computed(() => `0:${String(Math.floor(playhead.value)).padStart(2, '0')}`)
const activeMediaUrl = computed(() => {
  const url = activeVideoTask.value.videoUrl
  if (!url) return null
  return new URL(url, `${publicConfig.apiBaseUrl}/`).toString()
})
const hasPlayableVideo = computed(
  () => Boolean(activeMediaUrl.value && activeVideoTask.value.mediaType?.startsWith('video/')),
)
const hasImagePreview = computed(
  () => Boolean(activeMediaUrl.value && activeVideoTask.value.mediaType?.startsWith('image/')),
)
const volumeButtonLabel = computed(() =>
  isMuted.value
    ? `取消静音，当前音量 ${volumePercent.value}%`
    : `静音，当前音量 ${volumePercent.value}%`,
)

let taskTimer: number | undefined
let playbackTimer: number | undefined
let noticeTimer: number | undefined

watch(state, (value) => window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)), {
  deep: true,
})

watch(
  () => activeVideoTask.value.status,
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

function pushActivity(label: string, detail: string, tone: ActivityItem['tone'] = 'neutral') {
  state.activity.unshift({ id: id(), label, detail, time: nowTime(), tone })
  state.activity = state.activity.slice(0, 16)
}

function mapVideoTask(video: VideoTaskResponse): VideoTask {
  return {
    id: video.id,
    version: video.version,
    taskId: video.task_id,
    providerStatus: video.provider_status,
    status: video.status,
    startedAt: video.created_at ? Date.parse(video.created_at) : null,
    updatedAt: video.updated_at ? Date.parse(video.updated_at) : null,
    outcome: 'success',
    videoUrl: video.video_url,
    mediaType: video.media_type,
    error: video.error,
  }
}

function hydrateStory(story: StoryResponse, focusCurrent = true) {
  const previousActiveId = state.activeTurnId
  state.storyId = story.id
  state.currentTurnId = story.current_turn_id
  state.idea = story.original_idea
  state.providerMode = story.provider_mode
  state.turns = story.turns.map((turn, index): StoryTurn => ({
    id: turn.id,
    storyId: turn.story_id,
    parentTurnId: turn.parent_turn_id,
    title: turn.title,
    storyText: turn.story_text,
    summary: turn.summary,
    videoPrompt: turn.video_prompt,
    choices: turn.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      direction: choice.direction,
    })),
    duration: turn.video.duration,
    imageVariant: index % 4,
    createdAt: turn.created_at,
    videoTask: mapVideoTask(turn.video),
  }))
  state.activeTurnId =
    focusCurrent || !state.turns.some((turn) => turn.id === previousActiveId)
      ? story.current_turn_id
      : previousActiveId
  state.phase = 'story-ready'
  state.selectedChoiceId = null
}

async function submitDraft() {
  inputError.value = ''
  const value = draft.value.trim()
  if (value.length < 3) {
    inputError.value = '请至少输入 3 个字，让故事有一个清晰的起点。'
    return
  }
  if (state.phase === 'empty') return startStory(value)
  if (!choicesEnabled.value) {
    inputError.value = isCurrentTurn.value
      ? '请先完成当前片段的视频，再决定下一步。'
      : '请先在下方时间线返回当前故事片段。'
    return
  }
  await continueStory(value, null)
}

async function startStory(idea: string) {
  draft.value = ''
  state.idea = idea
  state.phase = 'story-generating'
  pushMessage('user', idea)
  pushActivity(
    '正在生成故事片段',
    backendAvailable.value ? `${state.providerMode === 'real' ? 'Qwen3.7-Flash' : '服务端 Mock Provider'}` : '本地 Mock Provider',
    'active',
  )

  try {
    if (backendAvailable.value) {
      const story = await apiClient.createStory(idea)
      hydrateStory(story)
    } else {
      await mockGenerateStory()
      const turn = createOpeningTurn(idea)
      state.turns = [turn]
      state.currentTurnId = turn.id
      state.activeTurnId = turn.id
      state.phase = 'story-ready'
    }
    pushMessage('assistant', `第一幕已经展开：${activeTurn.value?.summary}`)
    pushActivity('故事片段已生成', '4 个后续方向已准备好', 'success')
  } catch (error) {
    state.phase = 'empty'
    inputError.value = readableError(error)
    pushActivity('故事生成失败', inputError.value, 'danger')
  }
}

async function chooseDirection(choice: StoryChoice) {
  if (!choicesEnabled.value || state.phase === 'story-generating') return
  state.selectedChoiceId = choice.id
  await continueStory(choice.direction, choice.id, choice.label)
}

async function continueStory(direction: string, choiceId: string | null, label?: string) {
  const currentTurn = activeTurn.value
  if (!currentTurn) return
  state.phase = 'story-generating'
  draft.value = ''
  pushMessage('user', label ?? direction)
  pushActivity('续写方向已确认', choiceId ? `固定选项 · ${label}` : '自定义剧情方向', 'active')

  try {
    if (backendAvailable.value && state.storyId) {
      const story = await apiClient.choose(
        state.storyId,
        currentTurn.id,
        choiceId ? { choice_id: choiceId } : { custom_direction: direction },
      )
      hydrateStory(story)
    } else {
      await mockContinueStory()
      const turn = createContinuationTurn(direction, state.turns.length)
      turn.parentTurnId = currentTurn.id
      state.turns.push(turn)
      state.currentTurnId = turn.id
      state.activeTurnId = turn.id
      state.phase = 'story-ready'
      state.selectedChoiceId = null
    }
    pushMessage('assistant', `${activeTurn.value?.title}：${activeTurn.value?.summary}`)
    pushActivity('下一片段已生成', '视频提示词可以在生成前编辑', 'success')
  } catch (error) {
    state.phase = 'story-ready'
    inputError.value = readableError(error)
    pushActivity('续写失败', inputError.value, 'danger')
  }
}

async function startVideoGeneration(confirmSubmissionUnknown = false) {
  const turn = activeTurn.value
  if (!turn || !isCurrentTurn.value || isVideoBusy.value || turn.videoTask.status === 'succeeded') return
  const outcome = nextOutcome.value
  nextOutcome.value = 'success'
  turn.videoTask = {
    ...createIdleVideoTask(),
    status: 'submitting',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    outcome,
  }
  promptEditorOpen.value = false
  pushActivity(
    '视频任务提交中',
    state.providerMode === 'real' ? 'Wan2.6 · 1280×720 · 5 秒' : 'Mock Wan · 无付费请求',
    'active',
  )

  if (!backendAvailable.value || !state.storyId) {
    updateLocalVideoTask()
    return
  }

  try {
    await apiClient.updateTurn(state.storyId, turn.id, { video_prompt: turn.videoPrompt })
    const response = await apiClient.createVideo(state.storyId, turn.id, {
      confirm_submission_unknown: confirmSubmissionUnknown,
      ...(state.providerMode === 'mock' ? { mock_outcome: outcome } : {}),
    })
    turn.videoTask = mapVideoTask(response)
    announceVideoStatus('submitting', response.status, response)
  } catch (error) {
    const message = readableError(error)
    try {
      const persisted = mapVideoTask(await apiClient.getVideo(state.storyId, turn.id))
      turn.videoTask =
        persisted.status === 'idle'
          ? {
              ...turn.videoTask,
              status: 'failed',
              error: message,
              updatedAt: Date.now(),
            }
          : persisted
    } catch {
      turn.videoTask.status = 'failed'
      turn.videoTask.error = message
    }
    pushActivity('视频提交失败', message, 'danger')
  }
}

function updateLocalVideoTask() {
  const turn = activeTurn.value
  if (!turn?.videoTask.startedAt || !ACTIVE_VIDEO_STATES.includes(turn.videoTask.status)) return
  const previous = turn.videoTask.status
  const result = mockTaskStatus(turn.videoTask.startedAt, turn.videoTask.outcome)
  turn.videoTask.status = result.status
  turn.videoTask.taskId = result.taskId
  turn.videoTask.providerStatus = result.status.toUpperCase()
  turn.videoTask.error = result.error
  turn.videoTask.updatedAt = Date.now()
  announceVideoStatus(previous, result.status, turn.videoTask)
}

async function pollBackendTasks() {
  if (!backendAvailable.value || !state.storyId || pollingBackend.value) return
  if (Date.now() - lastBackendPollAt < publicConfig.videoPollMs) return
  const activeTasks = state.turns.filter((turn) => ACTIVE_VIDEO_STATES.includes(turn.videoTask.status))
  if (!activeTasks.length) return
  pollingBackend.value = true
  lastBackendPollAt = Date.now()
  try {
    await Promise.all(
      activeTasks.map(async (turn) => {
        const previous = turn.videoTask.status
        const response = await apiClient.getVideo(state.storyId!, turn.id)
        turn.videoTask = mapVideoTask(response)
        announceVideoStatus(previous, response.status, response)
      }),
    )
  } catch (error) {
    pushActivity('视频状态更新失败', readableError(error), 'danger')
  } finally {
    pollingBackend.value = false
  }
}

function announceVideoStatus(
  previous: VideoStatus,
  current: VideoStatus,
  task: Pick<VideoTask, 'taskId' | 'error'> | VideoTaskResponse,
) {
  if (previous === current) return
  const taskId = 'task_id' in task ? task.task_id : task.taskId
  const error = task.error
  const activityByStatus: Partial<Record<VideoStatus, [string, string, ActivityItem['tone']]>> = {
    queued: ['视频任务已入队', taskId ?? '等待任务 ID', 'active'],
    running: ['正在生成视频', '供应商未提供真实百分比', 'active'],
    saving: ['正在保存视频', '服务端正在持久化临时结果', 'active'],
    succeeded: ['视频已保存', '结果已由本项目媒体地址提供', 'success'],
    failed: ['视频生成失败', error ?? '未知错误', 'danger'],
    submission_unknown: ['提交结果待确认', '已停止自动重试，避免重复计费', 'danger'],
  }
  const activity = activityByStatus[current]
  if (activity) pushActivity(...activity)
  if (current === 'succeeded' && activeTurn.value?.videoTask.status === 'succeeded') {
    pushMessage('assistant', '当前片段已完成。选择一个方向，或者写下你自己的下一步。')
  }
}

function retryVideo() {
  if (activeVideoTask.value.status === 'failed') void startVideoGeneration()
}

function confirmUnknownRetry() {
  if (activeVideoTask.value.status !== 'submission_unknown') return
  if (backendAvailable.value) {
    void startVideoGeneration(true)
    return
  }
  if (activeTurn.value) activeTurn.value.videoTask = createIdleVideoTask()
  pushActivity('未知任务已人工确认', '现在可以再次明确提交', 'neutral')
}

async function togglePlayback() {
  if (activeVideoTask.value.status !== 'succeeded') return
  if (hasPlayableVideo.value && videoElement.value) {
    if (videoElement.value.paused) await videoElement.value.play()
    else videoElement.value.pause()
    isPlaying.value = !videoElement.value.paused
    return
  }
  isPlaying.value = !isPlaying.value
}

function onVideoTimeUpdate() {
  if (videoElement.value) playhead.value = videoElement.value.currentTime
}

function syncVolumeState() {
  const media = videoElement.value
  if (!media) return
  const current = readMediaVolume(media)
  volumePercent.value = current.volumePercent
  isMuted.value = current.muted
  if (current.volumePercent > 0) lastAudibleVolumePercent.value = current.volumePercent
}

function onVolumeInput(event: Event) {
  const media = videoElement.value
  if (!media) return
  const target = event.currentTarget as HTMLInputElement
  const current = setMediaVolume(media, Number(target.value))
  volumePercent.value = current.volumePercent
  isMuted.value = current.muted
  if (current.volumePercent > 0) lastAudibleVolumePercent.value = current.volumePercent
}

function toggleMute() {
  const media = videoElement.value
  if (!media) return
  const current = toggleMediaMute(media, lastAudibleVolumePercent.value)
  volumePercent.value = current.volumePercent
  isMuted.value = current.muted
}

function syncFullscreenState() {
  isFullscreen.value = isElementFullscreen(videoStage.value, document)
}

async function toggleFullscreen() {
  const stage = videoStage.value
  if (!stage) return
  try {
    await toggleElementFullscreen(stage, document)
    syncFullscreenState()
  } catch (error) {
    pushActivity('全屏切换失败', readableError(error), 'danger')
  }
}

function resetWorkspace() {
  const mode = state.providerMode
  const fresh = emptyWorkspace()
  fresh.providerMode = mode
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
  if (!state.turns.some((item) => item.id === turnId)) return
  state.activeTurnId = turnId
  playhead.value = 0
  isPlaying.value = false
}

function readableError(error: unknown) {
  if (error instanceof ApiError) return error.message
  return error instanceof Error ? error.message : String(error)
}

async function connectBackend() {
  if (publicConfig.useLocalMock) {
    state.providerMode = 'local'
    pushActivity('本地 Mock 模式', 'VITE_USE_LOCAL_MOCK=true', 'neutral')
    return
  }
  try {
    const health = await apiClient.health()
    backendAvailable.value = true
    state.providerMode = health.provider_mode
    pushActivity(
      health.provider_mode === 'real' ? '真实 Provider 已启用' : '服务端 Mock 已连接',
      health.provider_mode === 'real' ? '模型调用可能产生费用' : 'SQLite 持久化，不会调用付费 API',
      health.provider_mode === 'real' ? 'active' : 'success',
    )
    if (state.storyId) {
      const story = await apiClient.getStory(state.storyId)
      hydrateStory(story)
      if (state.turns.some((turn) => ACTIVE_VIDEO_STATES.includes(turn.videoTask.status))) {
        restoredNotice.value = true
        pushActivity('已从数据库恢复任务', '继续轮询原有任务，未创建新任务', 'active')
        noticeTimer = window.setTimeout(() => (restoredNotice.value = false), 4200)
      }
    }
  } catch (error) {
    backendAvailable.value = false
    state.providerMode = 'local'
    if (state.storyId) resetWorkspace()
    pushActivity('后端暂不可用', `已保留本地 Mock：${readableError(error)}`, 'danger')
  }
}

onMounted(async () => {
  document.addEventListener('fullscreenchange', syncFullscreenState)
  await connectBackend()
  taskTimer = window.setInterval(() => {
    nowTick.value = Date.now()
    if (backendAvailable.value) void pollBackendTasks()
    else updateLocalVideoTask()
  }, 500)
  playbackTimer = window.setInterval(() => {
    if (hasPlayableVideo.value || !isPlaying.value || activeVideoTask.value.status !== 'succeeded') return
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
  document.removeEventListener('fullscreenchange', syncFullscreenState)
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
        <span class="phase-pill">{{ state.providerMode === 'real' ? 'LIVE' : 'MOCK' }}</span>
      </button>
      <button class="icon-button settings-button" aria-label="打开演示设置" @click="settingsOpen = true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8.75A3.25 3.25 0 1 0 12 15.25 3.25 3.25 0 0 0 12 8.75Z" />
          <path d="M19.2 13.1c.05-.36.08-.72.08-1.1s-.03-.74-.08-1.1l2-1.56-1.9-3.28-2.46.99a8.3 8.3 0 0 0-1.9-1.1L14.57 3h-3.8l-.38 2.95a8.3 8.3 0 0 0-1.9 1.1l-2.46-.99-1.9 3.28 2 1.56A7.5 7.5 0 0 0 6.05 12c0 .38.03.74.08 1.1l-2 1.56 1.9 3.28 2.46-.99c.58.46 1.22.83 1.9 1.1l.38 2.95h3.8l.38-2.95a8.3 8.3 0 0 0 1.9-1.1l2.46.99 1.9-3.28-2.01-1.56Z" />
        </svg>
      </button>
      <div class="header-spacer"></div>
      <div class="connection-badge" :class="{ live: state.providerMode === 'real' }"><span></span> {{ connectionLabel }}</div>
    </header>

    <main class="workspace">
      <section class="canvas-panel">
        <div ref="videoStage" class="video-stage" :class="[`status-${activeVideoTask.status}`, { playing: isPlaying, fullscreen: isFullscreen }]">
          <div class="scene-backdrop" :class="`variant-${activeTurn?.imageVariant ?? 0}`"></div>
          <img
            v-if="hasImagePreview && activeMediaUrl"
            class="generated-video"
            :src="activeMediaUrl"
            alt="Mock 视频预览"
          />
          <video
            v-else-if="hasPlayableVideo && activeMediaUrl"
            ref="videoElement"
            class="generated-video"
            :src="activeMediaUrl"
            playsinline
            @loadedmetadata="syncVolumeState"
            @timeupdate="onVideoTimeUpdate"
            @volumechange="syncVolumeState"
            @play="isPlaying = true"
            @pause="isPlaying = false"
            @ended="isPlaying = false"
          ></video>
          <div class="stage-shade"></div>

          <div class="stage-badges">
            <span class="mock-badge">{{ previewLabel }}</span>
            <span v-if="activeTurn" class="scene-name">{{ activeTurn.title }}</span>
          </div>

          <transition name="notice">
            <div v-if="restoredNotice" class="restore-notice">
              <span class="spinner small"></span>
              {{ backendAvailable ? '已从数据库恢复同一个视频任务' : '已从本地恢复同一个视频任务' }}
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
            <p class="eyebrow">{{ isMockMode ? 'MOCK STORY ENGINE' : 'QWEN 3.8 FLASH' }}</p>
            <h2>{{ activeTurn ? '正在续写下一幕' : '正在构建故事世界' }}</h2>
            <p>整理角色、场景与四个不同的剧情方向…</p>
          </div>

          <div v-else-if="activeVideoTask.status === 'idle'" class="stage-center ready-state">
            <p class="eyebrow">故事片段已就绪</p>
            <h2>{{ activeTurn?.title }}</h2>
            <p>{{ activeTurn?.summary }}</p>
            <button class="primary-button generate-button" :disabled="!isCurrentTurn" @click="startVideoGeneration()">
              <svg viewBox="0 0 24 24"><path d="m10 8 6 4-6 4V8Z" /><path d="M4.75 5.75A2.75 2.75 0 0 1 7.5 3h9A2.75 2.75 0 0 1 19.25 5.75v12.5A2.75 2.75 0 0 1 16.5 21h-9a2.75 2.75 0 0 1-2.75-2.75V5.75Z" /></svg>
              {{ !isCurrentTurn ? '请返回当前片段' : isMockMode ? '生成 Mock 视频' : '生成视频' }}
            </button>
            <button class="text-button" @click="promptEditorOpen = true">先编辑视频提示词</button>
          </div>

          <div v-else-if="isVideoBusy" class="stage-center task-state">
            <span class="spinner large"></span>
            <p class="eyebrow">{{ activeVideoTask.status === 'saving' ? 'LOCAL MEDIA' : isMockMode ? 'MOCK WAN 2.6' : 'WAN 2.6' }}</p>
            <h2>{{ videoStatusLabel }}</h2>
            <p>已等待 {{ elapsedSeconds }} 秒 · 不展示虚构百分比</p>
            <span v-if="activeVideoTask.taskId" class="task-id">{{ activeVideoTask.taskId }}</span>
          </div>

          <div v-else-if="activeVideoTask.status === 'failed'" class="stage-center error-state">
            <span class="error-icon">!</span>
            <p class="eyebrow">{{ isMockMode ? 'MOCK FAILURE' : 'GENERATION FAILED' }}</p>
            <h2>这次没有生成成功</h2>
            <p>{{ activeVideoTask.error }}</p>
            <button class="primary-button" @click="retryVideo">手动重试</button>
          </div>

          <div v-else-if="activeVideoTask.status === 'submission_unknown'" class="stage-center error-state unknown-state">
            <span class="error-icon">?</span>
            <p class="eyebrow">需要人工确认</p>
            <h2>任务是否提交成功尚不确定</h2>
            <p>{{ activeVideoTask.error }}</p>
            <button class="secondary-button" @click="confirmUnknownRetry">我已核实，允许重新提交</button>
          </div>

          <button
            v-else-if="activeVideoTask.status === 'succeeded'"
            class="center-play"
            :aria-label="isPlaying ? '暂停' : '播放'"
            @click="togglePlayback"
          >
            <svg v-if="!isPlaying" viewBox="0 0 24 24"><path d="m9 6 9 6-9 6V6Z" /></svg>
            <svg v-else viewBox="0 0 24 24"><path d="M7 6h4v12H7V6Zm6 0h4v12h-4V6Z" /></svg>
          </button>

          <div v-if="activeVideoTask.status === 'succeeded'" class="player-controls">
            <button class="player-button" :aria-label="isPlaying ? '暂停' : '播放'" @click="togglePlayback">
              <svg v-if="!isPlaying" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z" /></svg>
              <svg v-else viewBox="0 0 24 24"><path d="M6 5h4v14H6V5Zm8 0h4v14h-4V5Z" /></svg>
            </button>
            <span class="timecode">{{ formattedPlayhead }} / 0:{{ String(activeTurn?.duration ?? 8).padStart(2, '0') }}</span>
            <div class="scrubber"><span :style="{ width: `${(playhead / (activeTurn?.duration ?? 8)) * 100}%` }"></span></div>
            <div class="volume-control" :class="{ disabled: !hasPlayableVideo }">
              <button
                class="player-button"
                :class="{ active: isMuted }"
                :disabled="!hasPlayableVideo"
                :aria-label="volumeButtonLabel"
                :aria-pressed="isMuted"
                @click="toggleMute"
              >
                <svg v-if="isMuted" viewBox="0 0 24 24"><path d="M5 10v4h3l4 3V7l-4 3H5Zm10 0 5 5m0-5-5 5" /></svg>
                <svg v-else viewBox="0 0 24 24"><path d="M5 10v4h3l4 3V7l-4 3H5Zm10-1.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12" /></svg>
              </button>
              <input
                class="volume-slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="volumePercent"
                :disabled="!hasPlayableVideo"
                aria-label="音量"
                :aria-valuetext="`${volumePercent}%`"
                @input="onVolumeInput"
              />
            </div>
            <button
              class="player-button"
              :class="{ active: isFullscreen }"
              :aria-label="isFullscreen ? '退出全屏' : '全屏'"
              :aria-pressed="isFullscreen"
              @click="toggleFullscreen"
            >
              <svg v-if="isFullscreen" viewBox="0 0 24 24"><path d="M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6" /></svg>
              <svg v-else viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></svg>
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
              <span class="card-meta">{{ turn.videoTask.status === 'succeeded' ? (isMockMode ? 'Mock 片段' : '视频已保存') : '故事片段' }}</span>
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
              <textarea v-model="activeTurn.videoPrompt" :disabled="!isCurrentTurn || activeVideoTask.status !== 'idle'" rows="5"></textarea>
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
            <div><strong>{{ videoStatusLabel }}</strong><small>{{ isMockMode ? '当前为安全 Mock 模式，不调用付费 API' : '任务状态来自服务端数据库' }}</small></div>
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
              <button type="button" class="tool-button" @click="settingsOpen = true" aria-label="生成设置">
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
            <div><span class="section-kicker">PHASE B</span><h2 id="settings-title">生成设置</h2></div>
            <button class="icon-button" aria-label="关闭" @click="settingsOpen = false">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <p class="modal-intro">{{ isMockMode ? '选择下一次视频任务的演示结果。Mock 模式不会产生模型费用。' : '当前已启用真实 Provider。生成视频可能产生模型费用，任务提交后不会自动重复创建。' }}</p>
          <fieldset v-if="isMockMode">
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
          <div class="modal-note"><strong>刷新恢复</strong><span>{{ backendAvailable ? '任务保存在 SQLite 中；刷新只会恢复轮询，不会重新提交。' : '本地 Mock 状态保存在当前浏览器中。' }}</span></div>
          <div class="modal-footer">
            <button class="danger-text-button" @click="resetWorkspace">开始新故事</button>
            <button class="primary-button" @click="settingsOpen = false">完成</button>
          </div>
        </section>
      </div>
    </transition>
  </div>
</template>
