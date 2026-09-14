import { OPTIONS, QUESTION_COUNT, type Option } from '../data/questions'

/** 批量文本中允许的分隔符：空格、逗号、换行（\r\n 中的 \r 一并视为换行）。 */
const SEPARATORS: ReadonlySet<string> = new Set([' ', ',', '\n', '\r'])

/** 文本中含有 A/B/C/D 与分隔符以外的字符。 */
export interface InvalidCharError {
  readonly kind: 'invalid-char'
  /** 首个非法字符本身。 */
  readonly char: string
  /** 该字符在原文本中的下标（0 起）。 */
  readonly index: number
}

/** 解析出的选项数量不是 20。 */
export interface WrongCountError {
  readonly kind: 'wrong-count'
  /** 实际解析出的选项个数。 */
  readonly count: number
}

export type BatchError = InvalidCharError | WrongCountError

export type NormalizeResult =
  | { readonly ok: true; readonly options: readonly Option[] }
  | { readonly ok: false; readonly error: InvalidCharError }

export type BatchParseResult =
  | { readonly ok: true; readonly sheet: readonly Option[] }
  | { readonly ok: false; readonly error: BatchError }

/**
 * 答案规范化（纯函数）：把批量文本中的分隔符（空格 / 逗号 / 换行）归一化，
 * 按出现顺序逐个提取选项字母；大小写均可，统一规范为大写。
 * 遇到首个非法字符时立即返回该字符及其在原文本中的位置，后续内容不再检查。
 */
export function normalizeBatchText(text: string): NormalizeResult {
  const options: Option[] = []
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (SEPARATORS.has(char)) continue
    const upper = char.toUpperCase()
    if ((OPTIONS as readonly string[]).includes(upper)) {
      options.push(upper as Option)
    } else {
      return { ok: false, error: { kind: 'invalid-char', char, index } }
    }
  }
  return { ok: true, options: Object.freeze(options) }
}

/**
 * 位置映射（纯函数）：把规范化后的选项序列按顺序映射到第 1…20 题。
 * 数量恰好为 20 时返回完整答题卡；否则返回携带当前数量的错误，
 * 调用方不得据此做任何部分写入。
 */
export function mapOptionsToSheet(options: readonly Option[]): BatchParseResult {
  if (options.length !== QUESTION_COUNT) {
    return { ok: false, error: { kind: 'wrong-count', count: options.length } }
  }
  return { ok: true, sheet: Object.freeze(options.slice()) }
}

/**
 * 规范化 + 位置映射的组合：批量文本 → 恰好 20 题的完整答题卡。
 * 非法字符优先于数量错误返回；任一阶段失败即整体失败，保证写入只能是原子的。
 */
export function parseBatchAnswers(text: string): BatchParseResult {
  const normalized = normalizeBatchText(text)
  if (!normalized.ok) return normalized
  return mapOptionsToSheet(normalized.options)
}
