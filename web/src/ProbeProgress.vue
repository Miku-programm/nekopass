<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ value: number | null; label: string; variant: 'cpu' | 'resource' | 'card' }>()
const percent = computed(() => props.value === null ? null : Math.max(0, Math.min(100, props.value)))
const color = computed(() => props.variant === 'card' ? (percent.value !== null && percent.value >= 75 ? '#ff6d1b' : '#2da66b') : props.variant === 'cpu' ? '#f50057' : '#6750a4')
</script>
<template><div class="progress-chip" :class="{ compact: variant === 'card', unknown: percent === null }" role="progressbar" :aria-label="label" :aria-valuenow="percent ?? undefined" :aria-valuetext="percent === null ? '暂无数据' : percent.toFixed(1) + '%'" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" :style="{ transform: `scaleX(${(percent ?? 0) / 100})`, background: color }"></div><span v-if="variant !== 'card'" class="progress-text">{{ percent === null ? '—' : percent.toFixed(1) + '%' }}</span></div></template>
<style scoped>
.progress-chip { position:relative; overflow:hidden; width:128px; height:32px; border-radius:8px; background:var(--probe-dim,#ddd8dd); }
.progress-fill { position:absolute; inset:0; transform-origin:left; transition:transform .3s linear; }
.progress-text { position:relative; display:flex; height:100%; align-items:center; padding-left:10px; color:#fff; text-shadow:0 0 2px #000a; font-size:16px; font-weight:800; line-height:1; }
.progress-chip.compact { width:100%; height:8px; border-radius:8px; }
.progress-chip.unknown .progress-text { color:var(--probe-muted,#49454e); text-shadow:none; font-weight:400; }
@media(prefers-reduced-motion:reduce) { .progress-fill { transition:none; } }
</style>
