<script setup lang="ts">
import AppHeader from './AppHeader.vue'
defineProps<{ title: string }>()
</script>

<template>
 <div class="auth-shell">
  <AppHeader />
  <main class="login-page">
   <section class="login-card surface">
    <h1 class="auth-title">{{ title }}</h1>
    <div class="auth-body"><slot /></div>
   </section>
  </main>
 </div>
</template>
