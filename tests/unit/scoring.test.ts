import { describe, expect, it } from 'vitest'
import { QUESTION_COUNT, type Option } from '../../src/data/questions'
import { adjudicate, commitRound, createEmptySheet } from '../../src/core/scoring'
import type { Answer } from '../../src/core/types'

function fill(value: Option, overrides: Record<number, Option> = {}): Answer[] {
  const sheet: Answer[] = createEmptySheet().slice()
  for (let i = 0; i < QUESTION_COUNT; i++) sheet[i] = overrides[i + 1] ?? value
  return sheet
}

describe('createEmptySheet', () => {
  it('创建 20 题全空答题卡且不可改', () => {
    const sheet = createEmptySheet()
    expect(sheet).toHaveLength(QUESTION_COUNT)
    expect(sheet.every((a) => a === null)).toBe(true)
    expect(Object.isFrozen(sheet)).toBe(true)
  })
})

describe('commitRound —— 完整性校验与快照', () => {
  it('存在漏题时拒绝提交并返回 null', () => {
    const sheet = fill('A')
    sheet[4] = null // 第 5 题漏答
    expect(commitRound(sheet)).toBeNull()
  })

  it('全部 20 题作答后生成冻结快照', () => {
    const snapshot = commitRound(fill('B'))
    expect(snapshot).not.toBeNull()
    expect(snapshot).toHaveLength(QUESTION_COUNT)
    expect(Object.isFrozen(snapshot)).toBe(true)
  })

  it('快照与原数组隔离：提交后修改原数组不影响快照', () => {
    const source = fill('C')
    const snapshot = commitRound(source)!
    source[0] = 'D'
    expect(snapshot[0]).toBe('C')
    expect(() => {
      // @ts-expect-error 快照只读，运行时同样被冻结
      snapshot[0] = 'A'
    }).toThrow(TypeError)
  })
})

describe('adjudicate —— 逐题裁决规则', () => {
  it('两轮完全一致：通过且 20/20，无差异', () => {
    const verdict = adjudicate(fill('A'), fill('A'))
    expect(verdict.passed).toBe(true)
    expect(verdict.score).toBe('20/20')
    expect(verdict.differences).toHaveLength(0)
    expect(Object.isFrozen(verdict)).toBe(true)
    expect(Object.isFrozen(verdict.differences)).toBe(true)
  })

  it('单题不同：不通过、19/20，且仅列出该题号与两轮选项', () => {
    const verdict = adjudicate(fill('A'), fill('A', { 7: 'C' }))
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe('19/20')
    expect(verdict.differences).toEqual([{ number: 7, first: 'A', second: 'C' }])
  })

  it('多题不同：只列差异题，顺序为题号升序', () => {
    const second = fill('D', { 2: 'A', 11: 'B', 20: 'C' })
    const verdict = adjudicate(fill('D'), second)
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe('17/20')
    expect(verdict.differences).toEqual([
      { number: 2, first: 'D', second: 'A' },
      { number: 11, first: 'D', second: 'B' },
      { number: 20, first: 'D', second: 'C' }
    ])
  })

  it('拒绝裁决不完整的答题卡', () => {
    const incomplete = fill('A')
    incomplete[9] = null
    expect(() => adjudicate(incomplete, fill('A'))).toThrow('完整作答')
    expect(() => adjudicate(fill('A'), incomplete)).toThrow('完整作答')
  })
})
