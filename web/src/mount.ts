import { createApp, type Component } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './style.css'
import {loadSite} from './site'
import { initializeTheme, setTheme } from './theme'

export function applyTheme(dark: boolean) { setTheme(dark ? 'dark' : 'light') }
export function mount(component: Component, props: Record<string, unknown> = {}) {
 initializeTheme()
 window.addEventListener('pageshow', e => { if (e.persisted) location.reload() })
 createApp(component, props).use(ElementPlus, { locale: zhCn }).mount('#app')
 void loadSite()
}
