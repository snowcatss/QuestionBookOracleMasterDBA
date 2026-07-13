<script setup lang="ts">
import { computed } from 'vue'
import type { UserStatsRow } from '@/types/database'

const props = defineProps<{ stats: UserStatsRow }>()

const rows = computed(() => [
  {
    label: 'ヒット',
    char: 'ヒ',
    metric: `${props.stats.hit_pct.toFixed(0)}%`,
    filled: props.stats.hit_stamps,
  },
  {
    label: 'コンボ',
    char: 'コ',
    metric: `${props.stats.combo_pct.toFixed(0)}%`,
    filled: props.stats.combo_stamps,
  },
  {
    label: '模試 80%',
    char: '模',
    metric: `${props.stats.mock80_stamps}回`,
    filled: props.stats.mock80_stamps,
  },
  {
    label: '模試 90%',
    char: '模',
    metric: `${props.stats.mock90_stamps}回`,
    filled: props.stats.mock90_stamps,
  },
])
</script>

<template>
  <div class="space-y-3">
    <div v-for="row in rows" :key="row.label" class="flex items-center">
      <div class="w-24 shrink-0 flex items-baseline gap-2">
        <span class="font-bold text-sm">{{ row.label }}</span>
        <span class="text-red-500 text-xs font-bold">{{ row.metric }}</span>
      </div>
      <div class="flex gap-1.5 flex-wrap">
        <div
          v-for="n in 10"
          :key="n"
          class="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition"
          :class="
            n <= row.filled
              ? 'bg-cyan-500 border-cyan-500 text-white'
              : 'bg-white border-gray-200 text-gray-300'
          "
        >
          {{ row.char }}
        </div>
      </div>
    </div>
  </div>
</template>
