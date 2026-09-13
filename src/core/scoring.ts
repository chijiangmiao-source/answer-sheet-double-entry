import { QUESTION_COUNT, type Option } from '../data/questions'
import type { Answer, AnswerSheet, Difference, Verdict } from './types'

/** 创建空白答题卡（20 题全部未答）。 */
export function createEmptySheet(): AnswerSheet {
  return Object.freeze(new Array<Answer>(QUESTION_COUNT).fill(null))
}

/**
 * 尝试将一轮作答提交为不可修改的内存快照。
 * 存在漏题时返回 null；成功时返回冻结后的副本，原数组仍归调用方所有。
 */
export function commitRound(answers: AnswerSheet): AnswerSheet | null {
  const snapshot = Object.freeze(answers.map((a) => a))
  return snapshot.every((a) => a !== null) ? snapshot : null
}

/**
 * 逐题裁决两张完整快照：
 * 全部一致 => passed=true，score 为 “20/20”；
 * 存在差异 => passed=false，仅列出差异题号及两轮选项。
 */
export function adjudicate(first: AnswerSheet, second: AnswerSheet): Verdict {
  if (first.length !== QUESTION_COUNT || second.length !== QUESTION_COUNT) {
    throw new Error('裁决需要两张长度为 20 的答题卡')
  }
  if (!first.every((a) => a !== null) || !second.every((a) => a !== null)) {
    throw new Error('只能对两轮完整作答进行裁决')
  }
  const differences: Difference[] = []
  for (let i = 0; i < QUESTION_COUNT; i++) {
    if (first[i] !== second[i]) {
      differences.push({
        number: i + 1,
        first: first[i] as Option,
        second: second[i] as Option
      })
    }
  }
  const matched = QUESTION_COUNT - differences.length
  return Object.freeze({
    passed: differences.length === 0,
    score: `${matched}/${QUESTION_COUNT}`,
    differences: Object.freeze(differences)
  })
}
