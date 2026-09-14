import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { adjudicate, commitRound } from '../core/scoring'
import type { Answer, ReviewFlags, RoundRecord, Verdict } from '../core/types'

export type Phase = 'first' | 'second' | 'done'

export interface SessionApi {
  phase: Ref<Phase>
  round: ComputedRef<1 | 2>
  verdict: Ref<Verdict | null>
  submit: (answers: readonly Answer[], reviewFlags?: readonly boolean[]) => boolean
  restart: () => void
}

/**
 * 双录会话状态机。
 *
 * 隔离要点：每轮记录（答案 + 待复核标记）仅保存在闭包局部变量中，
 * SessionApi 不提供任何读取入口；第二轮界面只能得知“当前是第几轮”，
 * 无法读取或预填首录选项，也不能提前读取首录的待复核标记。
 */
export function createSession(): SessionApi {
  const phase = ref<Phase>('first')
  const round = computed<1 | 2>(() => (phase.value === 'first' ? 1 : 2))
  const verdict = ref<Verdict | null>(null)

  /** 闭包持有：组件与外部均无法访问。 */
  let firstRecord: RoundRecord | null = null

  function submit(answers: readonly Answer[], reviewFlags?: readonly boolean[]): boolean {
    if (phase.value === 'done') return false

    const record = commitRound(answers, reviewFlags as ReviewFlags | undefined)
    if (record === null) return false // 存在漏题，停留在当前轮次

    if (phase.value === 'first') {
      firstRecord = record
      phase.value = 'second'
      return true
    }

    // 第二轮：裁决后立即释放首录引用，结果中只保留差异信息。
    verdict.value = adjudicate(firstRecord as RoundRecord, record)
    firstRecord = null
    phase.value = 'done'
    return true
  }

  function restart(): void {
    firstRecord = null
    verdict.value = null
    phase.value = 'first'
  }

  return { phase, round, verdict, submit, restart }
}
