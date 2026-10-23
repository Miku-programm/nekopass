import type { ProbeNode } from './api'
import { readProbeCounter } from './probe-metrics.ts'

export type ProbeSortField = 'name' | 'cpu' | 'network' | 'updated'
export type GroupPreference = {
  mode: 'default' | 'manual' | 'rule'
  field?: ProbeSortField
  direction?: 'asc' | 'desc'
  manualOrder?: number[]
}
export type ProbeIntervals = { foreground: number; background: number }
export type ProbePreferences = {
  version: 1
  groups: Record<string, GroupPreference>
  notes: Record<string, string>
  serverDisplayMode: 'table' | 'cards'
  titlePriority: 'name' | 'note'
  adminView: boolean
  intervals: ProbeIntervals
}
export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const PREFERENCE_PREFIX = 'nekopass.probe.preferences.v1.'
export const MIN_INTERVAL = 1000
export const MAX_INTERVAL = 300000
export const DEFAULT_FOREGROUND_INTERVAL = 2000
export const DEFAULT_BACKGROUND_INTERVAL = 10000
export const MAX_NOTE_LENGTH = 200

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const validId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0
const validKey = (key: string) => /^(0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(Number(key))

export function normalizeIntervals(value: unknown): ProbeIntervals {
  const source = record(value) ? value : {}
  const interval = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, Math.round(value)))
      : fallback
  return {
    foreground: interval(source.foreground, DEFAULT_FOREGROUND_INTERVAL),
    background: interval(source.background, DEFAULT_BACKGROUND_INTERVAL),
  }
}

export function createDefaultPreferences(): ProbePreferences {
  return {
    version: 1,
    groups: {},
    notes: {},
    serverDisplayMode: 'table',
    titlePriority: 'name',
    adminView: false,
    intervals: normalizeIntervals(null),
  }
}

export function normalizePreferences(value: unknown): ProbePreferences {
  const result = createDefaultPreferences()
  if (!record(value) || value.version !== 1) return result
  if (record(value.groups)) {
    for (const [id, preference] of Object.entries(value.groups)) {
      if (!validKey(id) || !record(preference)) continue
      const mode = preference.mode === 'manual' || preference.mode === 'rule' ? preference.mode : 'default'
      const normalized: GroupPreference = { mode }
      if (['name', 'cpu', 'network', 'updated'].includes(String(preference.field))) {
        normalized.field = preference.field as ProbeSortField
      }
      normalized.direction = preference.direction === 'desc' ? 'desc' : 'asc'
      if (Array.isArray(preference.manualOrder)) {
        normalized.manualOrder = [...new Set(preference.manualOrder.filter(validId))]
      }
      result.groups[id] = normalized
    }
  }
  if (record(value.notes)) {
    for (const [id, note] of Object.entries(value.notes)) {
      if (validKey(id) && typeof note === 'string' && note.trim()) {
        result.notes[id] = Array.from(note).slice(0, MAX_NOTE_LENGTH).join('')
      }
    }
  }
  result.serverDisplayMode = value.serverDisplayMode === 'cards' ? 'cards' : 'table'
  result.titlePriority = value.titlePriority === 'note' ? 'note' : 'name'
  result.adminView = value.adminView === true
  result.intervals = normalizeIntervals(value.intervals)
  return result
}

export function preferenceStorageKey(accountId: number): string {
  if (!validId(accountId)) throw new RangeError('探针偏好需要有效账号 ID')
  return `${PREFERENCE_PREFIX}${accountId}`
}

function browserStorage(): PreferenceStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

export function loadPreferences(accountId: number, storage = browserStorage()): ProbePreferences {
  try {
    const raw = storage?.getItem(preferenceStorageKey(accountId))
    return raw ? normalizePreferences(JSON.parse(raw)) : createDefaultPreferences()
  } catch {
    return createDefaultPreferences()
  }
}

export function savePreferences(accountId: number, preferences: ProbePreferences, storage = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(preferenceStorageKey(accountId), JSON.stringify(normalizePreferences(preferences)))
    return true
  } catch {
    return false
  }
}

// Reset only this account's probe preferences; authentication and site themes are unrelated.
export function clearPreferences(accountId: number, storage = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.removeItem(preferenceStorageKey(accountId))
    return true
  } catch {
    return false
  }
}

export function isPreferenceStorageKey(key: string | null, accountId: number): boolean {
  return validId(accountId) && (key === null || key === preferenceStorageKey(accountId))
}

export function subscribePreferences(accountId: number, callback: (preferences: ProbePreferences) => void): () => void {
  if (typeof window === 'undefined' || !validId(accountId)) return () => {}
  const onStorage = (event: StorageEvent) => {
    if (!isPreferenceStorageKey(event.key, accountId)) return
    const storage = browserStorage()
    if (event.storageArea && event.storageArea !== storage) return
    callback(loadPreferences(accountId, storage))
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

export function reconcileManualOrder(nodes: readonly Pick<ProbeNode, 'id'>[], manualOrder: readonly number[] = []): number[] {
  const available = new Set(nodes.map(node => node.id))
  return [...new Set([...manualOrder.filter(id => available.has(id)), ...nodes.map(node => node.id)])]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
function sortValue(node: ProbeNode, field: ProbeSortField): number | string | null {
  if (field === 'name') return node.name.trim() || null
  if (field === 'cpu') return readProbeCounter(node, 'cpu_ready', 'cpu_percent')
  if (field === 'network') {
    const receive = readProbeCounter(node, 'network_ready', 'rx_mbps')
    const transmit = readProbeCounter(node, 'network_ready', 'tx_mbps')
    return receive === null || transmit === null ? null : receive + transmit
  }
  const timestamp = node.updated_at ? Date.parse(node.updated_at) : NaN
  return Number.isFinite(timestamp) ? timestamp : null
}

export function sortNodes<T extends ProbeNode>(nodes: readonly T[], preference?: GroupPreference): T[] {
  if (!preference || preference.mode === 'default') return [...nodes]
  if (preference.mode === 'manual') {
    const order = new Map(reconcileManualOrder(nodes, preference.manualOrder).map((id, index) => [id, index]))
    return [...nodes].sort((left, right) => order.get(left.id)! - order.get(right.id)!)
  }
  if (!preference.field) return [...nodes]
  const field = preference.field
  const direction = preference.direction === 'desc' ? -1 : 1
  return [...nodes].sort((left, right) => {
    const a = sortValue(left, field), b = sortValue(right, field)
    if (a === null && b === null) return left.id - right.id
    if (a === null) return 1
    if (b === null) return -1
    const difference = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : collator.compare(String(a), String(b))
    return difference ? difference * direction : left.id - right.id
  })
}
