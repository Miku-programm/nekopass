<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { bytes, type ProbeNode } from './api'
import Icon from './Icon.vue'
import ProbeProgress from './ProbeProgress.vue'
import { probePercent, readProbeCounter as metric } from './probe-metrics'
import { setTheme, theme } from './theme'
import { createDefaultPreferences, loadPreferences, savePreferences, clearPreferences, subscribePreferences, sortNodes, reconcileManualOrder, normalizeIntervals, MIN_INTERVAL, MAX_INTERVAL, type ProbePreferences, type GroupPreference } from './probe-preferences'

const props = withDefaults(defineProps<{ nodes: ProbeNode[]; accountId?: number; isAdmin?: boolean; refreshing?: boolean; updatedAt?: number | null; failed?: boolean }>(), { isAdmin: false, refreshing: false, updatedAt: null, failed: false })
const emit = defineEmits<{ refresh: []; 'interval-change': [value: { foreground: number; background: number }] }>()
const preferences = ref<ProbePreferences>(createDefaultPreferences())
const selectedGroupId = ref<number | null>(null)
const settingsOpen = ref(false), settingsMenu = ref<HTMLElement>(), settingsButton = ref<HTMLButtonElement>()
const sortingMode = ref(false), sortDraft = ref<Record<string, GroupPreference>>({})
const infoOpen = ref(false), selectedNode = ref<ProbeNode | null>(null), draftNote = ref('')
const refreshOpen = ref(false), foregroundInput = ref(2000), backgroundInput = ref(10000)
const clearOpen = ref(false)
const adminView = computed(() => props.isAdmin && preferences.value.adminView)
let unsubscribe: (() => void) | undefined
watch(() => props.accountId, id => {
  unsubscribe?.()
  sortingMode.value = false
  preferences.value = id ? loadPreferences(id) : createDefaultPreferences()
  emit('interval-change', preferences.value.intervals)
  if (id) unsubscribe = subscribePreferences(id, value => {
    if (sortingMode.value) ElMessage.info('其他标签页已更新探针偏好，未保存的排序修改已取消。')
    preferences.value = value
    sortingMode.value = false
    stopDragging()
    emit('interval-change', value.intervals)
  })
}, { immediate: true })
onUnmounted(() => { unsubscribe?.(); stopDragging() })
function persist(value: ProbePreferences) {
  if (!props.accountId || !savePreferences(props.accountId, value)) {
    ElMessage.error('无法保存本地偏好，请检查浏览器存储设置。')
    return false
  }
  preferences.value = value
  return true
}
const groups = computed(() => {
  const map = new Map<number, { id: number; name: string; nodes: ProbeNode[] }>()
  for (const node of props.nodes) {
    if (!map.has(node.group_id)) map.set(node.group_id, { id: node.group_id, name: node.group_name || '未命名分组', nodes: [] })
    const group = map.get(node.group_id)!
    if (!group.nodes.some(item => item.id === node.id)) group.nodes.push(node)
  }
  return [...map.values()]
})
watch(groups, values => { if (selectedGroupId.value !== null && !values.some(group => group.id === selectedGroupId.value)) selectedGroupId.value = null })
function groupPreference(id: number) { return (sortingMode.value ? sortDraft.value : preferences.value.groups)[String(id)] }
const visibleGroups = computed(() => groups.value.filter(group => selectedGroupId.value === null || group.id === selectedGroupId.value).map(group => ({ ...group, nodes: sortNodes(group.nodes, groupPreference(group.id)) })))
const uniqueNodes = computed(() => [...new Map(visibleGroups.value.flatMap(group => group.nodes).map(node => [node.id, node])).values()])
const onlineCount = computed(() => uniqueNodes.value.filter(online).length)
const selectedGroup = computed(() => groups.value.find(group => group.id === selectedGroupId.value))
const displayMode = computed(() => preferences.value.serverDisplayMode)
const note = (node: ProbeNode) => preferences.value.notes[String(node.id)] || ''
const title = (node: ProbeNode) => preferences.value.titlePriority === 'note' && note(node) ? note(node).replace(/\s+/g, ' ') : node.name
function online(node: ProbeNode) { return node.enabled && node.online }
function status(node: ProbeNode) { return !node.enabled ? '维护中' : node.online ? '在线' : '离线' }
function timestamp(value?: string | number | null) {
  if (value == null) return '暂无数据'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '暂无数据' : date.toLocaleString('zh-CN', { hour12: false })
}
function rate(value: number | null) {
  if (value === null) return '—'
  if (value >= 1000) return (value / 1000).toFixed(2) + ' Gbps'
  if (value > 0 && value < 1) return (value * 1000).toFixed(2) + ' Kbps'
  return value.toFixed(2) + ' Mbps'
}
function network(node: ProbeNode, direction: 'rx_mbps' | 'tx_mbps') { return rate(metric(node, 'network_ready', direction)) }
function groupNetwork(nodes: ProbeNode[], direction: 'rx_mbps' | 'tx_mbps') {
  const readings = nodes.map(node => metric(node, 'network_ready', direction)).filter((value): value is number => value !== null)
  return rate(readings.length ? readings.reduce((sum, value) => sum + value, 0) : null)
}
function resources(node: ProbeNode) {
  const cpu = metric(node, 'cpu_ready', 'cpu_percent')
  const memoryUsed = metric(node, 'memory_ready', 'memory_used'), memoryTotal = metric(node, 'memory_ready', 'memory_total')
  const diskUsed = metric(node, 'disk_ready', 'disk_used'), diskTotal = metric(node, 'disk_ready', 'disk_total')
  const unavailable = online(node) ? '等待采样' : status(node)
  return [
    { label: 'CPU', value: cpu === null ? null : Math.min(100, cpu), detail: cpu === null ? unavailable : `LoadAvg：${load(node)}` },
    { label: '内存', value: probePercent(memoryUsed, memoryTotal), detail: memoryUsed !== null && memoryTotal ? `${bytes(memoryUsed)} / ${bytes(memoryTotal)}` : unavailable },
    { label: '磁盘', value: probePercent(diskUsed, diskTotal), detail: diskUsed !== null && diskTotal ? `${bytes(diskUsed)} / ${bytes(diskTotal)}` : unavailable },
  ]
}
function load(node: ProbeNode) { return (['load1', 'load5', 'load15'] as const).map(field => { const value = metric(node, 'load_ready', field); return value === null ? '—' : value.toFixed(2) }).join(' / ') }
function connections(node: ProbeNode) {
  const tcp = metric(node, 'connections_ready', 'tcp_connections'), udp = metric(node, 'connections_ready', 'udp_sockets')
  return `TCP ${tcp === null ? '—' : tcp} · UDP ${udp === null ? '—' : udp}`
}
const refreshText = computed(() => props.refreshing ? '正在更新…' : props.failed ? '更新失败，正在重试' : props.updatedAt ? `更新于 ${new Date(props.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '等待首次更新')
function toggleDisplayMode() { persist({ ...preferences.value, serverDisplayMode: displayMode.value === 'table' ? 'cards' : 'table' }); settingsOpen.value = false }
function toggleTheme() { setTheme(theme.dark ? 'light' : 'dark'); settingsOpen.value = false }
function toggleAdminView() { persist({ ...preferences.value, adminView: !preferences.value.adminView }); settingsOpen.value = false }
function changeTitlePriority(event: Event) {
  const select = event.target as HTMLSelectElement
  const value = select.value === 'note' ? 'note' : 'name'
  if (!persist({ ...preferences.value, titlePriority: value })) select.value = preferences.value.titlePriority
}
function openInfo(node: ProbeNode) { selectedNode.value = node; draftNote.value = note(node); infoOpen.value = true }
const noteDirty = computed(() => !!selectedNode.value && draftNote.value !== note(selectedNode.value))
async function closeInfo(done?: () => void) {
  if (noteDirty.value) {
    try { await ElMessageBox.confirm('备注尚未保存，确定放弃修改吗？', '放弃修改', { confirmButtonText: '放弃', cancelButtonText: '继续编辑', type: 'warning' }) } catch { return }
  }
  infoOpen.value = false
  done?.()
}
function saveNote() {
  if (!selectedNode.value) return
  const notes = { ...preferences.value.notes }, value = Array.from(draftNote.value.trim()).slice(0, 200).join('')
  if (value) notes[String(selectedNode.value.id)] = value
  else delete notes[String(selectedNode.value.id)]
  if (persist({ ...preferences.value, notes })) { infoOpen.value = false; ElMessage.success('备注已保存到此浏览器') }
}
function beginSorting() {
  sortDraft.value = JSON.parse(JSON.stringify(preferences.value.groups))
  sortingMode.value = true
  settingsOpen.value = false
}
function cancelSorting() { sortingMode.value = false; sortDraft.value = {}; stopDragging() }
function commitSorting() {
  if (persist({ ...preferences.value, groups: sortDraft.value })) { cancelSorting(); ElMessage.success('排序修改已保存') }
}
function setSort(id: number, command: string) {
  const group = groups.value.find(group => group.id === id)
  if (!group) return
  const current = groupPreference(id)
  if (command === 'manual') sortDraft.value[String(id)] = { mode: 'manual', manualOrder: reconcileManualOrder(group.nodes, sortNodes(group.nodes, current).map(node => node.id)) }
  else if (command === 'default') sortDraft.value[String(id)] = { mode: 'default' }
  else if (command === 'reverse') sortDraft.value[String(id)] = { ...current!, direction: current?.direction === 'desc' ? 'asc' : 'desc' }
  else if (['name', 'cpu', 'network', 'updated'].includes(command)) sortDraft.value[String(id)] = { mode: 'rule', field: command as GroupPreference['field'], direction: command === 'name' ? 'asc' : 'desc' }
}
function sortLabel(id: number) {
  const value = groupPreference(id)
  if (!value || value.mode === 'default') return '排序：默认'
  if (value.mode === 'manual') return '排序：手动'
  const label = { name: '节点名称', cpu: 'CPU 使用率', network: '实时流量', updated: '最近采样' }[value.field || 'name']
  return `排序：${label} ${value.direction === 'desc' ? '↓' : '↑'}`
}
function isManual(id: number) { return sortingMode.value && groupPreference(id)?.mode === 'manual' }
function moveNode(groupId: number, nodeId: number, offset: number) {
  const group = visibleGroups.value.find(group => group.id === groupId)
  if (!group || !isManual(groupId)) return
  const order = group.nodes.map(node => node.id), from = order.indexOf(nodeId), to = from + offset
  if (from < 0 || to < 0 || to >= order.length) return
  order.splice(from, 1); order.splice(to, 0, nodeId)
  sortDraft.value[String(groupId)] = { mode: 'manual', manualOrder: order }
}
const dragging = ref<{ groupId: number; nodeId: number; over: number; moved: boolean } | null>(null)
let dragStart = { x: 0, y: 0 }, dragPointer: number | null = null, dragHandle: HTMLElement | null = null
function startDragging(event: PointerEvent, groupId: number, nodeId: number) {
  if (!isManual(groupId) || event.button !== 0) return
  event.preventDefault()
  dragHandle = event.currentTarget as HTMLElement
  dragHandle.focus()
  try { dragHandle.setPointerCapture(event.pointerId) } catch { /* Window blur still cancels a pointer outside this document. */ }
  dragPointer = event.pointerId; dragStart = { x: event.clientX, y: event.clientY }
  dragging.value = { groupId, nodeId, over: nodeId, moved: false }
  window.addEventListener('pointermove', dragMove, { passive: false })
  window.addEventListener('pointerup', finishDragging)
  window.addEventListener('pointercancel', stopDragging)
  window.addEventListener('blur', stopDragging)
}
function dragMove(event: PointerEvent) {
  if (event.pointerId !== dragPointer || !dragging.value) return
  event.preventDefault()
  if (Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 5 && !dragging.value.moved) return
  dragging.value.moved = true
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-probe-node-id]')
  if (target?.closest<HTMLElement>('[data-probe-group-id]')?.dataset.probeGroupId === String(dragging.value.groupId)) dragging.value.over = Number(target.dataset.probeNodeId)
}
function finishDragging(event: PointerEvent) {
  if (event.pointerId !== dragPointer) return
  const drag = dragging.value
  if (drag?.moved) {
    const nodes = visibleGroups.value.find(group => group.id === drag.groupId)?.nodes || []
    moveNode(drag.groupId, drag.nodeId, nodes.findIndex(node => node.id === drag.over) - nodes.findIndex(node => node.id === drag.nodeId))
  }
  stopDragging()
}
function stopDragging() {
  if (dragHandle && dragPointer !== null && dragHandle.hasPointerCapture(dragPointer)) dragHandle.releasePointerCapture(dragPointer)
  dragHandle = null
  dragging.value = null; dragPointer = null
  window.removeEventListener('pointermove', dragMove)
  window.removeEventListener('pointerup', finishDragging)
  window.removeEventListener('pointercancel', stopDragging)
  window.removeEventListener('blur', stopDragging)
}
function openRefreshSettings() { foregroundInput.value = preferences.value.intervals.foreground; backgroundInput.value = preferences.value.intervals.background; refreshOpen.value = true; settingsOpen.value = false }
function saveRefreshSettings() {
  const values = [foregroundInput.value, backgroundInput.value]
  if (values.some(value => !Number.isInteger(value) || value < MIN_INTERVAL || value > MAX_INTERVAL)) { ElMessage.error(`刷新间隔须为 ${MIN_INTERVAL}–${MAX_INTERVAL} 毫秒的整数`); return }
  const intervals = normalizeIntervals({ foreground: foregroundInput.value, background: backgroundInput.value })
  if (persist({ ...preferences.value, intervals })) { emit('interval-change', intervals); refreshOpen.value = false; ElMessage.success('刷新间隔已更新') }
}
function resetPreferences() {
  if (!props.accountId || !clearPreferences(props.accountId)) { ElMessage.error('无法清空本地偏好'); return }
  preferences.value = createDefaultPreferences(); cancelSorting(); selectedGroupId.value = null
  emit('interval-change', preferences.value.intervals); clearOpen.value = false
  ElMessage.success('已恢复默认探针偏好')
}
async function focusSettings() { await nextTick(); settingsMenu.value?.querySelector<HTMLButtonElement>('button')?.focus() }
function menuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { settingsOpen.value = false; settingsButton.value?.focus(); event.preventDefault(); return }
  if ((event.target as HTMLElement).tagName === 'SELECT' || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const items = Array.from(settingsMenu.value?.querySelectorAll<HTMLElement>('button, select') || [])
  const index = items.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus(); event.preventDefault()
}
</script>

<template>
  <section class="nyp-probe" aria-label="节点状态（新）">
    <nav class="probe-navigation" aria-label="探针操作">
      <a class="probe-button transparent" href="/"><Icon name="home" />主页</a>
      <div class="navigation-spacer"></div>
      <template v-if="sortingMode"><button class="probe-button transparent" @click="cancelSorting">↶ 放弃修改</button><button class="probe-button primary" @click="commitSorting"><Icon name="check" />完成</button></template>
      <button class="probe-button transparent icon-only" aria-label="刷新节点状态" :disabled="refreshing" @click="emit('refresh')"><Icon name="refresh" :class="{ spinning: refreshing }" /></button>
      <el-popover v-model:visible="settingsOpen" trigger="click" placement="bottom-end" :width="224" popper-class="probe-settings-popper" @after-enter="focusSettings">
        <template #reference><button ref="settingsButton" class="probe-button transparent" aria-label="探针设置" aria-haspopup="menu" :aria-expanded="settingsOpen"><Icon name="settings" />设置</button></template>
        <div ref="settingsMenu" role="menu" class="probe-settings-menu" @keydown="menuKeydown">
          <button role="menuitem" @click="toggleDisplayMode"><Icon :name="displayMode === 'cards' ? 'rules' : 'node'" />切换为{{ displayMode === 'cards' ? '表格视图' : '卡片视图' }}</button>
          <button role="menuitem" @click="toggleTheme"><Icon name="moon" />切换深浅主题</button>
          <button v-if="isAdmin" role="menuitem" @click="toggleAdminView"><Icon name="user" />{{ adminView ? '切换到用户视角' : '切换到管理员视角' }}</button>
          <button role="menuitem" @click="openRefreshSettings"><Icon name="refresh" />刷新间隔设置</button>
          <div class="title-priority"><label for="probe-title-priority">节点标题优先显示</label><select id="probe-title-priority" :value="preferences.titlePriority" @change="changeTitlePriority"><option value="name">节点名称</option><option value="note">本地备注优先</option></select></div>
          <button role="menuitem" @click="beginSorting"><Icon name="switch" />进入排序模式</button><hr />
          <button role="menuitem" @click="settingsOpen = false; clearOpen = true"><Icon name="delete" />清空本地偏好…</button>
        </div>
      </el-popover>
    </nav>
    <section class="group-filter" aria-label="服务器分组筛选"><span>分组</span><div class="group-filter-tabs" role="tablist" aria-label="服务器分组"><button role="tab" :aria-selected="selectedGroupId === null" :class="{ active: selectedGroupId === null }" @click="selectedGroupId = null">所有</button><button v-for="group in groups" :key="group.id" role="tab" :aria-selected="selectedGroupId === group.id" :class="{ active: selectedGroupId === group.id }" @click="selectedGroupId = group.id">{{ group.name }}</button></div></section>
    <div class="probe-summary-row"><div class="group-filter-summary">{{ selectedGroup ? selectedGroup.name + ' 分组' : '所有分组' }}: 共 {{ uniqueNodes.length }} 个服务器，{{ onlineCount }} 个服务器在线</div><span class="probe-refresh-status" :class="{ failed }" role="status">{{ refreshText }}</span></div>
    <div v-if="!visibleGroups.length" class="probe-empty"><el-empty :description="failed ? '节点状态加载失败，请刷新重试' : '当前套餐暂无可查看的节点组'"><button v-if="failed" class="probe-button primary" :disabled="refreshing" @click="emit('refresh')">重试</button></el-empty></div>
    <div v-else :class="displayMode === 'cards' ? 'server-view-container' : 'table-container'">
      <section v-for="group in visibleGroups" :key="group.id" :data-probe-group-id="group.id" class="probe-group">
        <div class="group-heading"><span class="group-name">{{ group.name }} | ID: {{ group.id }}</span><div class="group-network"><span title="上传速率">↑ {{ groupNetwork(group.nodes, 'tx_mbps') }}</span><span title="下载速率">↓ {{ groupNetwork(group.nodes, 'rx_mbps') }}</span></div>
          <el-dropdown v-if="sortingMode" trigger="click" class="group-sort-menu" popper-class="probe-sort-popper" @command="(command: string) => setSort(group.id, command)"><button class="probe-button outlined" aria-label="组内排序">{{ sortLabel(group.id) }} ▾</button><template #dropdown><el-dropdown-menu><el-dropdown-item command="default">默认顺序</el-dropdown-item><el-dropdown-item command="manual">手动顺序</el-dropdown-item><el-dropdown-item command="name">节点名称 ↑</el-dropdown-item><el-dropdown-item command="cpu">CPU使用率 ↓</el-dropdown-item><el-dropdown-item command="network">实时流量 ↓</el-dropdown-item><el-dropdown-item command="updated">最近采样 ↓</el-dropdown-item><el-dropdown-item v-if="groupPreference(group.id)?.mode === 'rule'" command="reverse" divided>切换升序／降序</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
        </div>
        <div v-if="displayMode === 'cards'" class="server-card-grid">
          <article v-for="(node, index) in group.nodes" :key="node.id" class="server-card" :data-probe-node-id="node.id" :class="{ 'is-offline': !online(node), 'is-drag-source': dragging?.groupId === group.id && dragging.nodeId === node.id, 'is-drop-target': dragging?.groupId === group.id && dragging.over === node.id && dragging.nodeId !== node.id }">
            <header class="server-card-header"><div class="server-card-title"><span class="server-symbol" aria-hidden="true"><Icon name="node" /></span><strong :title="node.name + (note(node) ? '\n本地备注：' + note(node) : '')">{{ title(node) }}</strong><div v-if="isManual(group.id)" class="server-sort-actions"><button class="drag-handle" aria-label="拖动调整顺序" title="拖动排序，或使用方向键移动" :aria-pressed="dragging?.nodeId === node.id && dragging.groupId === group.id" @pointerdown="startDragging($event, group.id, node.id)" @keydown.up.prevent="moveNode(group.id,node.id,-1)" @keydown.down.prevent="moveNode(group.id,node.id,1)" @keydown.left.prevent="moveNode(group.id,node.id,-1)" @keydown.right.prevent="moveNode(group.id,node.id,1)" @keydown.esc="stopDragging">⠿</button><button aria-label="上移" :disabled="index === 0" @click="moveNode(group.id,node.id,-1)">↑</button><button aria-label="下移" :disabled="index === group.nodes.length-1" @click="moveNode(group.id,node.id,1)">↓</button></div></div></header>
            <div class="server-card-system" title="当前节点接口尚未上报操作系统信息"><span>OS</span><b>暂无数据</b></div>
            <section class="server-card-resources" aria-label="资源使用情况"><div v-for="resource in resources(node)" :key="resource.label" class="server-card-metric" :title="resource.detail"><div><span>{{ resource.label }}</span><b>{{ resource.value === null ? '—' : resource.value.toFixed(1) + '%' }}</b></div><ProbeProgress :value="resource.value" :label="resource.label" variant="card" /></div></section>
            <section class="server-card-stats"><div title="当前节点接口尚未上报累计网卡流量"><span>总流量</span><b>↑ —　↓ —</b></div><div :title="connections(node)"><span>网络</span><b>↑ {{ network(node, 'tx_mbps') }}　↓ {{ network(node, 'rx_mbps') }}</b></div><div :title="online(node) ? '当前节点接口尚未上报开机时间；最近采样：' + timestamp(node.updated_at) : '最近采样：' + timestamp(node.updated_at)"><span>{{ online(node) ? '运行时间' : '最后上报' }}</span><b>{{ online(node) ? '—' : timestamp(node.updated_at) }}</b></div></section>
            <div class="server-card-header-actions"><span class="server-status" :class="online(node) ? 'online' : 'offline'" :title="'节点 #' + node.id + ' · 最近采样：' + timestamp(node.updated_at)">{{ status(node) }}</span><button class="probe-icon" aria-label="信息 / 本地备注" :title="note(node) ? '本地备注：' + note(node) : '信息 / 本地备注'" @click="openInfo(node)"><Icon name="help" /><span v-if="note(node)" class="note-dot"></span></button></div>
          </article>
        </div>
        <div v-else class="server-table-scroll" tabindex="0" :aria-label="group.name + '节点状态表格，可横向滚动'">
          <table class="server-table"><caption class="sr-only">{{ group.name }}服务器状态</caption><thead><tr><th v-if="isManual(group.id)" scope="col">顺序</th><th scope="col">状态</th><th scope="col">节点</th><th scope="col">速率</th><th scope="col">开机时长</th><th scope="col">流量</th><th scope="col">CPU</th><th scope="col">RAM</th><th scope="col">存储</th><th scope="col">信息</th></tr></thead><tbody>
            <tr v-for="(node,index) in group.nodes" :key="node.id" :data-probe-node-id="node.id" :class="{ 'is-offline': !online(node), 'is-drag-source': dragging?.groupId === group.id && dragging.nodeId === node.id, 'is-drop-target': dragging?.groupId === group.id && dragging.over === node.id && dragging.nodeId !== node.id }">
              <td v-if="isManual(group.id)" class="server-sort-actions"><button class="drag-handle" aria-label="拖动调整顺序" title="拖动排序，或使用方向键移动" :aria-pressed="dragging?.nodeId === node.id && dragging.groupId === group.id" @pointerdown="startDragging($event, group.id, node.id)" @keydown.up.prevent="moveNode(group.id,node.id,-1)" @keydown.down.prevent="moveNode(group.id,node.id,1)" @keydown.esc="stopDragging">⠿</button><button aria-label="上移" :disabled="index === 0" @click="moveNode(group.id,node.id,-1)">↑</button><button aria-label="下移" :disabled="index === group.nodes.length-1" @click="moveNode(group.id,node.id,1)">↓</button></td>
              <td><span class="server-status" :class="online(node) ? 'online' : 'offline'" :title="'最近采样：' + timestamp(node.updated_at)">{{ status(node) }}</span></td>
              <th scope="row" class="server-name"><span :title="node.name + (note(node) ? '\n本地备注：' + note(node) : '')">{{ title(node) }}</span><small>#{{ node.id }}</small></th>
              <td class="server-network" :title="connections(node)"><span>↑ {{ network(node,'tx_mbps') }}</span><span>↓ {{ network(node,'rx_mbps') }}</span></td>
              <td title="当前节点接口尚未上报开机时间">—</td><td class="server-traffic" title="当前节点接口尚未上报累计网卡流量"><span>↑ —</span><span>↓ —</span></td>
              <td v-for="(resource,rIndex) in resources(node)" :key="resource.label" :title="resource.detail"><ProbeProgress :value="resource.value" :label="resource.label" :variant="rIndex === 0 ? 'cpu' : 'resource'" /></td>
              <td><button class="probe-icon" aria-label="信息 / 本地备注" :title="note(node) ? '本地备注：' + note(node) : '信息 / 本地备注'" @click="openInfo(node)"><Icon name="help" /><span v-if="note(node)" class="note-dot"></span></button></td>
            </tr>
          </tbody></table>
        </div>
      </section>
    </div>
    <el-dialog v-model="infoOpen" title="服务器信息" width="560px" class="probe-dialog" :before-close="closeInfo" destroy-on-close>
      <template v-if="selectedNode"><p>{{ selectedNode.name }} · 节点 #{{ selectedNode.id }}</p><dl class="probe-info"><dt>最近采样</dt><dd>{{ timestamp(selectedNode.updated_at) }}</dd><dt>连接数</dt><dd>{{ connections(selectedNode) }}</dd><dt>LoadAvg</dt><dd>{{ load(selectedNode) }}</dd><template v-for="resource in resources(selectedNode)" :key="resource.label"><dt>{{ resource.label }}</dt><dd>{{ resource.value === null ? '—' : resource.value.toFixed(1) + '%' }} · {{ resource.detail }}</dd></template></dl><label class="note-label" for="probe-note">本地备注</label><textarea id="probe-note" v-model="draftNote" aria-label="本地备注" maxlength="200" rows="4" placeholder="填写本地备注"></textarea><div class="note-help"><span>仅保存在此浏览器，不同步到服务器</span><span>{{ draftNote.length }} / 200</span></div><details v-if="adminView" class="node-json"><summary>详细信息</summary><pre>{{ JSON.stringify(selectedNode,null,2) }}</pre></details></template>
      <template #footer><el-button @click="closeInfo()">关闭</el-button><el-button type="primary" :disabled="!noteDirty" @click="saveNote">保存备注</el-button></template>
    </el-dialog>
    <el-dialog v-model="refreshOpen" title="刷新间隔设置" width="480px" class="probe-dialog"><p>单位为毫秒，保存后立即生效。</p><el-form label-position="top"><el-form-item label="前台刷新间隔（毫秒）"><el-input-number v-model="foregroundInput" :min="MIN_INTERVAL" :max="MAX_INTERVAL" :precision="0" :step="1000" /></el-form-item><el-form-item label="后台刷新间隔（毫秒）"><el-input-number v-model="backgroundInput" :min="MIN_INTERVAL" :max="MAX_INTERVAL" :precision="0" :step="1000" /></el-form-item></el-form><p class="interval-help">允许 1–300 秒；页面切到后台时使用后台间隔。</p><template #footer><el-button @click="refreshOpen = false">取消</el-button><el-button type="primary" @click="saveRefreshSettings">保存</el-button></template></el-dialog>
    <el-dialog v-model="clearOpen" title="清空此浏览器的探针偏好？" width="480px" class="probe-dialog"><p>将清除此账号的组内排序、本地备注、视图、标题优先度与刷新间隔。</p><p>登录状态、主站主题和服务器数据不受影响。</p><template #footer><el-button @click="clearOpen = false">取消</el-button><el-button type="danger" @click="resetPreferences">清空并恢复默认</el-button></template></el-dialog>
  </section>
</template>

<style scoped src="./probe-new.css"></style>
