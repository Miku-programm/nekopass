<script setup lang="ts">
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import Icon from './Icon.vue'
import { api, type Me } from './api'
import { site } from './site'
import { setTheme, theme, toggleTransparency } from './theme'

defineProps<{ me?: Me | null; loading?: boolean; navigation?: boolean; menuOpen?: boolean }>()
defineEmits<{ openMenu: [] }>()
const themeLabel = computed(() => ({ system: '跟随系统', light: '浅色模式', dark: '深色模式' })[theme.preference])
function changeTheme(command: string) {
 if (command === 'system' || command === 'light' || command === 'dark') setTheme(command)
}
async function logout() {
 try { await api('logout', 'POST', {}); location.assign('/login') }
 catch (e) { ElMessage.error((e as Error).message) }
}
</script>

<template>
 <header class="topbar">
  <div class="topbar-brand">
   <button v-if="navigation" class="mobile-menu icon-button" type="button" aria-label="打开导航菜单" :aria-expanded="!!menuOpen" @click="$emit('openMenu')"><Icon name="menu" /></button>
   <a href="/" :aria-label="site.name"><span class="brand-site-name">{{ site.name }}</span></a>
  </div>
  <div class="topbar-actions">
   <el-skeleton v-if="loading" class="account-loading" animated><template #template><el-skeleton-item variant="text" /></template></el-skeleton>
   <el-dropdown v-else trigger="click">
    <el-button class="account-button" aria-label="账号菜单"><span class="account-name">{{ me?.username || '未登录' }}</span><span class="account-divider"></span><Icon name="user" /></el-button>
    <template #dropdown><el-dropdown-menu>
     <el-dropdown-item v-if="me"><a href="/profile">个人中心</a></el-dropdown-item>
     <el-dropdown-item v-if="me" divided @click="logout">退出登录</el-dropdown-item>
     <el-dropdown-item v-else><a href="/login">登录</a></el-dropdown-item>
    </el-dropdown-menu></template>
   </el-dropdown>
   <el-dropdown trigger="click" @command="changeTheme">
    <button class="icon-button" type="button" :title="'主题：' + themeLabel" :aria-label="'选择主题，当前' + themeLabel"><Icon :name="theme.dark ? 'sun' : 'moon'" /></button>
    <template #dropdown><el-dropdown-menu>
     <el-dropdown-item command="system" :disabled="theme.preference === 'system'">跟随系统</el-dropdown-item>
     <el-dropdown-item command="light" :disabled="theme.preference === 'light'">浅色模式</el-dropdown-item>
     <el-dropdown-item command="dark" :disabled="theme.preference === 'dark'">深色模式</el-dropdown-item>
    </el-dropdown-menu></template>
   </el-dropdown>
   <button class="icon-button" type="button" :title="theme.transparent ? '关闭透明主题' : '开启透明主题'" :aria-label="theme.transparent ? '关闭透明主题' : '开启透明主题'" :aria-pressed="theme.transparent" @click="toggleTransparency"><Icon name="palette" /></button>
  </div>
 </header>
</template>
