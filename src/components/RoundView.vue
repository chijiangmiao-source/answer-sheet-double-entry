<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { OPTIONS, QUESTIONS, type Option } from '../data/questions'
import type { Answer } from '../core/types'

const props = defineProps<{ round: 1 | 2 }>()
const emit = defineEmits<{ submit: [answers: readonly Answer[]] }>()

/** 本轮作答始终从全空开始；组件以轮次为 key 整体重建，第二轮拿不到任何首录数据。 */
const answers = ref<Answer[]>(QUESTIONS.map(() => null))
const currentIndex = ref(0)
const attempted = ref(false)

const containerRef = ref<HTMLElement | null>(null)
const itemRefs = ref<(HTMLLIElement | null)[]>([])

const missingNumbers = computed(() =>
  attempted.value
    ? answers.value.map((a, i) => (a === null ? i + 1 : -1)).filter((n) => n > 0)
    : []
)
const isComplete = computed(() => answers.value.every((a) => a !== null))

function scrollCurrentIntoView() {
  nextTick(() => {
    const el = itemRefs.value[currentIndex.value]
    // jsdom 等无渲染环境不实现 scrollIntoView，存在时才调用。
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  })
}

function selectOption(option: Option, index: number = currentIndex.value) {
  answers.value[index] = option
  // 作答后自动跳到该题下一题（末题保持原位）；方向键仍可随时回改。
  currentIndex.value = Math.min(index + 1, QUESTIONS.length - 1)
}

function goTo(index: number) {
  if (index >= 0 && index < QUESTIONS.length) currentIndex.value = index
}

function onKeydown(event: KeyboardEvent) {
  const key = event.key.toUpperCase()
  if ((OPTIONS as readonly string[]).includes(key)) {
    event.preventDefault()
    selectOption(key as Option)
    return
  }
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      event.preventDefault()
      goTo(currentIndex.value + 1)
      break
    case 'ArrowUp':
    case 'ArrowLeft':
      event.preventDefault()
      goTo(currentIndex.value - 1)
      break
    default:
      // 其他按键一律忽略。
      break
  }
}

function onSubmit() {
  attempted.value = true
  if (!isComplete.value) return
  emit('submit', answers.value.slice())
}

watch(currentIndex, scrollCurrentIntoView)
onMounted(() => {
  containerRef.value?.focus()
  scrollCurrentIntoView()
})
</script>

<template>
  <section
    ref="containerRef"
    class="round"
    tabindex="0"
    :aria-label="`第 ${props.round} 轮录入`"
    @keydown="onKeydown"
  >
    <header class="round__header">
      <h2>第 {{ props.round }} 轮录入</h2>
      <p class="hint">键盘 A / B / C / D 作答，↑ ↓ 或 ← → 切换题目；其他按键忽略。</p>
    </header>

    <p v-if="missingNumbers.length > 0" class="alert" role="alert" data-testid="missing-summary">
      还有 {{ missingNumbers.length }} 题漏答，无法提交：第 {{ missingNumbers.join('、') }} 题。
    </p>

    <ol class="questions">
      <li
        v-for="(question, index) in QUESTIONS"
        :key="question.number"
        :ref="(el) => (itemRefs[index] = el as HTMLLIElement | null)"
        class="question"
        :class="{
          'question--current': index === currentIndex,
          'question--missing': attempted && answers[index] === null
        }"
        :data-testid="`question-${question.number}`"
        @click="goTo(index)"
      >
        <div class="question__head">
          <span class="question__no">第 {{ question.number }} 题</span>
          <span
            v-if="attempted && answers[index] === null"
            class="question__missing"
            data-testid="missing-marker"
            >此题漏答</span
          >
        </div>
        <p class="question__stem">{{ question.stem }}</p>
        <div class="options" role="radiogroup" :aria-label="`第 ${question.number} 题选项`">
          <button
            v-for="option in question.options"
            :key="option.key"
            type="button"
            class="option"
            :class="{ 'option--selected': answers[index] === option.key }"
            role="radio"
            :aria-checked="answers[index] === option.key"
            :data-testid="`q${question.number}-${option.key}`"
            @click.stop="selectOption(option.key, index)"
          >
            <span class="option__key">{{ option.key }}</span>
            <span class="option__text">{{ option.text }}</span>
          </button>
        </div>
      </li>
    </ol>

    <button type="button" class="submit" data-testid="submit-round" @click="onSubmit">
      提交第 {{ props.round }} 轮
    </button>
  </section>
</template>
