<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { bytes, type ProbeNode } from './api'
import Icon from './Icon.vue'
import { probeCounter, probePercent, readProbeCounter as metric, type ProbeReadyFlag } from './probe-metrics'

const props = withDefaults(defineProps<{
  nodes: ProbeNode[]
  refreshing?: boolean
  updatedAt?: number | null
  failed?: boolean
}>(), { refreshing: false, updatedAt: null, failed: false })
defineEmits<{ refresh: [] }>()

type SortBy = 'default' | 'name' | 'status' | 'cpu' | 'network'
const query = ref('')
const activeGroup = ref<number | null>(null)
const layout = ref<'cards' | 'table'>('cards')
const sortBy = ref<SortBy>('default')
const descending = ref(false)
const groups = computed(() => {
  const map = new Map<number, { id: number; name: string; nodes: ProbeNode[] }>()
  for (const node of props.nodes) {
    if (!map.has(node.group_id)) map.set(node.group_id, { id: node.group_id, name: node.group_name, nodes: [] })
    map.get(node.group_id)!.nodes.push(node)
  }
  return [...map.values()]
})
watch(groups, value => {
  if (activeGroup.value !== null && !value.some(group => group.id === activeGroup.value)) activeGroup.value = null
})
watch(sortBy, value => { descending.value = value === 'cpu' || value === 'network' })

function online(node: ProbeNode) { return node.online && node.enabled }
function ready(node: ProbeNode, flag: ProbeReadyFlag) { return online(node) && node.metrics?.[flag] === true }
function status(node: ProbeNode) { return !node.enabled ? '维护中' : node.online ? '在线' : '离线' }
function number(value?: number | null) { return probeCounter(value) ?? 0 }
function decimal(value?: number | null) { const counter = probeCounter(value); return counter === null ? '—' : counter.toFixed(2) }
function color(value: number) { return value >= 90 ? 'var(--el-color-danger)' : value >= 75 ? 'var(--el-color-warning)' : 'var(--el-color-primary)' }
function waiting(node: ProbeNode) { return online(node) ? '等待采样' : !node.enabled ? '维护中' : '节点离线' }
function resources(node: ProbeNode) {
  const metrics = node.metrics
  const cpuValue = metric(node, 'cpu_ready', 'cpu_percent')
  const cpu = cpuValue === null ? null : Math.min(100, cpuValue)
  const memory = probePercent(metric(node, 'memory_ready', 'memory_used'), metric(node, 'memory_ready', 'memory_total'))
  const disk = probePercent(metric(node, 'disk_ready', 'disk_used'), metric(node, 'disk_ready', 'disk_total'))
  return [
    { label: 'CPU', value: cpu, detail: cpu !== null ? '处理器使用率' : waiting(node) },
    { label: '内存', value: memory, detail: memory !== null ? `${bytes(number(metrics?.memory_used))} / ${bytes(number(metrics?.memory_total))}` : waiting(node) },
    { label: '硬盘', value: disk, detail: disk !== null ? `${bytes(number(metrics?.disk_used))} / ${bytes(number(metrics?.disk_total))}` : waiting(node) },
  ]
}
function network(node: ProbeNode, direction: 'rx_mbps' | 'tx_mbps') {
  const value = metric(node, 'network_ready', direction)
  return value === null ? '—' : `${decimal(value)} Mbps`
}
function connections(node: ProbeNode) {
  const tcp = metric(node, 'connections_ready', 'tcp_connections'), udp = metric(node, 'connections_ready', 'udp_sockets')
  return tcp === null || udp === null ? '—' : tcp + udp
}
function connectionDetail(node: ProbeNode) {
  return connections(node) === '—' ? waiting(node) : `TCP ${number(node.metrics?.tcp_connections)} · UDP ${number(node.metrics?.udp_sockets)}`
}
function loadDetail(node: ProbeNode) {
  return ready(node, 'load_ready') ? (['load1', 'load5', 'load15'] as const).map(field => decimal(metric(node, 'load_ready', field))).join(' / ') : '—'
}
function timestamp(value?: string | number | null) {
  if (value == null) return '暂无采样'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无采样'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
function sortableValue(node: ProbeNode): number | null {
  if (sortBy.value === 'status') return online(node) ? 0 : node.enabled ? 1 : 2
  if (sortBy.value === 'cpu') return metric(node, 'cpu_ready', 'cpu_percent')
  if (sortBy.value === 'network') {
    const rx = metric(node, 'network_ready', 'rx_mbps'), tx = metric(node, 'network_ready', 'tx_mbps')
    return rx === null || tx === null ? null : rx + tx
  }
  return null
}
function compare(a: ProbeNode, b: ProbeNode) {
  if (sortBy.value === 'default') return 0
  let result: number
  if (sortBy.value === 'name') result = a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  else {
    const left = sortableValue(a), right = sortableValue(b)
    // Missing and offline measurements stay below available readings in either direction.
    if (left === null || right === null) return left === right ? a.name.localeCompare(b.name, 'zh-CN') : left === null ? 1 : -1
    result = left - right
  }
  return (descending.value ? -result : result) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
}
const filteredGroups = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return groups.value
    .filter(group => activeGroup.value === null || group.id === activeGroup.value)
    .map(group => ({
      ...group,
      nodes: group.nodes.filter(node => !search || `${node.name} ${node.group_name}`.toLocaleLowerCase().includes(search)).sort(compare),
    }))
    .filter(group => group.nodes.length > 0)
})
// A node may belong to several entitled groups; do not count its traffic more than once.
const visibleNodes = computed(() => [...new Map(filteredGroups.value.flatMap(group => group.nodes).map(node => [node.id, node])).values()])
const onlineCount = computed(() => visibleNodes.value.filter(online).length)
const measuredNetwork = computed(() => visibleNodes.value.filter(node => metric(node, 'network_ready', 'rx_mbps') !== null && metric(node, 'network_ready', 'tx_mbps') !== null))
const totalReceive = computed(() => measuredNetwork.value.length ? `${decimal(measuredNetwork.value.reduce((sum, node) => sum + number(node.metrics?.rx_mbps), 0))} Mbps` : '—')
const totalSend = computed(() => measuredNetwork.value.length ? `${decimal(measuredNetwork.value.reduce((sum, node) => sum + number(node.metrics?.tx_mbps), 0))} Mbps` : '—')
const refreshStatus = computed(() => props.refreshing ? '正在更新…' : props.failed ? '更新失败，等待重试' : props.updatedAt ? `更新于 ${timestamp(props.updatedAt)}` : '等待首次更新')
function resetFilters() { query.value = ''; activeGroup.value = null }
</script>

<template>
  <div class="nyp-monitor">
    <header class="monitor-heading">
      <div><h2>节点状态</h2><p>查看服务器运行状态与实时网络流量</p></div>
      <div class="monitor-refresh">
        <span class="monitor-live" :class="{ failed }" role="status" aria-live="polite"><i></i>{{ refreshStatus }}</span>
        <el-button :loading="refreshing" @click="$emit('refresh')"><Icon v-if="!refreshing" name="refresh" />刷新</el-button>
      </div>
    </header>
    <section class="monitor-summary" aria-label="当前筛选的节点概况">
      <div class="surface"><span>节点总数</span><strong>{{ visibleNodes.length }}<small>台</small></strong></div>
      <div class="surface"><span>在线节点</span><strong class="online-total">{{ onlineCount }}<small>/ {{ visibleNodes.length }}</small></strong></div>
      <div class="surface"><span>↓ 实时接收</span><strong class="network-total">{{ totalReceive }}</strong></div>
      <div class="surface"><span>↑ 实时发送</span><strong class="network-total">{{ totalSend }}</strong></div>
    </section>
    <section class="surface monitor-controls">
      <div class="monitor-toolbar">
        <el-input v-model="query" class="monitor-search" clearable placeholder="搜索节点或节点组" aria-label="搜索节点或节点组"><template #prefix><Icon name="search" /></template></el-input>
        <div class="monitor-sort">
          <el-select v-model="sortBy" aria-label="节点排序方式">
            <el-option label="默认排序" value="default" />
            <el-option label="按名称排序" value="name" />
            <el-option label="按状态排序" value="status" />
            <el-option label="按 CPU 排序" value="cpu" />
            <el-option label="按实时流量排序" value="network" />
          </el-select>
          <el-button :disabled="sortBy === 'default'" :title="descending ? '降序，点击切换升序' : '升序，点击切换降序'" :aria-label="descending ? '切换升序' : '切换降序'" @click="descending = !descending"><span>{{ descending ? '↓' : '↑' }}</span></el-button>
        </div>
        <div class="monitor-layout" role="group" aria-label="节点显示方式">
          <button :class="{ active: layout === 'cards' }" :aria-pressed="layout === 'cards'" @click="layout = 'cards'"><Icon name="node" />卡片</button>
          <button :class="{ active: layout === 'table' }" :aria-pressed="layout === 'table'" @click="layout = 'table'"><Icon name="rules" />列表</button>
        </div>
      </div>
      <div class="monitor-group-filter" role="group" aria-label="按节点组筛选">
        <span>节点组</span>
        <div class="monitor-group-tabs">
          <button :class="{ active: activeGroup === null }" :aria-pressed="activeGroup === null" @click="activeGroup = null">全部</button>
          <button v-for="group in groups" :key="group.id" :class="{ active: activeGroup === group.id }" :aria-pressed="activeGroup === group.id" @click="activeGroup = group.id">{{ group.name || '未命名节点组' }}<small>{{ group.nodes.length }}</small></button>
        </div>
      </div>
    </section>
    <div class="monitor-caption">
      <span>当前显示 {{ visibleNodes.length }} 台节点 · {{ filteredGroups.length }} 个节点组<span v-if="measuredNetwork.length"> · {{ measuredNetwork.length }} 台有网络采样</span></span>
      <span>自动刷新 · 5 秒</span>
    </div>
    <div v-if="!filteredGroups.length" class="surface monitor-empty">
      <el-empty :description="nodes.length ? '没有找到匹配的节点' : failed ? '节点状态加载失败，请刷新重试' : '当前套餐暂无可查看的节点组'">
        <el-button v-if="nodes.length" @click="resetFilters">清除筛选</el-button>
        <el-button v-else-if="failed" :loading="refreshing" @click="$emit('refresh')">重试</el-button>
      </el-empty>
    </div>
    <section v-for="group in filteredGroups" :key="group.id" class="monitor-group">
      <div class="monitor-group-heading"><Icon name="folder" /><h3>{{ group.name || '未命名节点组' }}</h3><span>{{ group.nodes.filter(online).length }} / {{ group.nodes.length }} 在线</span></div>
      <div v-if="layout === 'cards'" class="monitor-card-grid">
        <article v-for="node in group.nodes" :key="node.id" class="surface monitor-card" :class="{ 'is-offline': !online(node) }">
          <header class="monitor-card-heading"><strong>{{ node.name }}</strong><span class="monitor-status" :class="{ online: online(node), maintenance: !node.enabled }"><i></i>{{ status(node) }}</span></header>
          <div class="monitor-card-system"><span>最近采样</span><time>{{ timestamp(node.updated_at) }}</time></div>
          <div class="monitor-resources">
            <div v-for="resource in resources(node)" :key="resource.label" class="monitor-resource">
              <div><span>{{ resource.label }}</span><b>{{ resource.value === null ? '—' : resource.value.toFixed(2) + '%' }}</b></div>
              <el-progress :percentage="resource.value ?? 0" :show-text="false" :stroke-width="6" :color="color(resource.value ?? 0)" />
              <small>{{ resource.detail }}</small>
            </div>
          </div>
          <div class="monitor-network">
            <div><span>↓ 接收</span><b>{{ network(node, 'rx_mbps') }}</b></div>
            <div><span>↑ 发送</span><b>{{ network(node, 'tx_mbps') }}</b></div>
          </div>
          <div class="monitor-card-stats">
            <div><span>连接数</span><b :title="connectionDetail(node)">{{ connections(node) }}</b><small>{{ connectionDetail(node) }}</small></div>
            <div><span>负载</span><b>{{ ready(node, 'load_ready') ? decimal(node.metrics?.load1) : '—' }}</b><small>{{ loadDetail(node) }}<span v-if="ready(node, 'load_ready')"> · 1 / 5 / 15 分钟</span></small></div>
          </div>
        </article>
      </div>
      <div v-else class="surface monitor-table-wrap">
        <table class="monitor-table">
          <caption class="monitor-sr-only">{{ group.name }} 节点运行状态</caption>
          <thead><tr><th scope="col">节点</th><th scope="col">状态</th><th scope="col">CPU</th><th scope="col">内存</th><th scope="col">硬盘</th><th scope="col">实时网络</th><th scope="col">连接数</th><th scope="col">负载 (1 / 5 / 15)</th></tr></thead>
          <tbody>
            <tr v-for="node in group.nodes" :key="node.id" :class="{ 'is-offline': !online(node) }">
              <th scope="row"><strong>{{ node.name }}</strong><small>{{ timestamp(node.updated_at) }}</small></th>
              <td><span class="monitor-status" :class="{ online: online(node), maintenance: !node.enabled }"><i></i>{{ status(node) }}</span></td>
              <td v-for="resource in resources(node)" :key="resource.label"><div class="monitor-table-resource"><b>{{ resource.value === null ? '—' : resource.value.toFixed(2) + '%' }}</b><el-progress :percentage="resource.value ?? 0" :show-text="false" :stroke-width="5" :color="color(resource.value ?? 0)" /><small>{{ resource.detail }}</small></div></td>
              <td class="monitor-table-network"><span>↓ {{ network(node, 'rx_mbps') }}</span><span>↑ {{ network(node, 'tx_mbps') }}</span></td>
              <td><b>{{ connections(node) }}</b><small>{{ connectionDetail(node) }}</small></td>
              <td class="monitor-table-load">{{ loadDetail(node) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nyp-monitor { padding: 4px 0 20px; }
.monitor-heading, .monitor-refresh, .monitor-live, .monitor-toolbar, .monitor-sort, .monitor-layout, .monitor-group-filter, .monitor-group-tabs, .monitor-caption, .monitor-group-heading, .monitor-card-heading, .monitor-card-system { display: flex; align-items: center; }
.monitor-heading { justify-content: space-between; gap: 18px; margin-bottom: 20px; }
.monitor-heading h2 { margin: 0 0 7px; font-size: 22px; font-weight: 600; }
.monitor-heading p { margin: 0; font-size: 13px; color: var(--muted); }
.monitor-refresh { justify-content: flex-end; gap: 12px; flex-wrap: wrap; }
.monitor-live { gap: 7px; color: var(--muted); font-size: 12px; }
.monitor-live i { width: 6px; height: 6px; border-radius: 50%; background: var(--el-color-success); }
.monitor-live.failed i { background: var(--el-color-warning); }
.monitor-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.monitor-summary > div { padding: 17px 20px; }
.monitor-summary > div > span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 10px; }
.monitor-summary strong { font-size: 25px; line-height: 1.3; font-weight: 600; font-variant-numeric: tabular-nums; }
.monitor-summary strong small { margin-left: 8px; color: var(--muted); font-size: 12px; font-weight: 400; }
.monitor-summary .online-total { color: var(--el-color-success); }
.monitor-summary .network-total { font-size: 21px; }
.monitor-controls { padding: 16px; }
.monitor-toolbar { gap: 12px; }
.monitor-search { max-width: 360px; flex: 1; }
.monitor-sort { gap: 4px; margin-left: auto; }
.monitor-sort .el-select { width: 160px; }
.monitor-sort > .el-button { padding: 7px 11px; font-size: 17px; }
.monitor-layout { align-self: stretch; background: var(--el-fill-color-light); padding: 3px; border: 1px solid var(--border); border-radius: 6px; gap: 2px; }
.monitor-layout button { display: flex; align-items: center; gap: 6px; background: transparent; border: 0; border-radius: 4px; color: var(--muted); padding: 4px 9px; font-size: 12px; white-space: nowrap; }
.monitor-layout button.active { color: var(--el-color-primary); background: var(--surface); box-shadow: 0 1px 3px #0000000a; }
.monitor-group-filter { gap: 14px; margin-top: 15px; padding-top: 14px; border-top: 1px solid var(--border); }
.monitor-group-filter > span { color: var(--muted); flex-shrink: 0; font-size: 12px; }
.monitor-group-tabs { overflow-x: auto; gap: 6px; padding: 3px; }
.monitor-group-tabs button { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; border: 1px solid transparent; border-radius: 5px; padding: 5px 10px; font-size: 12px; color: var(--el-text-color-regular); background: transparent; }
.monitor-group-tabs button.active { border-color: var(--el-color-primary-light-7); background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.monitor-group-tabs small { font-size: 11px; opacity: .7; }
.monitor-caption { justify-content: space-between; gap: 10px; color: var(--muted); font-size: 12px; margin: 13px 1px 21px; }
.monitor-empty { padding: 25px; }
.monitor-group { margin: 0 0 25px; }
.monitor-group-heading { gap: 8px; margin: 0 0 12px; }
.monitor-group-heading > .ui-icon { color: var(--muted); }
.monitor-group-heading h3 { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.monitor-group-heading > span { margin-left: auto; font-size: 12px; color: var(--muted); white-space: nowrap; }
.monitor-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 14px; }
.monitor-card { padding: 16px; border-radius: 8px; }
.monitor-card-heading { justify-content: space-between; gap: 10px; margin-bottom: 13px; }
.monitor-card-heading > strong { min-width: 0; overflow-wrap: anywhere; font-size: 15px; font-weight: 600; }
.monitor-status { display: inline-flex; align-items: center; flex-shrink: 0; gap: 5px; color: var(--el-color-danger); background: var(--el-color-danger-light-9); padding: 3px 8px; border-radius: 20px; font-size: 11px; line-height: 1.6; white-space: nowrap; }
.monitor-status i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.monitor-status.online { color: var(--el-color-success); background: var(--el-color-success-light-9); }
.monitor-status.maintenance { color: var(--el-color-warning); background: var(--el-color-warning-light-9); }
.monitor-card-system { justify-content: space-between; gap: 10px; padding: 10px 0 12px; border-top: 1px solid var(--border); color: var(--muted); font-size: 11px; }
.monitor-resources { display: grid; gap: 11px; }
.monitor-resource > div:first-child { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 5px; font-size: 12px; }
.monitor-resource b, .monitor-card-stats b, .monitor-table b { font-weight: 500; font-variant-numeric: tabular-nums; }
.monitor-resource > small { display: block; margin-top: 4px; color: var(--muted); font-size: 11px; text-align: right; min-height: 15px; }
.monitor-network { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 13px; padding: 12px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.monitor-network > div { display: flex; flex-direction: column; gap: 6px; }
.monitor-network span { color: var(--muted); font-size: 11px; }
.monitor-network b { font-weight: 500; font-size: 15px; font-variant-numeric: tabular-nums; }
.monitor-card-stats { display: grid; gap: 10px; padding-top: 12px; }
.monitor-card-stats > div { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 3px 8px; font-size: 12px; }
.monitor-card-stats > div > span { color: var(--muted); }
.monitor-card-stats b { text-align: right; }
.monitor-card-stats small { grid-column: 1 / -1; text-align: right; color: var(--muted); font-size: 10px; }
.monitor-card.is-offline .monitor-resources, .monitor-card.is-offline .monitor-network, .monitor-card.is-offline .monitor-card-stats { opacity: .6; }
.monitor-table-wrap { overflow-x: auto; }
.monitor-table { border-collapse: collapse; width: 100%; min-width: 1020px; text-align: left; font-size: 12px; }
.monitor-table th, .monitor-table td { padding: 15px; border-bottom: 1px solid var(--border); }
.monitor-table thead th { background: var(--el-fill-color-light); font-weight: 500; color: var(--muted); white-space: nowrap; }
.monitor-table tbody tr:last-child > * { border-bottom: 0; }
.monitor-table tbody tr:hover { background: var(--el-fill-color-lighter); }
.monitor-table tbody th { min-width: 150px; max-width: 260px; font-weight: 400; }
.monitor-table tbody th strong { display: block; overflow-wrap: anywhere; font-weight: 500; margin-bottom: 5px; }
.monitor-table small { display: block; margin-top: 5px; color: var(--muted); font-size: 10px; white-space: nowrap; }
.monitor-table-resource { min-width: 110px; display: grid; gap: 5px; }
.monitor-table-resource small { margin: 0; }
.monitor-table-network span { display: block; font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1.9; }
.monitor-table-load { white-space: nowrap; font-variant-numeric: tabular-nums; }
.monitor-table .is-offline td:not(:first-of-type) { color: var(--muted); }
.monitor-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
@media(max-width: 980px) {
  .monitor-heading { align-items: flex-start; }
  .monitor-refresh { flex-direction: column-reverse; align-items: flex-end; gap: 8px; }
  .monitor-summary > div { padding: 15px; }
  .monitor-summary .network-total { font-size: 17px; }
  .monitor-toolbar { flex-wrap: wrap; }
  .monitor-search { max-width: none; flex-basis: calc(100% - 225px); }
}
@media(max-width: 600px) {
  .monitor-heading h2 { font-size: 20px; }
  .monitor-heading p { max-width: 170px; line-height: 1.7; }
  .monitor-live { max-width: 160px; font-size: 10px; }
  .monitor-live i { flex-shrink: 0; }
  .monitor-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .monitor-summary strong { font-size: 22px; }
  .monitor-controls { padding: 12px; }
  .monitor-search { flex-basis: 100%; }
  .monitor-sort { margin-left: 0; flex: 1; }
  .monitor-sort .el-select { width: 100%; }
  .monitor-layout { margin-left: auto; }
  .monitor-caption { align-items: flex-start; line-height: 1.6; font-size: 11px; }
  .monitor-caption > span:last-child { white-space: nowrap; }
  .monitor-group-filter { gap: 7px; }
}
</style>
