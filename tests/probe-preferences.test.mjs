import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clearPreferences, createDefaultPreferences, isPreferenceStorageKey, loadPreferences,
  MAX_INTERVAL, MIN_INTERVAL, normalizeIntervals, normalizePreferences,
  preferenceStorageKey, reconcileManualOrder, savePreferences, sortNodes,
} from '../web/src/probe-preferences.ts'

const memoryStorage = () => {
  const data = new Map()
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  }
}
const node = (id, overrides = {}) => ({
  id, name: `节点 ${id}`, group_id: 1, group_name: '香港',
  online: true, enabled: true, metrics: null, updated_at: null, ...overrides,
})

test('NYP probe defaults use tables and separate foreground/background refresh', () => {
  const preferences = createDefaultPreferences()
  assert.equal(preferences.serverDisplayMode, 'table')
  assert.equal(preferences.titlePriority, 'name')
  assert.deepEqual(preferences.intervals, { foreground: 2000, background: 10000 })
  preferences.notes['1'] = '独立实例'
  assert.deepEqual(createDefaultPreferences().notes, {})
})

test('preferences are isolated per account and reset preserves unrelated storage', () => {
  const storage = memoryStorage()
  storage.setItem('nekopass-theme-v3', 'dark')
  storage.setItem('auth', 'test-session')
  const first = createDefaultPreferences(), second = createDefaultPreferences()
  first.notes['1'] = '主节点'
  second.notes['1'] = '备用节点'
  assert.equal(savePreferences(12, first, storage), true)
  assert.equal(savePreferences(24, second, storage), true)
  assert.equal(loadPreferences(12, storage).notes['1'], '主节点')
  assert.equal(loadPreferences(24, storage).notes['1'], '备用节点')
  assert.equal(clearPreferences(12, storage), true)
  assert.deepEqual(loadPreferences(12, storage), createDefaultPreferences())
  assert.equal(loadPreferences(24, storage).notes['1'], '备用节点')
  assert.equal(storage.getItem('nekopass-theme-v3'), 'dark')
  assert.equal(storage.getItem('auth'), 'test-session')
})

test('broken, unsupported and blocked storage fall back safely', () => {
  const storage = memoryStorage()
  for (const raw of ['{', 'null', '[]', '"text"', '{"version":2,"notes":{"1":"unknown schema"}}']) {
    storage.setItem(preferenceStorageKey(1), raw)
    assert.deepEqual(loadPreferences(1, storage), createDefaultPreferences())
  }
  const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('full') }, removeItem() { throw new Error('blocked') } }
  assert.deepEqual(loadPreferences(1, blocked), createDefaultPreferences())
  assert.equal(savePreferences(1, createDefaultPreferences(), blocked), false)
  assert.equal(clearPreferences(1, blocked), false)
  assert.equal(savePreferences(0, createDefaultPreferences(), storage), false)
})

test('normalization validates nested values and keeps notes within 200 Unicode characters', () => {
  const preferences = normalizePreferences(JSON.parse(`{
    "version":1,"groups":{"1":{"mode":"manual","manualOrder":[2,2,0,-1,"3",4]},"2":{"mode":"rule","field":"secret","direction":"sideways"},"__proto__":{"mode":"manual"}},
    "notes":{"1":"${'🌸'.repeat(201)}","2":3,"3":"  ","__proto__":"ignored"},
    "serverDisplayMode":"invalid","titlePriority":"note","adminView":"true"
  }`))
  assert.deepEqual(preferences.groups['1'].manualOrder, [2, 4])
  assert.equal(preferences.groups['2'].field, undefined)
  assert.equal(preferences.groups['2'].direction, 'asc')
  assert.equal(Object.hasOwn(preferences.groups, '__proto__'), false)
  assert.equal(Array.from(preferences.notes['1']).length, 200)
  assert.equal(preferences.notes['2'], undefined)
  assert.equal(preferences.notes['3'], undefined)
  assert.equal(preferences.serverDisplayMode, 'table')
  assert.equal(preferences.titlePriority, 'note')
  assert.equal(preferences.adminView, false)
})

test('HTTP refresh bounds reject non-numbers and cap aggressive or excessive intervals', () => {
  assert.deepEqual(normalizeIntervals({ foreground: 10, background: 1e9 }), { foreground: MIN_INTERVAL, background: MAX_INTERVAL })
  assert.deepEqual(normalizeIntervals({ foreground: NaN, background: '5000' }), { foreground: 2000, background: 10000 })
  assert.deepEqual(normalizeIntervals({ foreground: 2500.3, background: Infinity }), { foreground: 2500, background: 10000 })
})

test('cross-tab key filter accepts only the current account or a full storage clear', () => {
  assert.equal(isPreferenceStorageKey(preferenceStorageKey(1), 1), true)
  assert.equal(isPreferenceStorageKey(preferenceStorageKey(2), 1), false)
  assert.equal(isPreferenceStorageKey('nekopass-theme-v3', 1), false)
  assert.equal(isPreferenceStorageKey(null, 1), true)
  assert.equal(isPreferenceStorageKey(null, 0), false)
})

test('manual order reconciles deleted, duplicate and newly joined nodes without mutating inputs', () => {
  const nodes = [node(1), node(2), node(3)], order = [2, 8, 2]
  assert.deepEqual(reconcileManualOrder(nodes, order), [2, 1, 3])
  assert.deepEqual(sortNodes(nodes, { mode: 'manual', manualOrder: order }).map(item => item.id), [2, 1, 3])
  assert.deepEqual(nodes.map(item => item.id), [1, 2, 3])
  assert.deepEqual(order, [2, 8, 2])
})

test('rule sorting is numeric, stable for ties and places unavailable metrics last in either direction', () => {
  const nodes = [
    node(10, { metrics: { cpu_ready: true, cpu_percent: 10, network_ready: true, rx_mbps: 1, tx_mbps: 2 } }),
    node(2, { metrics: { cpu_ready: true, network_ready: true } }),
    node(1, { online: false, metrics: { cpu_ready: true, cpu_percent: 100 } }),
    node(3),
  ]
  assert.deepEqual(sortNodes(nodes, { mode: 'rule', field: 'name' }).map(item => item.id), [1, 2, 3, 10])
  assert.deepEqual(sortNodes(nodes, { mode: 'rule', field: 'cpu', direction: 'asc' }).map(item => item.id), [2, 10, 1, 3])
  assert.deepEqual(sortNodes(nodes, { mode: 'rule', field: 'cpu', direction: 'desc' }).map(item => item.id), [10, 2, 1, 3])
  assert.deepEqual(sortNodes(nodes, { mode: 'rule', field: 'network', direction: 'desc' }).map(item => item.id), [10, 2, 1, 3])
  assert.deepEqual(sortNodes(nodes).map(item => item.id), [10, 2, 1, 3])
})

test('updated ordering uses reported timestamps and keeps invalid times last', () => {
  const nodes = [node(1, { updated_at: '2026-10-20T11:00:00Z' }), node(2, { updated_at: 'invalid' }), node(3, { updated_at: '2026-10-20T10:00:00Z' })]
  assert.deepEqual(sortNodes(nodes, { mode: 'rule', field: 'updated', direction: 'desc' }).map(item => item.id), [1, 3, 2])
})
