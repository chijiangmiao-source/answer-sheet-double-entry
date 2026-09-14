<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { OPTIONS, QUESTIONS, type Option } from '../data/questions'
import { parseBatchAnswers } from '../core/batchParse'
import type { Answer } from '../core/types'

const props = defineProps<{ round: 1 | 2 }>()
const emit = defineEmits<{ submit: [answers: readonly Answer[]] }>()

/** 本轮作答始终从全空开始；组件以轮次为 key 整体重建，第二轮拿不到任何首录数据。 */
const answers = ref<Answer[]>(QUESTIONS.map(() => null))
const currentIndex = ref(0)
const attempted = ref(false)

/**
 * 批量填入区只维护草稿与校验结果；确认前不触碰答卡，
 * 确认时一次性整体写入，关闭填入区不影响任何已录答案。
 */
const batchOpen = ref(false)
const batchDraft = ref('')
const batchCheck = computed(() => parseBatchAnswers(batchDraft.value))
const batchSheet = computed<readonly Option[]>(() =>
  batchCheck.value.ok ? batchCheck.value.sheet : []
)

/** 不可见非法字符（如制表符）以转义形式展示，方便定位。 */
function displayChar(char: string): string {
  const escapes: Record<string, string> = { '\t': '\\t', '\v': '\\v', '\f': '\\f', '\0': '\\0' }
  return escapes[char] ?? char
}

const batchErrorText = computed(() => {
  if (batchCheck.value.ok) return ''
  const error = batchCheck.value.error
  if (error.kind === 'invalid-char') {
    return `第 ${error.index + 1} 个字符“${displayChar(error.char)}”无法识别：只接受 A / B / C / D 与空格、逗号、换行。`
  }
  return `当前解析出 ${error.count} 个选项，需要恰好 20 个才能写入。`
})

function toggleBatch() {
  batchOpen.value = !batchOpen.value
}

function applyBatch() {
  if (!batchCheck.value.ok) return // 按钮已禁用，这里再兜一层，保证不合法绝不写入
  // 原子写入：一次性整体替换本轮答卡，不存在部分覆盖的中间态；
  // 复制一份可变数组，与冻结的解析结果隔离。
  answers.value = batchCheck.value.sheet.slice()
  batchDraft.value = ''
  batchOpen.value = false
}

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
      <p class="hint">
        键盘 A / B / C / D 作答，↑ ↓ 或 ← → 切换题目；其他按键忽略。也可打开批量填入，粘贴扫描枪或 OCR 结果。
      </p>
    </header>

    <div class="batch">
      <button type="button" class="batch__toggle" data-testid="batch-toggle" @click="toggleBatch">
        {{ batchOpen ? '收起批量填入' : '批量填入（扫描枪 / OCR）' }}
      </button>

      <div v-if="batchOpen" class="batch__panel" data-testid="batch-panel">
        <label class="batch__label" for="batch-input">
          粘贴由 A / B / C / D（大小写均可）及空格、逗号、换行组成的文本，恰好 20 个选项；
          输入框内的按键不会录入答卡。
        </label>
        <textarea
          id="batch-input"
          v-model="batchDraft"
          class="batch__input"
          data-testid="batch-input"
          rows="4"
          spellcheck="false"
          placeholder="例如：A B C D, A B C D …（共 20 个）"
          @keydown.stop
        ></textarea>

        <p
          v-if="batchDraft && !batchCheck.ok"
          class="batch__error"
          role="alert"
          data-testid="batch-error"
        >
          {{ batchErrorText }}
        </p>

        <div v-if="batchSheet.length > 0" class="batch__preview" data-testid="batch-preview">
          <p class="batch__summary">
            已解析 {{ batchSheet.length }}/20 个选项，确认后一次性写入本轮答卡（现有答案将被整体覆盖）：
          </p>
          <ol class="batch__list">
            <li v-for="(option, index) in batchSheet" :key="index" class="batch__item">
              <span class="batch__no">{{ index + 1 }}</span>
              <span class="batch__opt">{{ option }}</span>
            </li>
          </ol>
        </div>

        <button
          type="button"
          class="batch__apply"
          data-testid="batch-apply"
          :disabled="!batchCheck.ok"
          @click="applyBatch"
        >
          确认写入本轮答卡
        </button>
      </div>
    </div>

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
