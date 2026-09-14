<script setup lang="ts">
import { ref } from 'vue'
import RoundView from './components/RoundView.vue'
import ResultView from './components/ResultView.vue'
import PracticeView from './components/PracticeView.vue'
import { createSession } from './composables/useSession'
import type { Answer } from './core/types'

const { phase, round, verdict, submit, restart } = createSession()

/** 每次重新开始递增，配合轮次作为 key，强制录入视图整体重建为空白状态。 */
const sessionId = ref(0)

/**
 * 视图切换：entry 为双录首页（默认流程不变），practice 为键位校准。
 * 双录区用 v-show 保持挂载，校准期间的来回切换不丢失录入进度；
 * 校准视图用 v-if，离开即卸载，本次校准数据随之丢弃，绝不进入答卡会话。
 */
const view = ref<'entry' | 'practice'>('entry')

function onSubmit(answers: readonly Answer[], reviewFlags: readonly boolean[]) {
  submit(answers, reviewFlags)
}

function onRestart() {
  restart()
  sessionId.value += 1
}

function openPractice() {
  view.value = 'practice'
}

function closePractice() {
  view.value = 'entry'
}
</script>

<template>
  <main class="app">
    <h1>纸质答题卡双录核对台</h1>
    <div v-show="view === 'entry'" class="home">
      <p class="home__entry">
        <button
          type="button"
          class="home__practice"
          data-testid="practice-entry"
          @click="openPractice"
        >
          键位校准
        </button>
        <span class="home__note">正式双录前可先校准 A / B / C / D 键位；校准数据不进入答卡与裁决。</span>
      </p>
      <RoundView
        v-if="phase !== 'done'"
        :key="`${sessionId}-${round}`"
        :round="round"
        @submit="onSubmit"
      />
      <ResultView v-else :verdict="verdict!" @restart="onRestart" />
    </div>
    <PracticeView v-if="view === 'practice'" @exit="closePractice" />
  </main>
</template>
