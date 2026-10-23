import type { Probe, ProbeNode } from './api'

export type ProbeReadyFlag = Extract<keyof Probe, `${string}_ready`>
type ProbeCounterField = Exclude<keyof Probe, ProbeReadyFlag>

// The Probe API uses omitempty: absent numeric counters mean zero once ready.
// Explicit null and non-finite values are not valid measurements.
export function probeCounter(value: unknown): number | null {
  if (value === undefined) return 0
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null
}

export function readProbeCounter(node: ProbeNode, flag: ProbeReadyFlag, field: ProbeCounterField): number | null {
  if (!node.enabled || !node.online || node.metrics?.[flag] !== true) return null
  return probeCounter(node.metrics[field])
}

export function probePercent(used: unknown, total: unknown): number | null {
  const usedValue = probeCounter(used), totalValue = probeCounter(total)
  return usedValue !== null && totalValue !== null && totalValue > 0 ? Math.min(100, usedValue / totalValue * 100) : null
}
