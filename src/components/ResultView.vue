<script setup lang="ts">
import type { Verdict } from '../core/types'

defineProps<{ verdict: Verdict }>()
const emit = defineEmits<{ restart: [] }>()
</script>

<template>
  <section class="result" data-testid="result">
    <h2>核对结果</h2>
    <p
      class="result__status"
      :class="verdict.passed ? 'result__status--pass' : 'result__status--fail'"
    >
      <span class="result__label">结论：</span>
      <span data-testid="verdict-text">{{ verdict.passed ? '通过' : '不通过' }}</span>
    </p>
    <p class="result__score" data-testid="verdict-score">{{ verdict.score }}</p>

    <div v-if="!verdict.passed" class="result__diffs" data-testid="diffs">
      <h3>差异明细（仅列差异题）</h3>
      <table>
        <thead>
          <tr>
            <th>题号</th>
            <th>首录</th>
            <th>第二遍</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in verdict.differences" :key="d.number" :data-testid="`diff-${d.number}`">
            <td>第 {{ d.number }} 题</td>
            <td>
              {{ d.first }}
              <span
                v-if="d.firstReviewed"
                class="result__review"
                :data-testid="`diff-${d.number}-first-review`"
                >首录待复核</span
              >
            </td>
            <td>
              {{ d.second }}
              <span
                v-if="d.secondReviewed"
                class="result__review"
                :data-testid="`diff-${d.number}-second-review`"
                >第二遍待复核</span
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="result__ok">两轮答案逐题一致，无需处理。</p>

    <button type="button" class="submit" data-testid="restart" @click="emit('restart')">
      重新开始
    </button>
  </section>
</template>
