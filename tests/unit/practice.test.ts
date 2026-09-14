import { describe, expect, it } from 'vitest'
import { OPTIONS, type Option } from '../../src/data/questions'
import {
  PRACTICE_MAX_RUN,
  PRACTICE_PER_LETTER,
  PRACTICE_STEP_COUNT,
  acceptKey,
  start,
  type PracticeSession
} from '../../src/core/practice'

/** 当前步的目标字母。 */
function targetOf(session: PracticeSession): Option {
  return session.targets[session.index]
}

/** 选一个与 target 不同的字母作为误按。 */
function wrongLetter(target: Option, avoid?: Option): Option {
  const found = OPTIONS.find((o) => o !== target && o !== avoid)
  if (!found) throw new Error('无法选出误按字母')
  return found
}

/** 从当前状态一路按目标字母直到完成，返回最终会话。 */
function finishAll(session: PracticeSession): PracticeSession {
  let s = session
  while (!s.done) s = acceptKey(s, targetOf(s))
  return s
}

describe('目标序列生成约束', () => {
  it('任意种子都生成长度 20、四字母各 5 次、同一字母不连续超过两次的序列', () => {
    for (let seed = 0; seed < 300; seed++) {
      const { targets } = start(seed)
      expect(targets).toHaveLength(PRACTICE_STEP_COUNT)
      for (const letter of OPTIONS) {
        expect(targets.filter((t) => t === letter)).toHaveLength(PRACTICE_PER_LETTER)
      }
      let run = 1
      for (let i = 1; i < targets.length; i++) {
        run = targets[i] === targets[i - 1] ? run + 1 : 1
        expect(run).toBeLessThanOrEqual(PRACTICE_MAX_RUN)
      }
    }
  })

  it('种子可注入且完全确定：同一种子多次生成同一序列', () => {
    for (const seed of [0, 1, 42, 123456789, 2 ** 31]) {
      const a = start(seed)
      const b = start(seed)
      expect([...a.targets]).toEqual([...b.targets])
      expect(a.seed).toBe(b.seed)
    }
  })

  it('不同种子驱动不同序列（种子确实参与生成）', () => {
    const sequences = new Set<string>()
    for (let seed = 0; seed < 50; seed++) {
      sequences.add(start(seed).targets.join(''))
    }
    expect(sequences.size).toBeGreaterThan(1)
  })

  it('种子规范化为无符号 32 位整数：负数与小数种子也确定', () => {
    expect(start(-1).seed).toBe(0xffffffff)
    expect([...start(-1).targets]).toEqual([...start(0xffffffff).targets])
    expect(start(3.9).seed).toBe(3)
    expect([...start(3.9).targets]).toEqual([...start(3).targets])
  })
})

describe('会话初始状态与不可变性', () => {
  it('start 返回第 1 步、统计全零的全新会话', () => {
    const s = start(7)
    expect(s.index).toBe(0)
    expect(s.firstHits).toBe(0)
    expect(s.missteps).toEqual([])
    expect(s.missesByLetter).toEqual({ A: 0, B: 0, C: 0, D: 0 })
    expect(s.currentMissed).toBe(false)
    expect(s.done).toBe(false)
  })

  it('会话及各字段深度冻结，acceptKey 不修改原会话', () => {
    const s = start(7)
    expect(Object.isFrozen(s)).toBe(true)
    expect(Object.isFrozen(s.targets)).toBe(true)
    expect(Object.isFrozen(s.missteps)).toBe(true)
    expect(Object.isFrozen(s.missesByLetter)).toBe(true)

    const before = s
    const after = acceptKey(s, targetOf(s))
    expect(after).not.toBe(before)
    // 原会话保持第 1 步、统计全零
    expect(s.index).toBe(0)
    expect(s.firstHits).toBe(0)
    expect(s.missteps).toEqual([])
    expect(s.missesByLetter).toEqual({ A: 0, B: 0, C: 0, D: 0 })

    // 迁移后的会话同样深度冻结
    expect(Object.isFrozen(after)).toBe(true)
    expect(Object.isFrozen(after.missteps)).toBe(true)
    expect(Object.isFrozen(after.missesByLetter)).toBe(true)
  })
})

describe('按键状态迁移', () => {
  it('命中目标字母前进一步并计一次首次命中', () => {
    let s = start(11)
    s = acceptKey(s, targetOf(s))
    expect(s.index).toBe(1)
    expect(s.firstHits).toBe(1)
    expect(s.done).toBe(false)
  })

  it('小写字母同样接受', () => {
    let s = start(11)
    s = acceptKey(s, targetOf(s).toLowerCase())
    expect(s.index).toBe(1)
    expect(s.firstHits).toBe(1)
  })

  it('A-D 以外的按键一律忽略：原样返回同一会话', () => {
    const s = start(11)
    for (const key of ['E', 'f', '1', '0', ' ', 'Enter', 'Tab', 'Escape', 'ArrowUp', '']) {
      expect(acceptKey(s, key)).toBe(s)
    }
    expect(s.index).toBe(0)
    expect(s.firstHits).toBe(0)
  })

  it('合法但错误的字母：不前进、记录该题首次误按、允许继续尝试', () => {
    let s = start(11)
    const target = targetOf(s)
    const wrong = wrongLetter(target)

    s = acceptKey(s, wrong)
    expect(s.index).toBe(0) // 停留在本题
    expect(s.currentMissed).toBe(true)
    expect(s.missteps).toEqual([1])
    expect(s.missesByLetter[wrong]).toBe(1)
    expect(s.firstHits).toBe(0)

    // 该题后续误按（含其他错误字母）不再重复计数
    const again = wrongLetter(target, wrong)
    const afterSame = acceptKey(s, wrong)
    const afterOther = acceptKey(s, again)
    expect(afterSame).toBe(s)
    expect(afterOther).toBe(s)
    expect(s.missteps).toEqual([1])
    expect(s.missesByLetter[wrong]).toBe(1)
    expect(s.missesByLetter[again]).toBe(0)

    // 允许继续尝试：随后命中即前进，但本题不再计首次命中
    s = acceptKey(s, target)
    expect(s.index).toBe(1)
    expect(s.firstHits).toBe(0)
    expect(s.currentMissed).toBe(false)
  })

  it('误按记录跟随题号：第二题的误按记为第 2 题', () => {
    let s = start(23)
    s = acceptKey(s, targetOf(s)) // 第 1 题命中
    const wrong = wrongLetter(targetOf(s))
    s = acceptKey(s, wrong) // 第 2 题误按
    expect(s.missteps).toEqual([2])
    expect(s.missesByLetter[wrong]).toBe(1)
    s = acceptKey(s, targetOf(s))
    expect(s.index).toBe(2)
    expect(s.firstHits).toBe(1) // 只有第 1 题是首次命中
  })

  it('全部 20 步命中后 done，之后任何按键都被忽略', () => {
    const s = finishAll(start(5))
    expect(s.done).toBe(true)
    expect(s.index).toBe(PRACTICE_STEP_COUNT)
    expect(s.firstHits).toBe(PRACTICE_STEP_COUNT)
    expect(acceptKey(s, 'A')).toBe(s)
    expect(acceptKey(s, 'E')).toBe(s)
  })
})

describe('完成后的统计', () => {
  it('全程一次命中：首次命中 20/20，无误按记录', () => {
    const s = finishAll(start(99))
    expect(s.firstHits).toBe(20)
    expect(s.missteps).toEqual([])
    expect(s.missesByLetter).toEqual({ A: 0, B: 0, C: 0, D: 0 })
  })

  it('含误按的完整流程：首次命中数、误按题号与各字母误按次数正确汇总', () => {
    let s = start(31)
    const missedSteps: number[] = []
    const missCount: Record<Option, number> = { A: 0, B: 0, C: 0, D: 0 }
    // 在第 2、5、9 步各制造一次误按（不同错误字母），其余一次命中
    const plan = new Map<number, number>([
      [2, 1],
      [5, 1],
      [9, 1]
    ])
    while (!s.done) {
      const step = s.index + 1
      const misses = plan.get(step) ?? 0
      for (let i = 0; i < misses; i++) {
        const wrong = wrongLetter(targetOf(s))
        s = acceptKey(s, wrong)
        missedSteps.push(step)
        missCount[wrong] += 1
      }
      s = acceptKey(s, targetOf(s))
    }

    expect(s.done).toBe(true)
    expect(s.firstHits).toBe(PRACTICE_STEP_COUNT - missedSteps.length)
    expect(s.missteps).toEqual([...missedSteps].sort((a, b) => a - b))
    expect(s.missesByLetter).toEqual(missCount)
    // 误按题号升序且每题至多一次
    expect(new Set(s.missteps).size).toBe(s.missteps.length)
  })

  it('同一题多次误按只计一次，统计不被重复放大', () => {
    let s = start(77)
    const target = targetOf(s)
    const wrong = wrongLetter(target)
    s = acceptKey(s, wrong)
    s = acceptKey(s, wrong)
    s = acceptKey(s, wrongLetter(target, wrong))
    s = finishAll(s)

    expect(s.firstHits).toBe(19)
    expect(s.missteps).toEqual([1])
    expect(s.missesByLetter[wrong]).toBe(1)
    expect(
      OPTIONS.reduce((sum, letter) => sum + s.missesByLetter[letter], 0)
    ).toBe(1)
  })
})
