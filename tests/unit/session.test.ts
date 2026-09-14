import { describe, expect, it } from 'vitest'
import { QUESTION_COUNT, type Option } from '../../src/data/questions'
import { createSession } from '../../src/composables/useSession'
import { createEmptySheet } from '../../src/core/scoring'
import type { Answer } from '../../src/core/types'

function fill(value: Option, overrides: Record<number, Option> = {}): Answer[] {
  const sheet: Answer[] = createEmptySheet().slice()
  for (let i = 0; i < QUESTION_COUNT; i++) sheet[i] = overrides[i + 1] ?? value
  return sheet
}

describe('会话轮次隔离', () => {
  it('首录未完成时不能进入第二轮，且不产生裁决', () => {
    const session = createSession()
    const partial = fill('A')
    partial[3] = null

    expect(session.submit(partial)).toBe(false)
    expect(session.phase.value).toBe('first')
    expect(session.round.value).toBe(1)
    expect(session.verdict.value).toBeNull()
  })

  it('首录完整提交后进入第二轮，但 SessionApi 不暴露首录答案', () => {
    const session = createSession()
    const exposed = Object.keys(session)

    expect(session.submit(fill('A'))).toBe(true)
    expect(session.phase.value).toBe('second')
    expect(session.round.value).toBe(2)
    expect(session.verdict.value).toBeNull()
    // 对外仅 phase/round/verdict/submit/restart，没有任何读取首录快照的入口。
    expect(exposed.sort()).toEqual(['phase', 'restart', 'round', 'submit', 'verdict'])
    expect(Object.values(session).every((v) => Array.isArray(v))).toBe(false)
  })

  it('第二轮存在漏题不能提交，且仍停留在第二轮', () => {
    const session = createSession()
    session.submit(fill('A'))
    const partial = fill('B')
    partial[19] = null

    expect(session.submit(partial)).toBe(false)
    expect(session.phase.value).toBe('second')
    expect(session.verdict.value).toBeNull()
  })

  it('两轮一致裁决通过；两轮不同裁决不通过且仅含差异', () => {
    const ok = createSession()
    ok.submit(fill('C'))
    ok.submit(fill('C'))
    expect(ok.phase.value).toBe('done')
    expect(ok.verdict.value?.passed).toBe(true)
    expect(ok.verdict.value?.score).toBe('20/20')

    const bad = createSession()
    bad.submit(fill('A'))
    bad.submit(fill('A', { 9: 'D' }))
    expect(bad.verdict.value?.passed).toBe(false)
    expect(bad.verdict.value?.score).toBe('19/20')
    expect(bad.verdict.value?.differences).toEqual([
      { number: 9, first: 'A', second: 'D', firstReviewed: false, secondReviewed: false }
    ])
  })

  it('裁决完成后首录引用被释放，重复提交无效', () => {
    const session = createSession()
    session.submit(fill('A'))
    session.submit(fill('A'))
    expect(session.submit(fill('B'))).toBe(false)
    expect(session.verdict.value?.passed).toBe(true)
  })

  it('restart 清除两轮状态并回到空白首录', () => {
    const session = createSession()
    session.submit(fill('A'))
    session.submit(fill('B'))
    expect(session.phase.value).toBe('done')

    session.restart()
    expect(session.phase.value).toBe('first')
    expect(session.round.value).toBe(1)
    expect(session.verdict.value).toBeNull()

    // 重新开始后的新会话不受上一轮影响：两轮一致仍应通过。
    session.submit(fill('D'))
    session.submit(fill('D'))
    expect(session.verdict.value?.passed).toBe(true)
    expect(session.verdict.value?.score).toBe('20/20')
  })
})

describe('会话中的待复核记录', () => {
  function flagsOf(marked: number[]): boolean[] {
    const flags = new Array<boolean>(QUESTION_COUNT).fill(false)
    for (const n of marked) flags[n - 1] = true
    return flags
  }

  it('标记随两轮提交保存，差异行只附带对应轮次的标记', () => {
    const session = createSession()
    expect(session.submit(fill('A'), flagsOf([3]))).toBe(true)
    expect(session.submit(fill('A', { 3: 'B', 8: 'C' }), flagsOf([8]))).toBe(true)

    const diffs = session.verdict.value!.differences
    expect(diffs).toEqual([
      { number: 3, first: 'A', second: 'B', firstReviewed: true, secondReviewed: false },
      { number: 8, first: 'A', second: 'C', firstReviewed: false, secondReviewed: true }
    ])
    expect(Object.isFrozen(diffs)).toBe(true)
    expect(Object.isFrozen(diffs[0])).toBe(true)
  })

  it('标记不影响裁决：答案逐题一致即使标记完全不同仍通过', () => {
    const session = createSession()
    session.submit(fill('A'), flagsOf([1, 2, 3]))
    session.submit(fill('A'), flagsOf([19, 20]))
    expect(session.verdict.value?.passed).toBe(true)
    expect(session.verdict.value?.score).toBe('20/20')
    expect(session.verdict.value?.differences).toEqual([])
  })

  it('旧调用方只传答案时按无标记处理，流程不变', () => {
    const session = createSession()
    expect(session.submit(fill('B'))).toBe(true) // 省略第二参数
    expect(session.submit(fill('B', { 4: 'D' }))).toBe(true)
    expect(session.verdict.value?.passed).toBe(false)
    const d = session.verdict.value!.differences[0]
    expect(d).toEqual({
      number: 4,
      first: 'B',
      second: 'D',
      firstReviewed: false,
      secondReviewed: false
    })
  })

  it('轮次隔离：第二轮期间拿不到首录标记，裁决只在完成后产生', () => {
    const session = createSession()
    session.submit(fill('A'), flagsOf([5, 6]))
    expect(session.phase.value).toBe('second')
    expect(session.verdict.value).toBeNull()
    // 对外 API 没有任何读取首录记录（含标记）的入口
    expect(Object.keys(session).sort()).toEqual(['phase', 'restart', 'round', 'submit', 'verdict'])

    // 第二轮自己的标记与首录无关：只标第 7 题，差异行如实反映各轮标记
    session.submit(fill('A', { 7: 'D' }), flagsOf([7]))
    const diffs = session.verdict.value!.differences
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toEqual({
      number: 7,
      first: 'A',
      second: 'D',
      firstReviewed: false, // 首录标在 5、6 题，不能“泄露”到第 7 题
      secondReviewed: true
    })
  })

  it('漏题被拒时标记与答案一同保留在当前轮，补齐后携带原标记提交', () => {
    const session = createSession()
    const partial = fill('A')
    partial[9] = null
    // 第 3 题已标记，第 10 题漏答
    expect(session.submit(partial, flagsOf([3]))).toBe(false)
    expect(session.phase.value).toBe('first')

    // 补齐漏答后重新提交，原标记仍在（由视图层保留同一份标记数组传入）
    const completed = partial.slice()
    completed[9] = 'A'
    expect(session.submit(completed, flagsOf([3]))).toBe(true)
    expect(session.phase.value).toBe('second')

    session.submit(fill('A', { 3: 'B' }))
    expect(session.verdict.value!.differences[0].firstReviewed).toBe(true)
  })

  it('restart 清空两轮标记记录', () => {
    const session = createSession()
    session.submit(fill('A'), flagsOf([11]))
    session.submit(fill('A', { 11: 'C' }), flagsOf([11]))
    expect(session.verdict.value?.differences[0].firstReviewed).toBe(true)

    session.restart()
    expect(session.verdict.value).toBeNull()
    session.submit(fill('A'))
    session.submit(fill('A', { 11: 'C' }))
    // 新会话两轮均无标记
    expect(session.verdict.value!.differences[0]).toEqual({
      number: 11,
      first: 'A',
      second: 'C',
      firstReviewed: false,
      secondReviewed: false
    })
  })
})
