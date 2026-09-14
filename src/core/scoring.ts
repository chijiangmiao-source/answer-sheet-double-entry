import { OPTIONS, QUESTION_COUNT, type Option } from '../data/questions'
import type {
  Answer,
  AnswerSheet,
  Difference,
  ReviewFlags,
  RoundRecord,
  Verdict
} from './types'

/** 运行时判定单项作答是否合法：未作答（null）或 A/B/C/D 之一。类型系统挡不住外部传入的越界值。 */
function isLegalAnswer(a: Answer): boolean {
  return a === null || (OPTIONS as readonly string[]).includes(a)
}

/** 创建空白答题卡（20 题全部未答）。 */
export function createEmptySheet(): AnswerSheet {
  return Object.freeze(new Array<Answer>(QUESTION_COUNT).fill(null))
}

/** 创建空白待复核标记（20 题均未标记）。 */
export function createEmptyReviewFlags(): ReviewFlags {
  return Object.freeze(new Array<boolean>(QUESTION_COUNT).fill(false))
}

/**
 * 尝试将一轮作答提交为不可修改的内存记录。
 * 以下任一情况拒绝整轮提交并返回 null（不轮次推进、不保存任何数据）：
 * - 答题卡长度不是固定题数（题数不足或超出固定 20 题）；
 * - 存在漏题；
 * - 含规定范围（A/B/C/D）外的非法选项；
 * - 提供了待复核标记但其项数不是 20（结构不完整，缺失位置不能默认成未标记）。
 * 成功时返回冻结后的副本（答案 + 待复核标记），原数组仍归调用方所有。
 * 标记整体缺省（不传第二参数）时按全未标记处理，以兼容只传答案的旧调用方。
 */
export function commitRound(answers: AnswerSheet, reviewFlags?: ReviewFlags): RoundRecord | null {
  if (answers.length !== QUESTION_COUNT) return null // 题数必须恰好为固定 20 题
  if (!answers.every((a) => a !== null)) return null // 存在漏题，拒绝提交
  if (!answers.every(isLegalAnswer)) return null // 存在范围外的非法选项，拒绝整轮数据
  if (reviewFlags !== undefined && reviewFlags.length !== QUESTION_COUNT) return null

  const snapshot = Object.freeze(answers.map((a) => a))
  const flags =
    reviewFlags === undefined
      ? createEmptyReviewFlags()
      : Object.freeze(reviewFlags.map((flagged) => flagged === true))
  return Object.freeze({ answers: snapshot, reviewFlags: flags })
}

/** 裁决入口既接受新的 RoundRecord，也接受旧形态的裸答案数组（按无标记处理）。 */
function asRecord(input: AnswerSheet | RoundRecord): RoundRecord {
  // AnswerSheet 是数组而 RoundRecord 是对象，以是否含 answers 字段区分；
  // 不用 Array.isArray，因为它无法把 readonly 数组从联合类型中窄化出去。
  if ('answers' in input) return input
  return { answers: input, reviewFlags: createEmptyReviewFlags() }
}

/**
 * 逐题裁决两轮记录：
 * 全部一致 => passed=true，score 为 “20/20”；
 * 存在差异 => passed=false，仅列出差异题号、两轮选项及该题各轮是否曾标记待复核。
 * 裁决始终只按答案进行：待复核标记不影响通过与否、一致数与差异集合。
 */
export function adjudicate(
  first: AnswerSheet | RoundRecord,
  second: AnswerSheet | RoundRecord
): Verdict {
  const firstRecord = asRecord(first)
  const secondRecord = asRecord(second)
  const firstSheet = firstRecord.answers
  const secondSheet = secondRecord.answers
  if (firstSheet.length !== QUESTION_COUNT || secondSheet.length !== QUESTION_COUNT) {
    throw new Error('裁决需要两张长度为 20 的答题卡')
  }
  if (!firstSheet.every((a) => a !== null) || !secondSheet.every((a) => a !== null)) {
    throw new Error('只能对两轮完整作答进行裁决')
  }
  if (!firstSheet.every(isLegalAnswer) || !secondSheet.every(isLegalAnswer)) {
    throw new Error('答题卡含规定范围（A/B/C/D）外的非法选项')
  }
  if (
    firstRecord.reviewFlags.length !== QUESTION_COUNT ||
    secondRecord.reviewFlags.length !== QUESTION_COUNT
  ) {
    throw new Error('待复核标记项数必须为 20，缺失位置不得默认成未标记')
  }
  const differences: Difference[] = []
  for (let i = 0; i < QUESTION_COUNT; i++) {
    if (firstSheet[i] !== secondSheet[i]) {
      differences.push(
        Object.freeze({
          number: i + 1,
          first: firstSheet[i] as Option,
          second: secondSheet[i] as Option,
          firstReviewed: firstRecord.reviewFlags[i] === true,
          secondReviewed: secondRecord.reviewFlags[i] === true
        })
      )
    }
  }
  const matched = QUESTION_COUNT - differences.length
  return Object.freeze({
    passed: differences.length === 0,
    score: `${matched}/${QUESTION_COUNT}`,
    differences: Object.freeze(differences)
  })
}
