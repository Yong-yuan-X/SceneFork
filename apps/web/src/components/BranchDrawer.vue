<script setup lang="ts">
import type { StoryBranch, StoryTurn } from '../types'
import { computed } from 'vue'
import { currentBranchPath } from '../services/branchPath'

const props = defineProps<{
  open: boolean
  branches: StoryBranch[]
  turns: StoryTurn[]
  currentBranchId: string | null
  activeTurnId: string | null
}>()
const emit = defineEmits<{
  close: []
  branch: [id: string]
  turn: [id: string]
  rename: [id: string]
  remove: [id: string]
}>()
const visibleTurns = computed(() =>
  currentBranchPath(props.turns, props.branches, props.currentBranchId),
)

function depth(turn: StoryTurn) {
  let current = turn
  let level = 0
  const seen = new Set<string>()
  while (current.parentTurnId && !seen.has(current.parentTurnId)) {
    seen.add(current.parentTurnId)
    const parent = props.turns.find((item) => item.id === current.parentTurnId)
    if (!parent) break
    current = parent
    level += 1
  }
  return Math.min(level, 6)
}
</script>

<template>
  <div v-if="open" class="drawer-backdrop" @mousedown.self="emit('close')">
    <aside class="branch-drawer">
      <header>
        <div><span>STORY FORK</span><h2>剧情树与分支</h2></div>
        <button @click="emit('close')">×</button>
      </header>
      <section class="branch-list">
        <article
          v-for="branch in branches"
          :key="branch.id"
          :class="{ active: branch.id === currentBranchId }"
        >
          <button class="branch-open" @click="emit('branch', branch.id)">
            <strong>{{ branch.name }}</strong>
            <small>{{ branch.forkedAtTurnId ? '从历史镜头分叉' : '默认主线' }} · {{ branch.pathTurnIds.length }} 幕</small>
          </button>
          <span class="branch-actions">
            <button class="branch-rename" :aria-label="`重命名 ${branch.name}`" @click="emit('rename', branch.id)">✎</button>
            <button
              v-if="branch.forkedFromBranchId"
              class="branch-delete"
              :aria-label="`删除 ${branch.name}`"
              title="删除分支"
              @click="emit('remove', branch.id)"
            >×</button>
          </span>
        </article>
      </section>
      <section class="tree-list">
        <button
          v-for="(turn, index) in visibleTurns"
          :key="turn.id"
          :style="{ marginLeft: `${depth(turn) * 16}px` }"
          :class="{ active: turn.id === activeTurnId, stale: turn.branchStatus === 'stale' }"
          @click="emit('turn', turn.id)"
        >
          <span class="node">{{ index + 1 }}</span>
          <span><strong>{{ turn.title }}</strong><small>V{{ turn.contentVersion ?? 1 }} · 视频 V{{ turn.videoTask.version }}</small></span>
          <b v-if="turn.branchStatus === 'stale'" title="上游内容已变化，可能不连贯">!</b>
        </button>
      </section>
      <p>从任意历史镜头选择新方向时会自动建立分支，原路线和媒体不会被覆盖。</p>
    </aside>
  </div>
</template>

<style scoped>
.drawer-backdrop{position:fixed;inset:0;z-index:60;background:rgba(1,6,10,.55)}
.branch-drawer{width:min(420px,92vw);height:100%;margin-left:auto;padding:24px;overflow:auto;border-left:1px solid #1a3a49;color:#dce9ee;background:#07141e;box-shadow:-25px 0 70px rgba(0,0,0,.4)}
header{display:flex;justify-content:space-between}header span{color:#15e5d2;font-size:10px;letter-spacing:1.4px}h2{margin:5px 0 18px}header button{border:0;color:#9cafbb;background:transparent;font-size:28px}
.branch-list{display:grid;grid-template-columns:1fr 1fr;gap:8px}.branch-list article{position:relative;border:1px solid #183545;border-radius:8px;background:#0a1a26}.branch-list article.active{border-color:#15e5d2;background:rgba(21,229,210,.08)}.branch-open{width:100%;padding:12px 68px 12px 12px;border:0;color:#b9c9d2;background:transparent;text-align:left}.branch-actions{position:absolute;right:7px;top:7px;display:flex;gap:4px}.branch-rename,.branch-delete{width:25px;height:25px;border:0;border-radius:5px;color:#6f8897;background:#102633}.branch-delete{color:#ff9da5}.branch-delete:hover{color:#fff;background:#8d2e3a}.branch-list small,.tree-list small{margin-top:4px;display:block;color:#657d8d}
.tree-list{margin-top:20px;display:flex;flex-direction:column;align-items:stretch;gap:8px}.tree-list button{position:relative;padding:12px;display:grid;grid-template-columns:32px 1fr 20px;align-items:center;border:1px solid #183545;border-radius:8px;color:#b9c9d2;background:#0a1a26;text-align:left}.tree-list button:before{content:"";position:absolute;left:-10px;top:-9px;width:9px;height:30px;border-left:1px solid #214252;border-bottom:1px solid #214252}.tree-list button.active{border-color:#15e5d2;background:rgba(21,229,210,.08)}.node{width:26px;height:26px;display:grid;place-items:center;border-radius:50%;color:#08201d;background:#15e5d2;font-size:11px}.tree-list b{display:grid;place-items:center;color:#241601;background:#f2b55e;border-radius:50%}.tree-list button.stale{border-color:rgba(242,181,94,.35)}.branch-drawer>p{margin-top:22px;color:#657d8d;font-size:10px;line-height:1.7}
</style>
