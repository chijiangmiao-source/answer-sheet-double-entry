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
    expect(bad.verdict.value?.differences).toEqual([{ number: 9, first: 'A', second: 'D' }])
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
