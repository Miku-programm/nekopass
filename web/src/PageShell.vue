<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppHeader from './AppHeader.vue'
import ShellNavigation from './ShellNavigation.vue'
import type { Me } from './api'
const props = defineProps<{ me: Me | null; loading: boolean; error: string; active: string; admin?: boolean }>()
const menuOpen = ref(false)
const allowed = computed(() => !!props.me && (!props.admin || props.me.is_admin))
let mobileQuery: MediaQueryList | undefined
function closeDesktopDrawer() { if (!mobileQuery?.matches) menuOpen.value = false }
onMounted(() => {
 mobileQuery = window.matchMedia('(max-width: 799px)')
 mobileQuery.addEventListener('change', closeDesktopDrawer)
})
onUnmounted(() => mobileQuery?.removeEventListener('change', closeDesktopDrawer))
function retry() { location.reload() }
</script>
<template>
 <main v-if="!loading && !allowed" class="page-load-error surface"><h2>暂时无法加载页面</h2><p>{{ error || (me ? '当前账号无法访问此页面' : '请登录后重试') }}</p><a href="/login">返回登录页</a><el-button @click="retry">重试</el-button></main>
 <div v-else class="app-shell">
  <AppHeader :me="me" :loading="loading && !me" navigation :menu-open="menuOpen" @open-menu="menuOpen=true" />
  <aside class="sidebar"><el-skeleton v-if="!allowed" class="sidebar-loading" :rows="5" animated /><ShellNavigation v-else :active="active" :admin="admin" :is-admin="!!me?.is_admin" /></aside>
  <el-drawer v-model="menuOpen" class="mobile-nav-drawer" body-class="mobile-nav-body" title="导航菜单" direction="ltr" size="280px" append-to-body :close-on-press-escape="true" :lock-scroll="true" destroy-on-close>
   <el-skeleton v-if="!allowed" :rows="5" animated />
   <ShellNavigation v-else :active="active" :admin="admin" :is-admin="!!me?.is_admin" @navigate="menuOpen=false" />
  </el-drawer>
  <main class="workspace">
   <el-alert v-if="error" class="page-load-alert" :title="error" type="error" :closable="false" />
   <div v-if="loading || !allowed" class="page-content-loading surface" role="status" aria-live="polite"><el-skeleton :rows="5" animated /><p>正在加载…</p></div>
   <slot v-else />
  </main>
 </div>
</template>
