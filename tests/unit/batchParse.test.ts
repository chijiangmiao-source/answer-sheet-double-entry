import { describe, expect, it } from 'vitest'
import {
  mapOptionsToSheet,
  normalizeBatchText,
  parseBatchAnswers
} from '../../src/core/batchParse'
import type { Option } from '../../src/data/questions'

/** ABCD 循环的 20 个选项。 */
const TWENTY: Option[] = Array.from({ length: 20 }, (_, i) => 'ABCD'[i % 4] as Option)

describe('normalizeBatchText —— 分隔符归一化', () => {
  it('空格、逗号、换行（含 \\r\\n）都视为分隔符，连续分隔符只起一次切分作用', () => {
    const result = normalizeBatchText('A B,C\nD\r\nA,,B  C\n\nD A,B C D A B,C\nD A B C D')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.options).toEqual(TWENTY)
  })

  it('大小写均可，统一规范为大写', () => {
    const result = normalizeBatchText('a b,C\nd')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.options).toEqual(['A', 'B', 'C', 'D'])
  })

  it('无分隔符的连续字母串同样按顺序逐个提取', () => {
    const result = normalizeBatchText('ABCDabcd')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.options).toEqual(['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'])
  })
})

describe('normalizeBatchText —— 非法输入定位', () => {
  it('报告首个非法字符及其下标，其后的错误不再报告', () => {
    const result = normalizeBatchText('A B,1C D#E')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'invalid-char', char: '1', index: 4 })
    }
  })

  it('超出 A-D 的字母、数字、制表符、中文标点均为非法字符', () => {
    for (const bad of ['E', 'x', '5', '\t', '，', '。']) {
      const result = normalizeBatchText(`AB${bad}CD`)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toEqual({ kind: 'invalid-char', char: bad, index: 2 })
      }
    }
  })
})

describe('mapOptionsToSheet —— 位置映射与数量校验', () => {
  it('恰好 20 个选项时按顺序映射到第 1…20 题', () => {
    const result = mapOptionsToSheet(TWENTY)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.sheet).toHaveLength(20)
      expect(result.sheet[0]).toBe('A')
      expect(result.sheet[19]).toBe('D')
      expect(Object.isFrozen(result.sheet)).toBe(true)
    }
  })

  it('数量不是 20（0 / 19 / 21）时返回当前数量', () => {
    for (const count of [0, 19, 21]) {
      const result = mapOptionsToSheet(Array<Option>(count).fill('A'))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toEqual({ kind: 'wrong-count', count })
    }
  })
})

describe('parseBatchAnswers —— 规范化与位置映射的组合', () => {
  it('非法字符优先于数量错误返回', () => {
    const result = parseBatchAnswers('A B X')
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-char', char: 'X', index: 4 } })
  })

  it('合法文本解析为恰好 20 题的完整答题卡', () => {
    const result = parseBatchAnswers(TWENTY.join(' '))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.sheet).toEqual(TWENTY)
  })

  it('空文本与纯分隔符文本都视为 0 个选项', () => {
    for (const text of ['', '  ,\n , ']) {
      const result = parseBatchAnswers(text)
      expect(result).toEqual({ ok: false, error: { kind: 'wrong-count', count: 0 } })
    }
  })
})
