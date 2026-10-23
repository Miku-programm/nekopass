<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import PageShell from '../PageShell.vue'
import ProbePage from '../ProbePage.vue'
import { usePage } from '../page'
import { api, type ProbeNode } from '../api'
import { createDefaultPreferences, loadPreferences, normalizeIntervals, subscribePreferences, type ProbeIntervals } from '../probe-preferences'

const nodes = ref<ProbeNode[]>([])
const refreshing = ref(false)
const updatedAt = ref<number | null>(null)
const intervals = ref(createDefaultPreferences().intervals)
let pending: Promise<void> | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let active = false
let unsubscribe = () => {}

function cancelTimer() {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
}

function schedule() {
  cancelTimer()
  if (!active || !me.value || loading.value || pending) return
  timer = setTimeout(() => { void refresh() }, document.hidden ? intervals.value.background : intervals.value.foreground)
}

function loadNodes(): Promise<void> {
  if (pending) return pending
  cancelTimer()
  refreshing.value = true
  pending = api<ProbeNode[]>('node-status')
    .then(result => {
      if (!Array.isArray(result) || result.some(node => !node || !Number.isSafeInteger(node.id) || node.id <= 0 || !Number.isSafeInteger(node.group_id) || node.group_id < 0 || typeof node.name !== 'string' || typeof node.group_name !== 'string' || typeof node.online !== 'boolean' || typeof node.enabled !== 'boolean' || (node.metrics !== null && (typeof node.metrics !== 'object' || Array.isArray(node.metrics))))) {
        throw new Error('服务端返回的节点状态格式无效')
      }
      nodes.value = result
      updatedAt.value = Date.now()
    })
    .finally(() => {
      refreshing.value = false
      pending = null
      schedule()
    })
  return pending
}
const { me, loading, error, refresh } = usePage(loadNodes)

function changeIntervals(value: ProbeIntervals) {
  intervals.value = normalizeIntervals(value)
  schedule()
}

watch(() => me.value?.id, accountId => {
  unsubscribe()
  if (!accountId) return
  changeIntervals(loadPreferences(accountId).intervals)
  unsubscribe = subscribePreferences(accountId, preferences => changeIntervals(preferences.intervals))
})
watch(loading, () => schedule())
onMounted(() => {
  active = true
  document.addEventListener('visibilitychange', schedule)
  schedule()
})
onUnmounted(() => {
  active = false
  cancelTimer()
  unsubscribe()
  document.removeEventListener('visibilitychange', schedule)
})
</script>

<template>
  <PageShell :me="me" :loading="loading" :error="error" active="probe">
    <ProbePage v-if="me" :account-id="me.id" :is-admin="me.is_admin" :nodes="nodes" :refreshing="refreshing" :updated-at="updatedAt" :failed="!!error" @refresh="refresh" @interval-change="changeIntervals" />
  </PageShell>
</template>
