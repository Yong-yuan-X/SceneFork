<script setup lang="ts">
import type { KeysStatusResponse, UpdateKeysRequest } from '@scenefork/shared'
import { ref, watch } from 'vue'

const props = defineProps<{ open: boolean; status: KeysStatusResponse | null; busy: boolean; error: string }>()
const emit = defineEmits<{ close: []; save: [value: UpdateKeysRequest]; clear: [] }>()
const qwenKey = ref('')
const wanKey = ref('')
const revealQwen = ref(false)
const revealWan = ref(false)
watch(() => props.open, (open) => {
  if (open) {
    qwenKey.value = ''
    wanKey.value = ''
  }
})
const sourceText = (model: 'qwen' | 'wan') => {
  const current = props.status?.[model]
  if (!current?.configured) return '未配置 · Mock'
  if (current.source === 'temporary') return '本次进程临时 Key'
  if (current.source === 'environment') return '.env 模型 Key'
  return '.env 兼容 Key'
}
</script>

<template>
  <div v-if="open" class="key-backdrop" @mousedown.self="emit('close')">
    <section class="key-modal" role="dialog" aria-modal="true" aria-labelledby="key-title">
      <header><div><span>SECURE LOCAL SETTINGS</span><h2 id="key-title">API Keys</h2></div><button aria-label="关闭" @click="emit('close')">×</button></header>
      <p>Key 只保存在后端当前进程内存中，重启后清除；页面不会回显、持久化或记录明文。</p>
      <label>
        <span><strong>Qwen API Key</strong><small>{{ sourceText('qwen') }}</small></span>
        <span class="key-input"><input v-model="qwenKey" :type="revealQwen ? 'text' : 'password'" autocomplete="off" placeholder="留空表示不修改" /><button type="button" @click="revealQwen = !revealQwen">{{ revealQwen ? '隐藏' : '显示' }}</button></span>
      </label>
      <label>
        <span><strong>Wan API Key</strong><small>{{ sourceText('wan') }}</small></span>
        <span class="key-input"><input v-model="wanKey" :type="revealWan ? 'text' : 'password'" autocomplete="off" placeholder="留空表示不修改" /><button type="button" @click="revealWan = !revealWan">{{ revealWan ? '隐藏' : '显示' }}</button></span>
      </label>
      <p v-if="error" class="key-error">{{ error }}</p>
      <footer><button class="clear" :disabled="busy" @click="emit('clear')">清除临时覆盖，恢复 .env</button><span><button @click="emit('close')">取消</button><button class="save" :disabled="busy" @click="emit('save', { qwen_api_key: qwenKey || undefined, wan_api_key: wanKey || undefined })">{{ busy ? '保存中…' : '保存' }}</button></span></footer>
    </section>
  </div>
</template>

<style scoped>
.key-backdrop{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:20px;background:rgba(1,7,11,.78);backdrop-filter:blur(9px)}.key-modal{width:min(540px,100%);padding:25px;border:1px solid #1c3d4d;border-radius:15px;color:#dce9ee;background:#081722;box-shadow:0 35px 100px rgba(0,0,0,.55)}header{display:flex;justify-content:space-between}header span{color:#13e6d3;font-size:10px;letter-spacing:1.5px}h2{margin:5px 0 0;font-size:23px}header button{width:34px;height:34px;border:0;color:#9db0bc;background:transparent;font-size:27px}.key-modal>p{color:#7d93a2;font-size:11px;line-height:1.7}.key-modal>label{margin-top:15px;display:block}.key-modal>label>span:first-child{margin-bottom:7px;display:flex;justify-content:space-between}.key-modal strong{font-size:12px}.key-modal small{color:#607887}.key-input{display:flex;border:1px solid #1b3a4b;border-radius:8px;background:#06111a}.key-input input{min-width:0;flex:1;padding:13px;border:0;outline:0;color:#dce9ee;background:transparent}.key-input button{border:0;color:#7fa0ac;background:transparent}.key-error{color:#ff8d98!important}footer{margin-top:25px;display:flex;align-items:center;justify-content:space-between;gap:15px}footer span{display:flex;gap:8px}footer button{padding:10px 13px;border:1px solid #203c4c;border-radius:7px;color:#a9bac3;background:#0b1c28}.clear{border:0;color:#df9b72;background:transparent}.save{border-color:#13e6d3;color:#03231f;background:#13e6d3;font-weight:800}button:disabled{opacity:.45}
</style>
