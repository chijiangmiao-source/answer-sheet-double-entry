import type { Option } from '../data/questions'

/** 单题作答：未作答为 null，否则为 A/B/C/D。 */
export type Answer = Option | null

/** 一张答题卡，按题目顺序排列，长度固定为 20。 */
export type AnswerSheet = readonly Answer[]

export interface MissingQuestion {
  /** 题号（1 起）。 */
  readonly number: number
}

/** 单题差异裁决结果。 */
export interface Difference {
  readonly number: number
  readonly first: Option
  readonly second: Option
}

export interface Verdict {
  readonly passed: boolean
  /** 形如 “20/20” 的一致题数展示。 */
  readonly score: string
  readonly differences: readonly Difference[]
}
