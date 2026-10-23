/** Only imported by the explicitly enabled demo build. */
export function installDemoNotice(enter: () => Promise<void>) {
  if (typeof document === 'undefined' || document.getElementById('nekopass-demo-notice')) return
  const style = document.createElement('style')
  style.textContent = `
    #nekopass-demo-notice{position:fixed;inset:auto 0 0;min-height:28px;padding:5px 12px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;background:#efe7ff;color:#432b73;border-top:1px solid #d7c8f1;font:12px/18px system-ui,sans-serif;z-index:40;text-align:center}
    #nekopass-demo-notice a,#nekopass-demo-notice button{color:inherit;font:inherit;text-decoration:underline;background:none;border:0;padding:0;cursor:pointer}
    html.dark #nekopass-demo-notice{background:#302543;color:#e7dbff;border-color:#59446d}
    body:has(#nekopass-demo-notice) .workspace{padding-bottom:60px}
    body:has(#nekopass-demo-notice) .sidebar{bottom:42px}
    body:has(#nekopass-demo-notice) .auth-shell{padding-bottom:45px}
    @media(max-width:600px){#nekopass-demo-notice{font-size:11px;gap:8px}#nekopass-demo-notice .demo-long{display:none}}
  `
  document.head.append(style)
  const notice = document.createElement('aside')
  notice.id = 'nekopass-demo-notice'
  notice.setAttribute('aria-label','前端演示说明')
  const text = document.createElement('span')
  text.textContent = '前端演示 · 模拟数据'
  const detail = document.createElement('span')
  detail.className = 'demo-long'
  detail.textContent = '业务提交已停用；备注与排序仅存本地'
  const link = document.createElement('a')
  link.href = '/node_status'
  link.textContent = '节点状态'
  notice.append(text,detail,link)
  if (['/login','/register'].includes(location.pathname)) {
    link.remove()
    detail.textContent = '无需填写真实账号或密码'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = '一键进入演示'
    button.addEventListener('click',async () => {
      button.disabled = true
      try { await enter() } catch (error) { text.textContent = (error as Error).message; button.disabled = false }
    })
    notice.append(button)
  }
  document.body.append(notice)
}
