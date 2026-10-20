import assert from 'node:assert/strict'
import { test } from 'node:test'
import { probeCounter, probePercent, readProbeCounter } from '../web/src/probe-metrics.ts'

const node = (metrics, overrides = {}) => ({ id: 1, group_id: 1, group_name: '香港', name: '节点 1', enabled: true, online: true, metrics, updated_at: null, ...overrides })

test('ready metrics honor Go JSON omitted zero counters', () => {
  const sampled = node({ cpu_ready: true, network_ready: true, rx_mbps: 4, connections_ready: true, tcp_connections: 5, load_ready: true, memory_ready: true, memory_total: 2048, disk_ready: true, disk_total: 4096 })
  assert.equal(readProbeCounter(sampled, 'cpu_ready', 'cpu_percent'), 0)
  assert.equal(readProbeCounter(sampled, 'network_ready', 'tx_mbps'), 0)
  assert.equal(readProbeCounter(sampled, 'network_ready', 'rx_mbps'), 4)
  assert.equal(readProbeCounter(sampled, 'connections_ready', 'tcp_connections') + readProbeCounter(sampled, 'connections_ready', 'udp_sockets'), 5)
  for (const field of ['load1', 'load5', 'load15']) assert.equal(readProbeCounter(sampled, 'load_ready', field), 0)
  for (const resource of ['memory', 'disk']) {
    assert.equal(probePercent(readProbeCounter(sampled, `${resource}_ready`, `${resource}_used`), readProbeCounter(sampled, `${resource}_ready`, `${resource}_total`)), 0)
  }
})

test('missing readiness, absent samples, offline and maintenance nodes remain unknown', () => {
  for (const unavailable of [node(null), node({}), node({ cpu_ready: false }), node({ cpu_ready: true }, { online: false }), node({ cpu_ready: true }, { enabled: false })]) {
    assert.equal(readProbeCounter(unavailable, 'cpu_ready', 'cpu_percent'), null)
  }
})

test('explicit invalid numbers are not converted into valid zero readings', () => {
  for (const value of [null, NaN, Infinity, -Infinity, '0', false]) {
    assert.equal(probeCounter(value), null)
    assert.equal(readProbeCounter(node({ network_ready: true, rx_mbps: value }), 'network_ready', 'rx_mbps'), null)
  }
  assert.equal(probeCounter(undefined), 0)
  assert.equal(probeCounter(0), 0)
})

test('resource percentages require positive capacity even when ready', () => {
  for (const total of [undefined, 0, -1, null, NaN]) assert.equal(probePercent(undefined, total), null)
  assert.equal(probePercent(null, 100), null)
  assert.equal(probePercent(undefined, 100), 0)
  assert.equal(probePercent(25, 100), 25)
  assert.equal(probePercent(150, 100), 100)
})
