import type { Option } from '../data/questions'

/** 单题作答：未作答为 null，否则为 A/B/C/D。 */
export type Answer = Option | null

/** 一张答题卡，按题目顺序排列，长度固定为 20。 */
export type AnswerSheet = readonly Answer[]

/**
 * 一轮内各题的“待复核”标记，与答题卡逐题对应：
 * true 表示该题在本轮曾被标记（纸面模糊或涂改，需要人工复核）。
 * 标记独立于答案存在：不进入编辑轨迹、不影响焦点与完整性判断。
 */
export type ReviewFlags = readonly boolean[]

/**
 * 一轮提交对象的只读记录：答案与待复核题号一并冻结保存，互不影响。
 * 裁决只依据 answers；reviewFlags 仅用于最终差异行的提示。
 */
export interface RoundRecord {
  readonly answers: AnswerSheet
  readonly reviewFlags: ReviewFlags
}

export interface MissingQuestion {
  /** 题号（1 起）。 */
  readonly number: number
}

/** 单题差异裁决结果。 */
export interface Difference {
  readonly number: number
  readonly first: Option
  readonly second: Option
  /** 首录该题是否曾标记待复核。 */
  readonly firstReviewed: boolean
  /** 复录该题是否曾标记待复核。 */
  readonly secondReviewed: boolean
}

export interface Verdict {
  readonly passed: boolean
  /** 形如 “20/20” 的一致题数展示。 */
  readonly score: string
  readonly differences: readonly Difference[]
}
