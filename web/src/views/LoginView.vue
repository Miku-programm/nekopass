<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api, type Me } from '../api'
import { safeReturnPath } from '../page'
import AuthShell from '../AuthShell.vue'
import Icon from '../Icon.vue'
const form = reactive({username:new URLSearchParams(location.search).get('email')||'',password:''}), busy = ref(false),registrationEnabled=ref(false)
onMounted(async()=>{try{registrationEnabled.value=(await api<{enabled:boolean}>('registration')).enabled}catch{/* registration unavailable */}})
async function login() {
 if (busy.value) return
 busy.value=true
 try {
  await api<Me>('login','POST',form)
  form.password=''
  let me: Me
  try { me=await api<Me>('me') } catch { throw new Error('登录状态未能保存，请确认浏览器允许本站 Cookie 后重试。') }
  location.assign(safeReturnPath(new URLSearchParams(location.search).get('next'),me.is_admin))
 } catch(e) { ElMessage.error((e as Error).message) } finally { busy.value=false }
}
</script>
<template>
 <AuthShell title="登录">
  <el-form class="auth-form" @submit.prevent="login">
   <el-form-item><el-input v-model="form.username" aria-label="用户名" placeholder="用户名" autocomplete="username"><template #prefix><Icon name="user" /></template></el-input></el-form-item>
   <el-form-item><el-input v-model="form.password" aria-label="密码" placeholder="密码" type="password" show-password autocomplete="current-password"><template #prefix><Icon name="lock" /></template></el-input></el-form-item>
   <div class="auth-actions"><el-button type="primary" native-type="submit" :loading="busy">登录</el-button><a v-if="registrationEnabled" class="text-link" href="/register">前往注册</a></div>
  </el-form>
 </AuthShell>
</template>
