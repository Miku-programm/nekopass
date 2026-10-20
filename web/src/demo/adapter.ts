import { createDemoData, createProbeSamples } from './data.ts'
import { installDemoNotice } from './notice.ts'

export const DEMO_SESSION_KEY = 'nekopass.demo.session.v1'
type SessionStorage = Pick<Storage, 'getItem' | 'setItem'>
type DemoOptions = { now?: () => number; storage?: SessionStorage; onUnauthorized?: () => void }
const clone = <T>(value: T): T => structuredClone(value)

/** No network capability: unimplemented requests fail closed, never fall through to fetch. */
export function createDemoAPI(options: DemoOptions = {}) {
  const now = options.now || Date.now
  let loggedOut = false
  try { loggedOut = options.storage?.getItem(DEMO_SESSION_KEY) === 'logged-out' } catch { /* memory fallback */ }
  function session(value: boolean) {
    try { options.storage?.setItem(DEMO_SESSION_KEY, value ? 'logged-out' : 'admin') }
    catch { throw Error('演示登录需要浏览器允许此站点的本地会话存储。') }
    loggedOut = value
  }
  return async function request<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!/^[a-z0-9][a-z0-9/-]*(?:\?[^#]*)?$/i.test(path)) throw Error('演示接口地址无效。')
    const url = new URL(path, 'https://demo.example.invalid/')
    const resource = url.pathname.slice(1)
    const verb = method.toUpperCase()
    const data = createDemoData(now())
    const result = (value: unknown) => clone(value) as T
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
    if (resource === 'site' && verb === 'GET') return result({site_name:data.settings.site_name})
    if (resource === 'registration' && verb === 'GET') return result({enabled:true,email_verification:false,captcha_mode:'off',force_invite:false,terms_url:'',privacy_url:''})
    if (resource === 'login' && verb === 'POST') { session(false); return result(data.users[0]) }
    if (resource === 'logout' && verb === 'POST') { session(true); return result({ok:true}) }
    if (loggedOut) { options.onUnauthorized?.(); throw Error('已退出演示，请重新进入演示账号。') }
    if (resource === 'shop/quote' && verb === 'POST') {
      const plan = data.plans.find(plan => plan.id === Number(input.plan_id))
      const cycle = typeof input.cycle === 'string' ? input.cycle : 'monthly'
      if (!plan || !Object.hasOwn(plan.prices,cycle)) throw Error('请选择有效的演示套餐与周期。')
      return result({plan_id:plan.id,plan_name:plan.name,cycle,amount_cents:plan.prices[cycle],balance_cents:8800,expires_at:data.nextMonth,next_reset_at:data.nextMonth,epoch:1,kind:'renewal',replaces_plan:plan.id!==1})
    }
    if (verb !== 'GET') throw Error('演示未提交：当前仅展示前端，业务操作已停用；不会发送消息、付款或修改服务器。')
    const me = data.users[0]
    const managed = resource.match(/^admin\/users\/(\d+)\/(.+)$/)
    const scope = managed ? Number(managed[1]) : me.id
    const endpoint = managed ? managed[2] : resource
    const paginate = <R>(rows: R[], size = 20) => {
      const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1))
      return {items:rows.slice((page-1)*size,page*size),total:rows.length}
    }
    if (endpoint === 'me') return result(me)
    if (endpoint === 'profile') return result(data.users.filter(user => user.id === scope))
    if (endpoint === 'rule-nodes') return result(data.nodes)
    if (endpoint === 'rule-groups') return result(data.groups.filter(group => group.user_id === scope))
    if (endpoint === 'tls-inbounds') return result([{id:1,node_id:1,port:443,name:'共享 TLS（演示）',allowed_sni:['*.example.invalid']}])
    if (endpoint === 'rules') return result(data.rules.filter(rule => rule.user_id === scope))
    if (endpoint === 'rules/stats') {
      const hour = Math.floor(now()/3600_000)*3600_000
      return result(Array.from({length:24},(_,index)=>({time:new Date(hour-(23-index)*3600_000).toISOString(),bytes:Math.round((1+Math.sin(index*.6)*.45)*128*1024**2)})))
    }
    if (resource === 'admin/users') return result(data.users)
    if (/^admin\/users\/\d+$/.test(resource)) return result(data.users.filter(user => user.id === Number(resource.split('/')[2])))
    if (resource === 'admin/plans' || resource === 'shop/plans') return result(data.plans)
    if (resource === 'admin/nodes') return result(data.nodes)
    if (resource === 'admin/node-groups') return result(data.nodeGroups)
    if (resource === 'node-status') return result(createProbeSamples(now()))
    if (resource === 'wallet') return result({balance_cents:8800,currency:'CNY',entries:[{id:1,order_id:3,amount_cents:10000,balance_after_cents:10000,kind:'recharge',note:'虚构演示余额',created_at:data.earlier}],minimum_recharge_cents:1000,payment_channels:[{id:1,name:'演示支付（不会付款）'}]})
    if (resource === 'referrals') return result({enabled:true,eligible:true,code:'DEMO-ONLY',mode:'first',rate:'15',invited_count:3,earned_cents:810})
    if (resource === 'orders' || resource === 'admin/orders') {
      const rows = data.orders.filter(order => {
        if (resource === 'orders' && order.user_id !== scope) return false
        for (const key of ['user_id','kind','status'] as const) { const value = url.searchParams.get(key); if(value && String(order[key])!==value)return false }
        for (const [query,key] of [['order_no','order_no'],['email','username'],['gateway_trade_no','gateway_trade_no']] as const) { const value=url.searchParams.get(query);if(value&&!order[key].includes(value))return false }
        const time = url.searchParams.get('time_field') === 'paid' ? order.paid_at : order.created_at
        const from = url.searchParams.get('from'), to = url.searchParams.get('to')
        return (!from||Date.parse(time)>=Date.parse(from)) && (!to||Date.parse(time)<=Date.parse(to))
      })
      return result(paginate(rows))
    }
    if (/^admin\/orders\/\d+$/.test(resource)) {
      const order = data.orders.find(order => order.id === Number(resource.split('/')[2]))
      if (!order) throw Error('演示订单不存在。')
      return result(order)
    }
    if (resource === 'announcements' || resource === 'admin/announcements') return result(paginate(data.notices))
    if (/^(admin\/)?announcements\/\d+$/.test(resource)) {
      const notice = data.notices.find(notice => notice.id === Number(resource.split('/').at(-1)))
      if (!notice) throw Error('演示公告不存在。')
      return result(notice)
    }
    if (resource === 'tickets' || resource === 'admin/tickets') return result(paginate([data.ticket]))
    if (resource === 'tickets/config') return result({captcha_mode:'off'})
    if (/^(admin\/)?tickets\/1$/.test(resource)) return result({...data.ticket,messages:data.ticketMessages,total:data.ticketMessages.length})
    if (resource === 'admin/settings') return result({settings:data.settings,api_key_configured:false,agent_listener:null,telegram_status:{state:'disabled'}})
    if (resource === 'admin/updates/panel') return result({supported:false,current_version:'frontend-demo',task:null})
    if (resource === 'admin/updates') throw Error('演示环境未连接版本服务，无法检查服务器更新。')
    if (resource === 'admin/payment-methods') return result(paginate([{id:1,name:'演示支付（停用）',interface:'epay',config:{},enabled:false,sort_order:0}],50))
    if (resource === 'admin/payment-interfaces') return result([{id:'epay',name:'易支付',fields:[{name:'url',label:'接口地址',placeholder:'https://pay.example.invalid',secret:false,required:true},{name:'pid',label:'商户 ID',placeholder:'仅展示表单',secret:false,required:true},{name:'key',label:'商户密钥',placeholder:'无需填写真实密钥',secret:true,required:true}]}])
    const nodeEndpoint = resource.match(/^admin\/nodes\/(\d+)\/(protocols|ddns|ip-recovery|tls-inbounds)$/)
    if (nodeEndpoint) {
      const node = data.nodes.find(node => node.id === Number(nodeEndpoint[1]))
      if (!node) throw Error('演示节点不存在。')
      const common = {node_id:node.id,node_name:node.name,protocol_version:19,online:node.online,generation:1,status:{state:'disabled'},status_received_at:data.date}
      if (nodeEndpoint[2] === 'protocols') return result({...common,config:node,ingress_nodes:data.nodes})
      if (nodeEndpoint[2] === 'ddns') return result({...common,config:{enabled:false,provider:'cloudflare',record_name:'',zone_id:'',token:'',ipv4:true,ipv6:false,interval_seconds:300,ttl:300,ipv4_url:'',ipv6_url:'',use_for_ingress:true,use_for_egress:true}})
      if (nodeEndpoint[2] === 'ip-recovery') return result({...common,config:{enabled:false,target_ip:'',failure_threshold:6,cooldown_seconds:300,instance_type:'ec2',auth_token:'',share_group_token:'',account_id:'',region_name:'',instance_id:'',static_ip:false}})
      return result({tls_only:false,inbounds:[{id:1,config:{name:'共享 TLS（演示）',port:443,enabled:true,proxy_accept:'off',allowed_sni:['*.example.invalid'],reject_empty_sni:true,unknown_sni_action:'reject',default_rule_id:0,max_handshakes:128,handshake_timeout_seconds:5},rule_count:0}],default_rules:[]})
    }
    throw Error('此接口未包含在前端演示中，没有发送网络请求。')
  }
}

let browserAPI: ReturnType<typeof createDemoAPI> | undefined
export async function demoAPI<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!browserAPI) {
    let storage: SessionStorage | undefined
    try { storage = window.sessionStorage } catch { /* unavailable storage is reported when signing in */ }
    browserAPI = createDemoAPI({storage,onUnauthorized:()=>{
      if (!['/login','/register'].includes(location.pathname)) location.assign('/login?next='+encodeURIComponent(location.pathname+location.search))
    }})
    installDemoNotice(async () => {
      await browserAPI!('login','POST')
      location.assign('/node_status')
    })
  }
  return browserAPI<T>(path, method, body)
}
