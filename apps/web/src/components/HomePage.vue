<script setup lang="ts">
import type { StoryListItem } from '@scenefork/shared'
import { computed, ref } from 'vue'
import { backendUrl } from '../config'

const props = defineProps<{
  drafts: StoryListItem[]
  loading: boolean
  creating: boolean
  error: string
  page: number
  totalPages: number
  deletingDraftId: string | null
}>()
const emit = defineEmits<{
  create: [idea: string]
  open: [storyId: string]
  remove: [draft: StoryListItem]
  settings: []
  page: [page: number]
}>()
const idea = ref('')
const localError = ref('')
const openMenuId = ref<string | null>(null)
const canGenerate = computed(() => idea.value.trim().length >= 3 && !props.creating)

function submit() {
  if (!canGenerate.value) {
    localError.value = '请至少输入 3 个字。'
    return
  }
  localError.value = ''
  emit('create', idea.value.trim())
}

function coverUrl(draft: StoryListItem) {
  if (!draft.cover_url || draft.cover_kind !== 'real') return null
  return backendUrl(draft.cover_url)
}

function toggleDraftMenu(storyId: string) {
  openMenuId.value = openMenuId.value === storyId ? null : storyId
}

function openDraft(storyId: string) {
  openMenuId.value = null
  emit('open', storyId)
}

function requestDelete(draft: StoryListItem) {
  openMenuId.value = null
  emit('remove', draft)
}
</script>

<template>
  <main class="home-page" @click="openMenuId = null">
    <button class="home-settings" aria-label="API Key 设置" @click="emit('settings')">
      <svg viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm7.2 4.6c.05-.36.08-.72.08-1.1s-.03-.74-.08-1.1l2-1.56-1.9-3.28-2.46.99a8.3 8.3 0 0 0-1.9-1.1L14.57 3h-3.8l-.38 2.95a8.3 8.3 0 0 0-1.9 1.1l-2.46-.99-1.9 3.28 2 1.56A7.5 7.5 0 0 0 6.05 12c0 .38.03.74.08 1.1l-2 1.56 1.9 3.28 2.46-.99c.58.46 1.22.83 1.9 1.1l.38 2.95h3.8l.38-2.95a8.3 8.3 0 0 0 1.9-1.1l2.46.99 1.9-3.28-2.01-1.56Z" /></svg>
    </button>

    <section class="home-hero">
      <h1><span>Scene</span><strong>Fork</strong></h1>
      <p>Turn your ideas into cinematic stories</p>
      <form class="idea-box" @submit.prevent="submit">
        <div class="idea-copy">
          <span class="spark">✦</span>
          <textarea v-model="idea" rows="2" placeholder="Describe your story or idea…" @input="localError = ''"></textarea>
          <small>例如：一名旅人在云层之上发现了一座隐秘城市……</small>
        </div>
        <button type="submit" :disabled="!canGenerate">
          <span v-if="creating" class="home-spinner"></span>
          <svg v-else viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z" /></svg>
          {{ creating ? 'Generating…' : 'Generate' }}
        </button>
      </form>
      <p v-if="localError || error" class="home-error">{{ localError || error }}</p>
    </section>

    <section class="draft-section">
      <div class="draft-heading">
        <h2><span></span>Recent Drafts</h2>
        <div v-if="totalPages > 1" class="pager">
          <button :disabled="page <= 1" @click="emit('page', page - 1)">‹</button>
          <span>{{ page }} / {{ totalPages }}</span>
          <button :disabled="page >= totalPages" @click="emit('page', page + 1)">›</button>
        </div>
      </div>
      <div v-if="loading" class="draft-loading">正在读取草稿…</div>
      <div v-else class="draft-grid">
        <article v-for="draft in drafts" :key="draft.id" class="draft-card">
          <button class="draft-open" :disabled="deletingDraftId === draft.id" @click="openDraft(draft.id)">
            <span class="draft-cover" :class="{ placeholder: !coverUrl(draft) }">
              <img v-if="coverUrl(draft)" :src="coverUrl(draft)!" alt="真实视频首帧" />
              <span v-else class="placeholder-mark">SF</span>
              <span v-if="draft.cover_kind !== 'real'" class="cover-label">暂无真实首帧</span>
            </span>
            <span class="draft-meta"><strong>{{ draft.name }}</strong><small>{{ draft.title }}</small></span>
          </button>
          <button
            class="draft-more"
            :disabled="deletingDraftId === draft.id"
            :aria-expanded="openMenuId === draft.id"
            :aria-label="`${draft.name} 菜单`"
            @click.stop="toggleDraftMenu(draft.id)"
          >•••</button>
          <div v-if="openMenuId === draft.id" class="draft-menu" @click.stop>
            <button class="draft-delete" @click="requestDelete(draft)">Delete</button>
          </div>
        </article>
        <article v-for="index in Math.max(0, 9 - drafts.length)" :key="`empty-${index}`" class="draft-card empty-card">
          <span class="draft-cover placeholder"><span class="placeholder-mark">+</span></span>
          <span class="draft-meta"><strong>draft{{ (page - 1) * 9 + drafts.length + index }}</strong><small>等待创建</small></span>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.home-page{min-height:100vh;padding:22px 3vw 34px;color:#eef8fb;background:radial-gradient(65% 32% at 50% 12%,rgba(0,233,220,.14),transparent 70%),radial-gradient(30% 20% at 50% 20%,rgba(29,121,142,.14),transparent),#030b13;overflow:auto}.home-page:before{content:"";position:fixed;left:12%;right:12%;top:78px;height:120px;border-top:2px solid rgba(19,233,219,.28);border-radius:50%;filter:drop-shadow(0 0 14px rgba(12,213,205,.3));pointer-events:none}.home-settings{position:relative;z-index:2;width:49px;height:49px;display:grid;place-items:center;border:1px solid #173445;border-radius:11px;color:#dbe8ed;background:#081520}.home-settings svg{width:23px;fill:none;stroke:currentColor;stroke-width:1.8}.home-hero{position:relative;z-index:1;max-width:1040px;margin:72px auto 0;text-align:center}.home-hero h1{margin:0;font-size:clamp(54px,6vw,86px);line-height:1;letter-spacing:-4px}.home-hero h1 strong{color:#10e5d4}.home-hero p{margin:18px 0 42px;color:#88a3b8;font-size:16px;letter-spacing:4px}.idea-box{width:min(100%,860px);min-height:190px;margin:0 auto;padding:30px;box-sizing:border-box;display:flex;align-items:flex-end;gap:22px;border:1px solid rgba(18,228,213,.46);border-radius:17px;background:linear-gradient(135deg,rgba(9,25,37,.95),rgba(7,20,30,.86));box-shadow:0 22px 70px rgba(0,0,0,.25),inset 0 0 40px rgba(24,209,198,.025)}.idea-copy{min-width:0;flex:1;display:grid;grid-template-columns:38px 1fr;text-align:left}.spark{grid-row:1/3;color:#19e8d6;font-size:30px}.idea-copy textarea{width:100%;resize:none;border:0;outline:0;color:#e0ebef;background:transparent;font:500 17px/1.6 system-ui}.idea-copy textarea::placeholder{color:#9ab0c0}.idea-copy small{color:#6f8798;font-size:13px}.idea-box>button{min-width:165px;height:58px;display:flex;align-items:center;justify-content:center;gap:10px;border:0;border-radius:11px;color:#03221e;background:#16ead8;font-size:16px;font-weight:800}.idea-box>button:disabled{opacity:.4}.idea-box svg{width:22px;fill:currentColor}.home-spinner{width:18px;height:18px;border:2px solid rgba(0,0,0,.2);border-top-color:#03221e;border-radius:50%;animation:home-spin .7s linear infinite}.home-error{margin:12px 0 0!important;color:#ff8e98!important;font-size:13px!important;letter-spacing:0!important}.draft-section{max-width:1640px;margin:50px auto 0}.draft-heading{display:flex;align-items:center;justify-content:space-between}.draft-heading h2{display:flex;align-items:center;gap:14px;font-size:18px}.draft-heading h2 span{width:4px;height:24px;background:#16ead8;box-shadow:0 0 14px #16ead8}.pager{display:flex;align-items:center;gap:10px;color:#7690a1}.pager button{width:34px;height:30px;border:1px solid #173445;border-radius:7px;color:#c5d5de;background:#0a1722}.pager button:disabled{opacity:.3}.draft-grid{display:grid;grid-template-columns:repeat(9,minmax(130px,1fr));gap:14px}.draft-card{min-width:0;position:relative;padding:0;overflow:visible;border:1px solid #183142;border-radius:11px;color:#dbe8ed;background:#091722;text-align:left}.draft-card:not(.empty-card):hover{transform:translateY(-3px);border-color:rgba(22,234,216,.55);box-shadow:0 12px 35px rgba(0,0,0,.35)}.draft-open{width:100%;padding:0;overflow:hidden;border:0;border-radius:10px;color:inherit;background:transparent;text-align:left}.draft-open:disabled{opacity:.55}.draft-cover{height:150px;position:relative;display:grid;place-items:center;overflow:hidden;background:#0d1b27}.draft-cover img{width:100%;height:100%;object-fit:cover}.draft-cover.placeholder{background:radial-gradient(circle at 68% 30%,rgba(15,229,213,.16),transparent 28%),linear-gradient(140deg,#0b2130,#0b1420 55%,#101b2c)}.placeholder-mark{color:rgba(128,204,207,.33);font-size:28px;font-weight:800;letter-spacing:2px}.cover-label{position:absolute;right:7px;bottom:7px;padding:4px 6px;border-radius:4px;color:#76909e;background:rgba(2,8,13,.72);font-size:9px}.draft-meta{height:50px;padding:8px 34px 8px 10px;box-sizing:border-box;display:flex;flex-direction:column;gap:3px}.draft-meta strong{font-size:12px}.draft-meta small{color:#647b8c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.draft-more{position:absolute;z-index:2;right:6px;bottom:20px;width:27px;height:24px;border:0;border-radius:5px;color:#7892a2;background:transparent;font-weight:800;letter-spacing:1px}.draft-more:hover,.draft-more[aria-expanded="true"]{color:#dffdfa;background:#102a36}.draft-menu{position:absolute;z-index:8;right:7px;bottom:-25px;width:100px;padding:5px;border:1px solid #244555;border-radius:8px;background:#0a1823;box-shadow:0 12px 30px rgba(0,0,0,.45)}.draft-delete{width:100%;padding:8px;border:0;border-radius:5px;color:#ff9ca4;background:transparent;text-align:left}.draft-delete:hover{color:#fff;background:#832c38}.draft-loading{padding:70px;text-align:center;color:#7891a2}.empty-card{overflow:hidden;opacity:.44}@keyframes home-spin{to{transform:rotate(360deg)}}@media(max-width:1250px){.draft-grid{grid-template-columns:repeat(5,1fr)}}@media(max-width:760px){.home-page{padding:16px}.home-hero{margin-top:45px}.idea-box{padding:20px;align-items:stretch;flex-direction:column}.idea-box>button{align-self:flex-end}.draft-grid{grid-template-columns:repeat(2,1fr)}}
</style>
