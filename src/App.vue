<script setup lang="ts">
import { ref } from 'vue'
import RoundView from './components/RoundView.vue'
import ResultView from './components/ResultView.vue'
import { createSession } from './composables/useSession'
import type { Answer } from './core/types'

const { phase, round, verdict, submit, restart } = createSession()

/** 每次重新开始递增，配合轮次作为 key，强制录入视图整体重建为空白状态。 */
const sessionId = ref(0)

function onSubmit(answers: readonly Answer[], reviewFlags: readonly boolean[]) {
  submit(answers, reviewFlags)
}

function onRestart() {
  restart()
  sessionId.value += 1
}
</script>

<template>
  <main class="app">
    <h1>纸质答题卡双录核对台</h1>
    <RoundView
      v-if="phase !== 'done'"
      :key="`${sessionId}-${round}`"
      :round="round"
      @submit="onSubmit"
    />
    <ResultView v-else :verdict="verdict!" @restart="onRestart" />
  </main>
</template>
