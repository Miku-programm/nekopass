import type { Node, Plan, ProbeNode, Rule, User } from '../api'

// Entirely synthetic data. These .invalid addresses are deliberately not services.
export function createDemoData(now: number) {
  const date = new Date(now).toISOString()
  const earlier = new Date(now - 36 * 3600_000).toISOString()
  const nextMonth = new Date(now + 30 * 86400_000).toISOString()
  const tls = {padding_enabled:false,padding_scheme:[] as string[],server_name:'',client_sni:'',fingerprint:'off',host:'',fallback_url:'',certificate_mode:'self_signed',certificate:'',private_key:'',root_ca:'',path:'/api/stream',public_port:0,pool_size:2,stream_window_mib:16,connection_window_mib:64,max_streams:256,site_title:'Demo',acme_email:'',acme_directory:'',acme_root_ca:'',http_challenge_port:80,dns_provider:'cloudflare',dns_credentials:{}}
  const nodeBase: Omit<Node, 'id' | 'name'> = {tls,token:'',ingress_enabled:true,allow_direct:true,tunnel_exit_enabled:false,tunnel_protocol:'plain_tcp',tunnel_transport:'raw_tcp',tunnel_security:'none',tunnel_listen_host:'0.0.0.0',tunnel_listen_port:0,tunnel_public_host:'',allowed_ingress_ids:[],public_address:'node.example.invalid',notes:'虚构演示节点，不连接服务器',enabled:true,group_ids:[1],listen_host:'0.0.0.0',port_min:10000,port_max:60000,max_connections:1000,dial_timeout_seconds:10,idle_timeout_seconds:300,udp_idle_timeout_seconds:30,probe_interval_seconds:5,disk_path:'/',network_interfaces:[],agent_version:'demo',update_supported:false,update_status:null,tls_status:'',tls_error:'',tls_not_after:null,protocol_version:19,bound:true,online:true,last_seen:date,sync_error:'',active_connections:12,applied_revision:1,config_revision:1,rule_count:2}
  const nodes: Node[] = [
    {...nodeBase,id:1,name:'香港 · HK 01'},
    {...nodeBase,id:2,name:'东京 · JP 01',tunnel_exit_enabled:true,allowed_ingress_ids:[1],group_ids:[1,3]},
    {...nodeBase,id:3,name:'新加坡 · SG 01',online:false,last_seen:earlier},
    {...nodeBase,id:4,name:'洛杉矶 · US 01',group_ids:[2]},
    {...nodeBase,id:5,name:'法兰克福 · DE 01',group_ids:[2]},
    {...nodeBase,id:6,name:'香港 · 维护节点',enabled:false,online:false,group_ids:[3]},
    {...nodeBase,id:7,name:'东京 · 等待采样',group_ids:[3]},
  ]
  const nodeGroups = [
    {id:1,name:'亚太地区',description:'香港、东京和新加坡演示线路',enabled:true,sort_order:0,strategy:'all',node_ids:[1,2,3],plan_count:2},
    {id:2,name:'欧美地区',description:'欧美演示线路',enabled:true,sort_order:1,strategy:'all',node_ids:[4,5],plan_count:2},
    {id:3,name:'备用线路',description:'备用、维护与等待采样状态',enabled:true,sort_order:2,strategy:'all',node_ids:[2,6,7],plan_count:2},
  ]
  const plan: Plan & {purchase_count:number} = {id:1,name:'标准套餐',description:'演示套餐 · 适合查看规则、流量与节点管理界面',enabled:true,prices:{monthly:1800,annual:18000},purchase_limit:0,purchase_count:1,speed_mbps:100,quota_bytes:500*1024**3,max_rules:20,max_connections:1000,ip_limit:0,rule_speed_mbps:0,rule_ip_limit:0,rule_connection_limit:0,duration_days:30,node_group_ids:[1,2,3],user_count:2}
  const plans = [plan, {...plan,id:2,name:'进阶套餐',description:'演示套餐 · 更高流量和规则额度',prices:{monthly:3800,annual:38000},speed_mbps:500,quota_bytes:2*1024**4,max_rules:100,user_count:0,purchase_count:0}]
  const userBase: Omit<User, 'id' | 'username' | 'is_admin'> = {referral_enabled:true,referral_mode:'first',referral_rate_bps:1500,resources_revision:1,node_group_ids:[1,2,3],enabled:true,plan_id:1,plan_name:plan.name,plan_enabled:true,plan_started_at:earlier,next_reset_at:nextMonth,quota_epoch:1,subscription_managed:true,balance_cents:8800,expires_at:nextMonth,speed_mbps:100,quota_bytes:500*1024**3,max_rules:20,max_connections:1000,ip_limit:0,rule_speed_mbps:0,rule_ip_limit:0,rule_connection_limit:0,node_ids:nodes.map(node=>node.id),rule_count:3,traffic_bytes:23*1024**3,charged_bytes:23*1024**3,allocated_bytes:0}
  const users: User[] = [{...userBase,id:1,username:'演示管理员',is_admin:true},{...userBase,id:2,username:'member@example.invalid',is_admin:false}]
  const ruleBase: Omit<Rule,'id'|'user_id'|'username'> = {protocol:'tcp',egress_node_id:0,node_id:1,name:'Web 转发',group_id:1,listen_port:12345,targets:['origin.example.invalid:443'],balance:'random',speed_mbps:0,ip_limit:0,connection_limit:0,proxy_accept:'off',proxy_send:'off',proxy_trusted_cidrs:[],enabled:true,egress_node_name:'',node_name:nodes[0].name,public_address:'node.example.invalid',traffic_bytes:4*1024**3,status:'active',sync_error:'',group_name:'常用规则',last_seen:date,applied_revision:1,tls_inbound_id:0,sni_names:[],tls_alpn:[],origin_tls:{enabled:false,server_name:'',root_ca:'',alpn:[]}}
  const rules: Rule[] = users.flatMap(user=>[
    {...ruleBase,id:user.id*10+1,user_id:user.id,username:user.username,group_id:user.id},
    {...ruleBase,id:user.id*10+2,user_id:user.id,username:user.username,group_id:user.id,name:'DNS 转发',protocol:'udp',listen_port:12346,targets:['resolver.example.invalid:53'],traffic_bytes:1024**3},
    {...ruleBase,id:user.id*10+3,user_id:user.id,username:user.username,group_id:0,group_name:'',name:'备用转发',node_id:2,node_name:nodes[1].name,listen_port:12347,enabled:false,status:'disabled',traffic_bytes:0},
  ])
  const groups = users.map(user=>({id:user.id,name:'常用规则',user_id:user.id,rule_count:2}))
  const notices = [
    {id:1,title:'欢迎体验节点状态（新）',content:'本演示展示 NYP 风格的表格、卡片和深浅主题。可在「节点状态」的设置中切换视图、调整排序、添加本地备注。\n\n当前所有节点、账户、订单及指标均为虚构数据。页面不连接真实后端；购买、付款、发信和配置下发均不执行。主题、备注和排序仅保存在你的浏览器。',truncated:false,summary:'查看新节点状态页与本地交互。',enabled:true,sort_order:1,created_at:earlier,updated_at:date},
    {id:2,title:'演示说明',content:'默认以演示管理员身份进入，可浏览用户区和管理区。业务表单允许打开和填写，但提交会显示「演示未提交」。退出后可直接点击登录页的演示入口，无需填写真实账号或密码。',truncated:false,summary:'模拟数据、无真实服务。',enabled:true,sort_order:2,created_at:earlier,updated_at:date},
  ]
  const orderBase = {user_id:1,username:users[0].username,kind:'purchase',plan_name:plan.name,cycle:'monthly',amount_cents:1800,status:'paid',payment_method_name:'演示余额',gateway_trade_no:'',created_at:earlier,paid_at:earlier,can_pay:false,snapshot:{expires_at:nextMonth,next_reset_at:nextMonth,note:'虚构演示订单，没有发生交易'}}
  const orders = [
    {...orderBase,id:1,order_no:'DEMO202610200001'},
    {...orderBase,id:2,order_no:'DEMO202610200002',user_id:2,username:users[1].username},
    {...orderBase,id:3,order_no:'DEMO202610200003',kind:'recharge',plan_name:'',amount_cents:10000,payment_method_name:'演示支付（停用）'},
  ]
  const ticket = {id:1,title:'连接配置咨询（演示）',username:users[1].username,priority:'medium',status:'waiting_staff',updated_at:date}
  const ticketMessages = [{id:1,content:'您好，可以在这里查看转发规则的配置示例吗？',sender_is_staff:false,created_at:earlier},{id:2,content:'可以。请打开转发规则页查看详情。这是本地演示消息，并未发送给任何人。',sender_is_staff:true,created_at:date}]
  const settings = {telegram:{enabled:false,token:'',admin_ids:[],notification_chat_ids:[],statistics_days:7},registration_email_verification:false,force_invite:false,terms_url:'',privacy_url:'',registration_enabled:true,captcha_mode:'off',smtp:{host:'',port:587,security:'starttls',username:'',password:'',from:'',from_name:''},referral_enabled:true,referral_mode:'first',referral_rate:'15',site_name:'Nekopass 演示',panel_url:'https://panel.example.invalid',agent_host:'node.example.invalid',agent_port:9443,agent_transport:'tls',installer_url:'',release_base_url:'',agent_version:'demo',install_token_minutes:30,proxy_trusted_cidrs:[],target_deny_cidrs:[]}
  return {date,earlier,nextMonth,nodes,nodeGroups,plans,users,rules,groups,notices,orders,ticket,ticketMessages,settings}
}

export function createProbeSamples(now: number): ProbeNode[] {
  const data = createDemoData(now)
  // Synthetic movement is deterministic and never invents absent API fields.
  const wave = Math.sin(now / 14_000)
  const full = {sampled_at:Math.floor(now/1000),cpu_percent:24+wave*3,memory_total:8*1024**3,memory_used:3*1024**3,disk_total:80*1024**3,disk_used:16*1024**3,rx_mbps:12.5+wave,tx_mbps:8.2+wave*.6,tcp_connections:87,udp_sockets:12,load1:.35,load5:.3,load15:.4,cpu_ready:true,memory_ready:true,disk_ready:true,network_ready:true,connections_ready:true,load_ready:true}
  return data.nodeGroups.flatMap(group => group.node_ids.map(id => {
    const node = data.nodes.find(value => value.id === id)!
    let metrics: ProbeNode['metrics'] = {...full}
    // Ready=true with an omitted numeric field is the real API's representation of zero.
    if (id===2) metrics = {sampled_at:Math.floor(now/1000),cpu_ready:true,memory_ready:true,memory_total:8*1024**3,disk_ready:true,disk_total:80*1024**3,network_ready:true,connections_ready:true,load_ready:true}
    if (id===3||id===6) metrics = null
    if (id===4) metrics = {...full,cpu_percent:78+wave*2,memory_used:6.4*1024**3,disk_used:52*1024**3,rx_mbps:33+wave*2,tx_mbps:21+wave}
    if (id===5) metrics = {...full,cpu_percent:9+wave,memory_used:1.2*1024**3,rx_mbps:3+wave*.2,tx_mbps:1.5+wave*.1}
    if (id===7) metrics = {cpu_ready:false,memory_ready:false,disk_ready:false,network_ready:false,connections_ready:false,load_ready:false}
    return {id,name:node.name,group_id:group.id,group_name:group.name,enabled:node.enabled,online:node.online,metrics,updated_at:node.online?data.date:data.earlier}
  }))
}
