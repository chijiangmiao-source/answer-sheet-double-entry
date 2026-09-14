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

  it('全部 20 题作答后生成冻结记录（答案与标记均冻结）', () => {
    const record = commitRound(fill('B'))
    expect(record).not.toBeNull()
    expect(record!.answers).toHaveLength(QUESTION_COUNT)
    expect(record!.reviewFlags).toHaveLength(QUESTION_COUNT)
    expect(record!.reviewFlags.every((f) => f === false)).toBe(true)
    expect(Object.isFrozen(record)).toBe(true)
    expect(Object.isFrozen(record!.answers)).toBe(true)
    expect(Object.isFrozen(record!.reviewFlags)).toBe(true)
  })

  it('记录与原数组隔离：提交后修改原数组不影响快照', () => {
    const source = fill('C')
    const record = commitRound(source)!
    source[0] = 'D'
    expect(record.answers[0]).toBe('C')
    expect(() => {
      // @ts-expect-error 快照只读，运行时同样被冻结
      record.answers[0] = 'A'
    }).toThrow(TypeError)
    expect(() => {
      // @ts-expect-error 标记只读，运行时同样被冻结
      record.reviewFlags[0] = true
    }).toThrow(TypeError)
  })
})

describe('commitRound —— 固定题数校验', () => {
  it('题数不足固定 20 题（即使已有选项、无空项）也拒绝整轮提交', () => {
    const one = ['A'] as Answer[]
    expect(commitRound(one)).toBeNull()

    const nineteen = fill('A').slice(0, 19)
    expect(nineteen).toHaveLength(19)
    expect(commitRound(nineteen)).toBeNull()
  })

  it('超过固定 20 题（21 题均已作答）在保存前被拒绝', () => {
    const twentyOne: Answer[] = [...fill('A'), 'B']
    expect(twentyOne).toHaveLength(QUESTION_COUNT + 1)
    expect(commitRound(twentyOne)).toBeNull()
  })
})

describe('commitRound —— 选项合法性与标记结构校验', () => {
  it('含规定范围（A/B/C/D）外字母但没有空项时拒绝整轮数据', () => {
    const illegal = fill('A')
    illegal[10] = 'E' as Option
    expect(commitRound(illegal)).toBeNull()

    const lower = fill('B')
    lower[0] = 'a' as Option // 小写字母同样不属于合法选项
    expect(commitRound(lower)).toBeNull()
  })

  it('待复核标记项数少于 20 时拒绝整轮记录，缺失位置不得当成未标记', () => {
    expect(commitRound(fill('A'), new Array<boolean>(QUESTION_COUNT - 1).fill(false))).toBeNull()
  })

  it('待复核标记项数多于 20 时同样拒绝', () => {
    expect(commitRound(fill('A'), new Array<boolean>(QUESTION_COUNT + 1).fill(false))).toBeNull()
  })
})

describe('adjudicate —— 非法数据不得参与裁决', () => {
  it('拒绝裁决含范围外选项的答题卡', () => {
    const illegal = fill('A')
    illegal[5] = 'E' as Option
    expect(() => adjudicate(illegal, fill('A'))).toThrow('非法选项')
    expect(() => adjudicate(fill('A'), illegal)).toThrow('非法选项')
  })

  it('拒绝标记结构不完整的轮次记录', () => {
    const shortFlags = new Array<boolean>(QUESTION_COUNT - 1).fill(false)
    const record = { answers: fill('A'), reviewFlags: shortFlags }
    expect(() => adjudicate(record, fill('A'))).toThrow('待复核标记')
    expect(() => adjudicate(fill('A'), record)).toThrow('待复核标记')
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

  it('单题不同：不通过、19/20，且仅列出该题号与两轮选项（旧形态裸数组默认无标记）', () => {
    const verdict = adjudicate(fill('A'), fill('A', { 7: 'C' }))
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe('19/20')
    expect(verdict.differences).toEqual([
      { number: 7, first: 'A', second: 'C', firstReviewed: false, secondReviewed: false }
    ])
  })

  it('多题不同：只列差异题，顺序为题号升序', () => {
    const second = fill('D', { 2: 'A', 11: 'B', 20: 'C' })
    const verdict = adjudicate(fill('D'), second)
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe('17/20')
    expect(verdict.differences).toEqual([
      { number: 2, first: 'D', second: 'A', firstReviewed: false, secondReviewed: false },
      { number: 11, first: 'D', second: 'B', firstReviewed: false, secondReviewed: false },
      { number: 20, first: 'D', second: 'C', firstReviewed: false, secondReviewed: false }
    ])
  })

  it('拒绝裁决不完整的答题卡', () => {
    const incomplete = fill('A')
    incomplete[9] = null
    expect(() => adjudicate(incomplete, fill('A'))).toThrow('完整作答')
    expect(() => adjudicate(fill('A'), incomplete)).toThrow('完整作答')
  })
})

describe('commitRound —— 待复核标记随答案一并冻结', () => {
  it('标记与答案一起复制进记录，提交后修改原数组不影响记录', () => {
    const answers = fill('A')
    const flags = new Array<boolean>(QUESTION_COUNT).fill(false)
    flags[2] = true
    flags[14] = true

    const record = commitRound(answers, flags)!
    expect(record).not.toBeNull()
    expect(record.reviewFlags[2]).toBe(true)
    expect(record.reviewFlags[14]).toBe(true)
    expect(record.reviewFlags.filter(Boolean)).toHaveLength(2)

    // 原数组事后变化不波及已冻结记录
    flags[2] = false
    answers[14] = 'D'
    expect(record.reviewFlags[2]).toBe(true)
    expect(record.answers[14]).toBe('A')
    expect(Object.isFrozen(record.reviewFlags)).toBe(true)
  })

  it('标记不参与完整性判断：漏题即使整卡都标记仍被拒绝', () => {
    const answers = fill('A')
    answers[7] = null
    const allFlagged = new Array<boolean>(QUESTION_COUNT).fill(true)
    expect(commitRound(answers, allFlagged)).toBeNull()
  })

  it('非布尔真值被规范化为 false，记录内只有严格布尔', () => {
    const flags = [true, 0, 'x', null, undefined, ...new Array(15).fill(false)] as unknown as boolean[]
    const record = commitRound(fill('B'), flags)!
    expect(record.reviewFlags[0]).toBe(true)
    for (let i = 1; i < QUESTION_COUNT; i++) expect(record.reviewFlags[i]).toBe(false)
  })
})

describe('adjudicate —— 标记只附带在差异项上，裁决只看答案', () => {
  function flagsOf(marked: number[]): boolean[] {
    const flags = new Array<boolean>(QUESTION_COUNT).fill(false)
    for (const n of marked) flags[n - 1] = true
    return flags
  }

  it('差异行附带首录、复录各自是否曾标记', () => {
    const first = commitRound(fill('A'), flagsOf([3]))!
    const second = commitRound(fill('A', { 3: 'B', 9: 'D' }), flagsOf([9, 12]))!
    const verdict = adjudicate(first, second)

    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe('18/20')
    expect(verdict.differences).toEqual([
      { number: 3, first: 'A', second: 'B', firstReviewed: true, secondReviewed: false },
      { number: 9, first: 'A', second: 'D', firstReviewed: false, secondReviewed: true }
    ])
    // 双方都标记的同一差异题：两个提示位都为 true
    const both = adjudicate(
      commitRound(fill('A'), flagsOf([5]))!,
      commitRound(fill('A', { 5: 'C' }), flagsOf([5]))!
    )
    expect(both.differences[0]).toEqual({
      number: 5,
      first: 'A',
      second: 'C',
      firstReviewed: true,
      secondReviewed: true
    })
  })

  it('标记不改变裁决：答案一致时即使两轮都标记也通过且无差异', () => {
    const verdict = adjudicate(
      commitRound(fill('A'), flagsOf([1, 2, 20]))!,
      commitRound(fill('A'), flagsOf([3, 4]))!
    )
    expect(verdict.passed).toBe(true)
    expect(verdict.score).toBe('20/20')
    expect(verdict.differences).toEqual([])
  })

  it('旧提交形态兼容：裸答案数组与无标记 RoundRecord 都按未标记裁决', () => {
    const bare = adjudicate(fill('A'), fill('A', { 6: 'B' }))
    expect(bare.differences[0]).toEqual({
      number: 6,
      first: 'A',
      second: 'B',
      firstReviewed: false,
      secondReviewed: false
    })

    const mixed = adjudicate(commitRound(fill('A'), flagsOf([6]))!, fill('A', { 6: 'B' }))
    expect(mixed.differences[0].firstReviewed).toBe(true)
    expect(mixed.differences[0].secondReviewed).toBe(false)

    // commitRound 省略标记参数等价于全未标记
    expect(commitRound(fill('A'))!.reviewFlags.every((f) => f === false)).toBe(true)
  })
})
