<script setup lang="ts">
import type { TurnContentVersionResponse } from '@scenefork/shared'
import type { StoryTurn } from '../types'
defineProps<{ open: boolean; turn: StoryTurn | null; versions: TurnContentVersionResponse[]; busy: boolean }>()
const emit = defineEmits<{
  close: []
  content: [id: string]
  video: [id: string]
  'regenerate-story': []
  'regenerate-video': []
  confirm: []
}>()
</script>
<template>
  <div v-if="open" class="version-backdrop" @mousedown.self="emit('close')">
    <section class="version-panel">
      <header><div><span>NON-DESTRUCTIVE VERSIONS</span><h2>{{ turn?.title }}</h2></div><button @click="emit('close')">×</button></header>
      <h3>剧情与 Prompt 版本</h3>
      <button v-for="version in versions" :key="version.id" class="version-row" :class="{ selected: version.id === turn?.contentVersionId }" :disabled="busy" @click="emit('content', version.id)">
        <span><strong>V{{ version.version }}</strong><small>{{ new Date(version.created_at).toLocaleString() }}</small></span><b>{{ version.id === turn?.contentVersionId ? '当前' : '恢复' }}</b>
      </button>
      <h3>视频版本</h3>
      <button v-for="video in turn?.videoHistory ?? []" :key="video.id ?? video.version" class="version-row" :class="{ selected: video.id === turn?.videoTask.id }" :disabled="busy || !video.id" @click="video.id && emit('video', video.id)">
        <span><strong>V{{ video.version }}</strong><small>{{ video.status }}</small></span><b>{{ video.id === turn?.videoTask.id ? '当前' : '切换' }}</b>
      </button>
      <div class="regenerate-actions">
        <button class="regenerate" :disabled="busy || !turn" @click="emit('regenerate-story')">重新生成剧情</button>
        <button class="regenerate" :disabled="busy || !turn" @click="emit('regenerate-video')">重新生成视频</button>
      </div>
      <button v-if="turn?.branchStatus === 'stale'" class="confirm" :disabled="busy" @click="emit('confirm')">确认该镜头仍然连贯</button>
    </section>
  </div>
</template>
<style scoped>
.version-backdrop{position:fixed;inset:0;z-index:65;display:grid;place-items:center;padding:20px;background:rgba(1,6,10,.66)}.version-panel{width:min(520px,100%);max-height:84vh;padding:24px;overflow:auto;border:1px solid #1c3d4d;border-radius:14px;color:#dce9ee;background:#07151f}.version-panel header{display:flex;justify-content:space-between}.version-panel header span{color:#15e5d2;font-size:9px;letter-spacing:1.4px}.version-panel h2{margin:5px 0 15px}.version-panel header button{border:0;color:#9aacb8;background:transparent;font-size:27px}.version-panel h3{margin:18px 0 9px;color:#8499a7;font-size:11px}.version-row{width:100%;margin-bottom:7px;padding:11px;display:flex;justify-content:space-between;border:1px solid #183545;border-radius:8px;color:#bccbd3;background:#0a1b27;text-align:left}.version-row.selected{border-color:#15e5d2}.version-row small{margin:4px 0 0 10px;color:#607887}.version-row b{color:#15e5d2;font-size:10px}.regenerate-actions{margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:9px}.regenerate,.confirm{width:100%;padding:12px;border:1px solid #15e5d2;border-radius:8px;color:#06221f;background:#15e5d2;font-weight:750}.confirm{margin-top:14px;border-color:#f0b45f;background:#f0b45f}button:disabled{opacity:.45}
</style>
