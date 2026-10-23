import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDemoAPI, DEMO_SESSION_KEY } from '../web/src/demo/adapter.ts'
const now = () => Date.parse('2026-10-20T08:00:00Z')
const storage = () => {
  const values = new Map()
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}
}

test('demo begins as a clearly named administrator and returns isolated data snapshots', async () => {
  const api = createDemoAPI({now})
  assert.equal((await api('me')).is_admin,true)
  assert.match((await api('me')).username,/演示/)
  const nodes = await api('admin/nodes')
  nodes[0].name = 'mutated'
  assert.notEqual((await api('admin/nodes'))[0].name,'mutated')
})

test('demo telemetry includes grouped online, offline, zero, maintenance and unknown states', async () => {
  const api = createDemoAPI({now})
  const nodes = await api('node-status')
  assert.equal(new Set(nodes.map(node=>node.id)).size,7)
  assert.equal(new Set(nodes.map(node=>node.group_id)).size,3)
  const zero = nodes.find(node=>node.id===2)
  assert.equal(zero.metrics.cpu_ready,true)
  assert.equal(zero.metrics.cpu_percent,undefined)
  assert.equal(zero.metrics.rx_mbps,undefined)
  assert.equal(nodes.find(node=>node.id===3).online,false)
  assert.equal(nodes.find(node=>node.id===6).enabled,false)
  assert.equal(nodes.find(node=>node.id===7).metrics.cpu_ready,false)
  assert.ok(nodes.every(node=>!node.metrics||!('uptime' in node.metrics)))
})

test('demo session logout persists across page requests and login restores it', async () => {
  const session = storage()
  const first = createDemoAPI({now,storage:session})
  await first('logout','POST')
  assert.equal(session.getItem(DEMO_SESSION_KEY),'logged-out')
  let redirected = false
  const second = createDemoAPI({now,storage:session,onUnauthorized:()=>{redirected=true}})
  await assert.rejects(second('me'),/已退出演示/)
  assert.equal(redirected,true)
  assert.equal((await second('registration')).enabled,true)
  await second('login','POST',{username:'',password:''})
  assert.equal((await createDemoAPI({now,storage:session})('me')).is_admin,true)
})

test('all business writes fail explicitly, including messages, payment, secrets and node jobs', async () => {
  const api = createDemoAPI({now})
  for (const [path,method] of [
    ['rules','POST'],['rules/11','PUT'],['rules/11','DELETE'],['shop/purchase','POST'],
    ['wallet/recharge','POST'],['orders/1/pay','POST'],['registration/email-code','POST'],
    ['register','POST'],['tickets/1/messages','POST'],['admin/settings/telegram/test','POST'],
    ['admin/nodes/1/install-command','POST'],['admin/nodes/1/update','POST'],
    ['admin/settings/api-key','POST'],['admin/settings','PUT'],
  ]) await assert.rejects(api(path,method,{}),/演示未提交/)
  await assert.rejects(api('unknown'),/没有发送网络请求/)
  await assert.rejects(api('https://example.com'),/地址无效/)
  await assert.rejects(api('../me'),/地址无效/)
})

test('read contracts cover every page, details and managed-user rule scope', async () => {
  const api = createDemoAPI({now})
  for (const path of [
    'site','registration','me','profile','rule-nodes','rule-groups','tls-inbounds','rules','rules/stats?rule_id=11',
    'admin/users','admin/users/2','admin/users/2/rules','admin/users/2/rule-groups','admin/users/2/rule-nodes','admin/users/2/tls-inbounds',
    'admin/plans','shop/plans','admin/nodes','admin/node-groups','wallet','referrals','orders?page=1','admin/orders?page=1','admin/orders/1',
    'announcements','announcements/1','admin/announcements','tickets','tickets/config','tickets/1','admin/tickets','admin/tickets/1',
    'admin/settings','admin/updates/panel','admin/payment-methods','admin/payment-interfaces',
    'admin/nodes/1/protocols','admin/nodes/1/ddns','admin/nodes/1/ip-recovery','admin/nodes/1/tls-inbounds',
  ]) assert.notEqual(await api(path),undefined,path)
  assert.ok((await api('admin/users/2/rules')).every(rule=>rule.user_id===2))
  assert.equal((await api('admin/orders?user_id=2')).items.length,1)
  assert.equal((await api('admin/orders?status=pending')).total,0)
  assert.equal((await api('admin/orders?email=not+a+user')).total,0)
  assert.equal((await api('announcements?page=2')).items.length,0)
})

test('quote preview validates selected plan without creating payment or purchase', async () => {
  const api = createDemoAPI({now})
  const quote = await api('shop/quote','POST',{plan_id:2,cycle:'annual'})
  assert.equal(quote.amount_cents,38000)
  assert.equal(quote.replaces_plan,true)
  await assert.rejects(api('shop/quote','POST',{plan_id:2,cycle:'invalid'}),/有效/)
  assert.equal((await api('wallet')).balance_cents,8800)
})
