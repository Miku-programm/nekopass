import { reactive, readonly } from 'vue'

type ThemePreference = 'system' | 'light' | 'dark'
const themeKey = 'nekopass-theme-v3'
const transparentKey = 'nekopass-transparent-v1'
const state = reactive({ preference: 'system' as ThemePreference, dark: false, transparent: false })
export const theme = readonly(state)
let initialized = false
let systemTheme: MediaQueryList | undefined

function readPreference(key: string) {
 try { return localStorage.getItem(key) } catch { return null }
}
function savePreference(key: string, value: string) {
 try { localStorage.setItem(key, value) } catch { /* The current page still honors the choice when storage is unavailable. */ }
}
function renderTheme() {
 state.dark = state.preference === 'dark' || (state.preference === 'system' && !!systemTheme?.matches)
 const root = document.documentElement
 root.classList.toggle('dark', state.dark)
 root.classList.toggle('theme-transparent', state.transparent)
 root.dataset.theme = state.dark ? 'dark' : 'light'
 root.dataset.themePreference = state.preference
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content', state.dark ? '#141414' : '#b3b3b3')
}
export function initializeTheme() {
 if (initialized) return
 initialized = true
 systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)')
 const saved = readPreference(themeKey)
 state.preference = saved === 'light' || saved === 'dark' ? saved : 'system'
 state.transparent = readPreference(transparentKey) === 'true'
 systemTheme?.addEventListener('change', renderTheme)
 window.addEventListener('storage', event => {
  if (event.key === themeKey || event.key === null) {
   const saved = readPreference(themeKey)
   state.preference = saved === 'light' || saved === 'dark' ? saved : 'system'
  }
  if (event.key === transparentKey || event.key === null) state.transparent = readPreference(transparentKey) === 'true'
  renderTheme()
 })
 renderTheme()
}
export function setTheme(preference: ThemePreference) {
 state.preference = preference
 savePreference(themeKey, preference)
 renderTheme()
}
export function toggleTransparency() {
 state.transparent = !state.transparent
 savePreference(transparentKey, String(state.transparent))
 renderTheme()
}
