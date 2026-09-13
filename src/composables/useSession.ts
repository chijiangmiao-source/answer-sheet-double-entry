import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { adjudicate, commitRound } from '../core/scoring'
import type { Answer, AnswerSheet, Verdict } from '../core/types'

export type Phase = 'first' | 'second' | 'done'

export interface SessionApi {
  phase: Ref<Phase>
  round: ComputedRef<1 | 2>
  verdict: Ref<Verdict | null>
  submit: (answers: readonly Answer[]) => boolean
  restart: () => void
}

/**
 * 双录会话状态机。
 *
 * 隔离要点：首录快照仅保存在闭包局部变量中，SessionApi 不提供任何读取入口；
 * 第二轮界面只能得知“当前是第几轮”，无法读取或预填首录选项。
 */
export function createSession(): SessionApi {
  const phase = ref<Phase>('first')
  const round = computed<1 | 2>(() => (phase.value === 'first' ? 1 : 2))
  const verdict = ref<Verdict | null>(null)

  /** 闭包持有：组件与外部均无法访问。 */
  let firstSnapshot: AnswerSheet | null = null

  function submit(answers: readonly Answer[]): boolean {
    if (phase.value === 'done') return false

    const snapshot = commitRound(answers)
    if (snapshot === null) return false // 存在漏题，停留在当前轮次

    if (phase.value === 'first') {
      firstSnapshot = snapshot
      phase.value = 'second'
      return true
    }

    // 第二轮：裁决后立即释放首录引用，结果中只保留差异信息。
    verdict.value = adjudicate(firstSnapshot as AnswerSheet, snapshot)
    firstSnapshot = null
    phase.value = 'done'
    return true
  }

  function restart(): void {
    firstSnapshot = null
    verdict.value = null
    phase.value = 'first'
  }

  return { phase, round, verdict, submit, restart }
}
