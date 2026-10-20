<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../PageShell.vue'
import ProbePage from '../ProbePage.vue'
import { usePage } from '../page'
import { api, type ProbeNode } from '../api'

const nodes = ref<ProbeNode[]>([])
const refreshing = ref(false)
const updatedAt = ref<number | null>(null)
let pending: Promise<void> | null = null

function loadNodes(): Promise<void> {
  if (pending) return pending
  refreshing.value = true
  pending = api<ProbeNode[]>('node-status')
    .then(result => { nodes.value = result; updatedAt.value = Date.now() })
    .finally(() => { refreshing.value = false; pending = null })
  return pending
}
const { me, loading, error, refresh } = usePage(loadNodes, { interval: 5000 })
</script>

<template>
  <PageShell :me="me" :loading="loading" :error="error" active="probe">
    <ProbePage :nodes="nodes" :refreshing="refreshing" :updated-at="updatedAt" :failed="!!error" @refresh="refresh" />
  </PageShell>
</template>
