import { describe, expect, it } from 'vitest'
import {
  initHistory,
  moveFocus,
  recordSelection,
  redoSelection,
  undoSelection,
  type EditState
} from '../../src/core/history'
import { createEmptySheet } from '../../src/core/scoring'
import type { Answer } from '../../src/core/types'

function sheetOf(state: EditState): readonly Answer[] {
  return state.sheet
}

function pick(sheet: readonly Answer[], index: number): Answer {
  return sheet[index]
}

describe('initHistory —— 每轮全新轨迹', () => {
  it('初始为空白答卡、焦点第一题、撤销重做均不可用', () => {
    const state = initHistory()
    expect(sheetOf(state)).toEqual(createEmptySheet())
    expect(state.focus).toBe(0)
    expect(state.baseFocus).toBe(0)
    expect(state.undoStack).toEqual([])
    expect(state.redoStack).toEqual([])
    expect(state.canUndo).toBe(false)
    expect(state.canRedo).toBe(false)
  })

  it('状态整体冻结：答卡、栈与单条记录均不可改', () => {
    let state = initHistory()
    state = recordSelection(state, 0, 'A', 1)
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.sheet)).toBe(true)
    expect(Object.isFrozen(state.undoStack)).toBe(true)
    expect(Object.isFrozen(state.undoStack[0])).toBe(true)
    expect(() => {
      // @ts-expect-error 只读状态运行时同样冻结
      state.sheet[0] = 'B'
    }).toThrow(TypeError)
  })

  it('拒绝非 20 题答题卡与越界初始焦点', () => {
    expect(() => initHistory(['A', 'B'])).toThrow('20')
    expect(() => initHistory(createEmptySheet(), 20)).toThrow('焦点')
    expect(() => initHistory(createEmptySheet(), -1)).toThrow('焦点')
  })
})

describe('recordSelection —— 轨迹记录与无效动作', () => {
  it('有效变化记录题号、前后值与操作后焦点', () => {
    let state = initHistory()
    state = recordSelection(state, 0, 'A', 1)
    expect(state.undoStack).toEqual([
      { index: 0, before: null, after: 'A', focusAfter: 1 }
    ])
    expect(pick(sheetOf(state), 0)).toBe('A')
    expect(state.focus).toBe(1)
    expect(state.canUndo).toBe(true)

    // 改写已有答案：before 记录旧选项而非 null
    state = recordSelection(state, 0, 'C', 1)
    expect(state.undoStack[1]).toEqual({ index: 0, before: 'A', after: 'C', focusAfter: 1 })
    expect(pick(sheetOf(state), 0)).toBe('C')
  })

  it('重复选择同一选项不进入轨迹、不动焦点', () => {
    let state = initHistory()
    state = recordSelection(state, 2, 'B', 3)
    const same = recordSelection(state, 2, 'B', 3)
    expect(same).toBe(state)
    expect(state.undoStack).toHaveLength(1)

    // 即使调用方给出不同的 nextFocus，重复选择也不改变任何状态
    const ignored = recordSelection(state, 2, 'B', 4)
    expect(ignored).toBe(state)
    expect(ignored.focus).toBe(3)
  })

  it('越界题号或非法焦点不进入轨迹', () => {
    const state = initHistory()
    expect(recordSelection(state, -1, 'A', 0)).toBe(state)
    expect(recordSelection(state, 20, 'A', 19)).toBe(state)
    expect(recordSelection(state, 0, 'A', 20)).toBe(state)
    expect(state.undoStack).toHaveLength(0)
  })

  it('撤销后产生新选择时清空重做分支（分支截断）', () => {
    let state = initHistory()
    state = recordSelection(state, 0, 'A', 1)
    state = recordSelection(state, 1, 'B', 2)
    state = recordSelection(state, 2, 'C', 3)
    state = undoSelection(state) // 撤销 C
    state = undoSelection(state) // 撤销 B
    expect(state.canUndo).toBe(true)
    expect(state.canRedo).toBe(true)
    expect(state.redoStack.map((e) => e.after)).toEqual(['C', 'B'])

    // 在撤销状态下改选（哪怕是同一题的不同选项），重做分支立即清空
    const branched = recordSelection(state, 1, 'D', 2)
    expect(branched.redoStack).toEqual([])
    expect(branched.canRedo).toBe(false)
    // 已保留的更早轨迹不受影响，仍可撤销到 A
    expect(branched.undoStack.map((e) => e.after)).toEqual(['A', 'D'])
  })
})

describe('undoSelection / redoSelection —— 逆序与原序恢复', () => {
  it('撤销按逆序恢复答案与焦点，重做按原序恢复', () => {
    let state = initHistory()
    state = recordSelection(state, 0, 'A', 1)
    state = recordSelection(state, 1, 'B', 2)
    state = recordSelection(state, 2, 'C', 3)

    state = undoSelection(state)
    expect(pick(sheetOf(state), 2)).toBeNull()
    expect(state.focus).toBe(2) // 回到第二条记录操作后的焦点
    state = undoSelection(state)
    expect(pick(sheetOf(state), 1)).toBeNull()
    expect(state.focus).toBe(1)
    state = undoSelection(state)
    expect(pick(sheetOf(state), 0)).toBeNull()
    expect(state.focus).toBe(0) // 最早记录之前回到底线焦点
    expect(state.canUndo).toBe(false)
    expect(state.canRedo).toBe(true)

    state = redoSelection(state)
    expect(pick(sheetOf(state), 0)).toBe('A')
    expect(state.focus).toBe(1)
    state = redoSelection(state)
    expect(pick(sheetOf(state), 1)).toBe('B')
    expect(state.focus).toBe(2)
    state = redoSelection(state)
    expect(pick(sheetOf(state), 2)).toBe('C')
    expect(state.focus).toBe(3)
    expect(state.canRedo).toBe(false)
  })

  it('撤销覆盖式改答时恢复到变化前的旧选项', () => {
    let state = initHistory()
    state = recordSelection(state, 4, 'A', 5)
    state = recordSelection(state, 4, 'B', 5)
    state = undoSelection(state)
    expect(pick(sheetOf(state), 4)).toBe('A')
    expect(state.focus).toBe(5)
    state = undoSelection(state)
    expect(pick(sheetOf(state), 4)).toBeNull()
    expect(state.focus).toBe(0)
  })

  it('无轨迹时撤销/重做原样返回（禁用态快捷键同样无效）', () => {
    const state = initHistory()
    expect(undoSelection(state)).toBe(state)
    expect(redoSelection(state)).toBe(state)
  })

  it('重做后再次撤销仍能完整还原，栈在两端往返移动', () => {
    let state = initHistory()
    state = recordSelection(state, 0, 'A', 1)
    state = undoSelection(state)
    state = redoSelection(state)
    state = undoSelection(state)
    expect(pick(sheetOf(state), 0)).toBeNull()
    expect(state.canUndo).toBe(false)
    expect(state.canRedo).toBe(true)
  })

  it('撤销可造成漏题，重做恢复后重新完整', () => {
    let state = initHistory()
    for (let i = 0; i < 20; i++) state = recordSelection(state, i, 'A', Math.min(i + 1, 19))
    expect(sheetOf(state).every((a) => a !== null)).toBe(true)
    state = undoSelection(state)
    expect(sheetOf(state).some((a) => a === null)).toBe(true)
    expect(pick(sheetOf(state), 19)).toBeNull()
    state = redoSelection(state)
    expect(sheetOf(state).every((a) => a !== null)).toBe(true)
  })
})

describe('moveFocus —— 焦点移动不污染轨迹', () => {
  it('方向键式移动只改焦点、不留痕、不清空重做分支', () => {
    let state = initHistory()
    state = recordSelection(state, 0, 'A', 1)
    state = undoSelection(state)
    expect(state.canRedo).toBe(true)

    state = moveFocus(state, 5)
    expect(state.focus).toBe(5)
    expect(state.undoStack).toHaveLength(0) // 焦点移动不产生记录
    expect(state.canRedo).toBe(true) // 重做分支保留

    // 夹取到边界
    expect(moveFocus(state, 99).focus).toBe(19)
    expect(moveFocus(state, -99).focus).toBe(0)
  })

  it('尚无编辑时先移动再作答，撤销后焦点回到作答前的位置', () => {
    let state = initHistory()
    state = moveFocus(state, 3) // 用方向键走到第 4 题
    state = recordSelection(state, 3, 'B', 4) // 在第 4 题作答
    state = undoSelection(state)
    expect(state.focus).toBe(3)
  })

  it('已有编辑后的焦点移动不改变底线焦点', () => {
    let state = initHistory()
    state = recordSelection(state, 0, 'A', 1)
    state = moveFocus(state, 8)
    state = undoSelection(state)
    expect(state.focus).toBe(0) // 底线焦点仍是初始的第一题
  })
})

describe('initHistory —— 跨轮清空与批量写入基线', () => {
  it('第二轮重新初始化得到空轨迹，不含任何上一轮记录', () => {
    let first = initHistory()
    for (let i = 0; i < 5; i++) first = recordSelection(first, i, 'A', i + 1)
    first = undoSelection(first)
    expect(first.canUndo || first.canRedo).toBe(true)

    // App.vue 以轮次为 key 销毁组件后，第二轮以 initHistory 全新开始
    const second = initHistory()
    expect(second.undoStack).toEqual([])
    expect(second.redoStack).toEqual([])
    expect(second.canUndo).toBe(false)
    expect(second.canRedo).toBe(false)
    expect(sheetOf(second).every((a) => a === null)).toBe(true)
    expect(second.focus).toBe(0)
  })

  it('批量整卡写入以新轨迹为基线：旧记录不可撤销，焦点保留在写入前位置', () => {
    let state = initHistory()
    state = recordSelection(state, 0, 'A', 1)
    state = moveFocus(state, 6)

    const imported = createEmptySheet().map(() => 'C' as Answer)
    state = initHistory(imported, state.focus)
    expect(state.canUndo).toBe(false)
    expect(state.canRedo).toBe(false)
    expect(state.undoStack).toEqual([])
    expect(state.focus).toBe(6)
    expect(state.baseFocus).toBe(6)
    expect(sheetOf(state).every((a) => a === 'C')).toBe(true)

    // 全新基线上的编辑仍可正常撤销/重做
    state = recordSelection(state, 6, 'D', 7)
    state = undoSelection(state)
    expect(pick(sheetOf(state), 6)).toBe('C')
    expect(state.focus).toBe(6)
  })
})
