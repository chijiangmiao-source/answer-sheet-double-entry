<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { OPTIONS } from '../data/questions'
import { acceptKey, start, type PracticeSession } from '../core/practice'

const emit = defineEmits<{ exit: [] }>()

/**
 * 键位校准视图。
 *
 * 校准会话只存在于本组件内存：离开训练页（组件被 v-if 卸载）或刷新即丢弃，
 * 不写入答卡会话、不参与裁决。组件只提交按键并消费领域模块返回的不可变会话，
 * 不直接改写进度或统计。
 */
const session = ref<PracticeSession | null>(null)
const containerRef = ref<HTMLElement | null>(null)

const currentTarget = computed(() => {
  const s = session.value
  return s && !s.done ? s.targets[s.index] : null
})

const misstepsText = computed(() => {
  const s = session.value
  return s && s.missteps.length > 0 ? `第 ${s.missteps.join('、')} 题` : '无'
})

/**
 * 开一场全新校准：种子取自浏览器随机源，并要求新序列与上一场不同，
 * 保证“重新校准”得到的必然是全新会话（进度与统计全部归零）。
 */
function begin() {
  const previous = session.value
  let next: PracticeSession
  do {
    next = start((Math.random() * 0x100000000) >>> 0)
  } while (previous !== null && next.targets.join('') === previous.targets.join(''))
  session.value = next
  // 开始按钮随界面切换被移除，焦点交还训练区，保证后续按键被接收。
  nextTick(() => containerRef.value?.focus())
}

function onKeydown(event: KeyboardEvent) {
  const s = session.value
  if (!s || s.done) return
  if (event.repeat) return // 浏览器自动重复（按住不放）不计数
  // 带 Ctrl / Cmd / Alt 的组合键属于浏览器/系统快捷键，一律忽略。
  if (event.ctrlKey || event.metaKey || event.altKey) return
  // 领域函数对 A-D 以外的按键原样返回同一会话；只有真正消费按键才更新状态。
  const next = acceptKey(s, event.key)
  if (next !== s) {
    event.preventDefault()
    session.value = next
  }
}

onMounted(() => containerRef.value?.focus())
</script>

<template>
  <section
    ref="containerRef"
    class="practice"
    tabindex="0"
    aria-label="键位校准"
    @keydown="onKeydown"
  >
    <header class="practice__header">
      <h2>键位校准</h2>
      <p class="hint">
        正式双录前确认 A / B / C / D 键位输入可靠：共 20 步，页面只显示当前题号与目标字母；
        按下目标字母自动前进，按错可继续尝试（每题只记首次误按）；其余按键、Ctrl/Cmd/Alt
        组合键与按住不放的自动重复一律不计数。校准数据不进入答卡会话与裁决结果，离开本页或刷新即丢弃。
      </p>
    </header>

    <div v-if="!session" class="practice__idle" data-testid="practice-idle">
      <button type="button" class="submit" data-testid="practice-start" @click="begin">
        开始校准
      </button>
    </div>

    <div v-else-if="!session.done" class="practice__running" data-testid="practice-running">
      <p class="practice__step" data-testid="practice-step">
        第 {{ session.index + 1 }} / 20 题
      </p>
      <p class="practice__target" data-testid="practice-target">{{ currentTarget }}</p>
      <p class="practice__tip">请按键盘上的对应字母键</p>
      <button type="button" class="practice__again" data-testid="practice-restart" @click="begin">
        重新校准
      </button>
    </div>

    <div v-else class="practice__done" data-testid="practice-done">
      <h3>校准完成</h3>
      <p class="practice__hits" data-testid="practice-first-hits">
        首次命中：{{ session.firstHits }} / 20
      </p>
      <p class="practice__missteps" data-testid="practice-missteps">
        误按题号：{{ misstepsText }}
      </p>
      <ul class="practice__misses" data-testid="practice-misses">
        <li
          v-for="letter in OPTIONS"
          :key="letter"
          :data-testid="`practice-miss-${letter}`"
        >
          {{ letter }}：{{ session.missesByLetter[letter] }} 次
        </li>
      </ul>
      <button type="button" class="submit" data-testid="practice-restart" @click="begin">
        重新校准
      </button>
    </div>

    <button type="button" class="practice__exit" data-testid="practice-exit" @click="emit('exit')">
      返回首页
    </button>
  </section>
</template>
