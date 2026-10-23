<script setup lang="ts">
import { ref, useId } from 'vue'
import Icon from './Icon.vue'

const props = defineProps<{ active: string; admin?: boolean; isAdmin: boolean }>()
defineEmits<{ navigate: [] }>()
const adminOpen = ref(true)
const adminMenuId = useId()
const path = location.pathname.replace(/\/+$/, '') || '/'
const userLinks = [
 { path: '/', label: '主页', icon: 'home', key: 'home' },
 { path: '/profile', label: '个人中心', icon: 'user', key: 'profile' },
 { path: '/forward_rules', label: '转发规则', icon: 'rules', key: 'rules' },
 { path: '/shop', label: '商城', icon: 'shop', key: 'shop' },
 { path: '/orders', label: '我的订单', icon: 'orders', key: 'orders' },
 { path: '/tickets', label: '工单', icon: 'message', key: 'tickets' },
 { path: '/referrals', label: '邀请返利', icon: 'gift', key: 'referrals' },
 { path: '/node_status', label: '节点状态', icon: 'node', key: 'probe' },
]
const adminLinks = [
 { path: '/admin', label: '仪表盘', icon: 'stats', key: 'admin' },
 { path: '/admin/settings', label: '站点设置', icon: 'settings', key: 'settings' },
 { path: '/admin/users', label: '用户管理', icon: 'user', key: 'users' },
 { path: '/admin/orders', label: '订单管理', icon: 'orders', key: 'orders' },
 { path: '/admin/plans', label: '套餐管理', icon: 'shop', key: 'plans' },
 { path: '/admin/nodes', label: '节点管理', icon: 'node', key: 'nodes' },
 { path: '/admin/node_groups', label: '节点分组', icon: 'folder', key: 'node_groups' },
 { path: '/admin/tickets', label: '工单管理', icon: 'message', key: 'tickets' },
 { path: '/admin/announcements', label: '公告管理', icon: 'notification', key: 'announcements' },
 { path: '/admin/payment_gateways', label: '支付方式', icon: 'wallet', key: 'payment_gateways' },
]
function activeAdmin(key: string) {
 if (!props.admin) return false
 if (path === '/admin/node_groups') return key === 'node_groups'
 return props.active === key
}
</script>

<template>
 <nav class="shell-nav" aria-label="主导航">
  <a v-for="item in userLinks" :key="item.path" :href="item.path" :class="{ active: !admin && active === item.key }" :aria-current="!admin && active === item.key ? 'page' : undefined" @click="$emit('navigate')"><Icon :name="item.icon" /><span>{{ item.label }}</span></a>
  <template v-if="isAdmin">
   <button class="admin-nav-toggle" type="button" :aria-expanded="adminOpen" :aria-controls="adminMenuId" @click="adminOpen = !adminOpen"><Icon name="settings" /><span>管理</span><Icon name="chevron" class="nav-chevron" :class="{ expanded: adminOpen }" /></button>
   <div v-show="adminOpen" :id="adminMenuId" class="admin-nav-links">
    <a v-for="item in adminLinks" :key="item.path" :href="item.path" :class="{ active: activeAdmin(item.key) }" :aria-current="activeAdmin(item.key) ? 'page' : undefined" @click="$emit('navigate')"><Icon :name="item.icon" /><span>{{ item.label }}</span></a>
   </div>
  </template>
 </nav>
</template>
