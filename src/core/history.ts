import { QUESTION_COUNT, type Option } from '../data/questions'
import type { Answer, AnswerSheet } from './types'
import { createEmptySheet } from './scoring'

/**
 * 一轮答卡的一条有效编辑轨迹：
 * 仅当某题选项确实发生变化时产生，记录题号、变化前后值与操作后的焦点。
 */
export interface EditEntry {
  /** 题目下标（0 起，题号 - 1）。 */
  readonly index: number
  /** 变化前的答案（可能为未作答 null）。 */
  readonly before: Answer
  /** 变化后的选项。 */
  readonly after: Option
  /** 本次操作完成后焦点所在的题目下标（0 起）。 */
  readonly focusAfter: number
}

/**
 * 一轮录入的可撤销/可重做状态（不可变值）。
 * 视图层只消费 sheet / focus / canUndo / canRedo，不直接改答卡。
 */
export interface EditState {
  readonly sheet: AnswerSheet
  readonly focus: number
  /**
   * 轨迹为空（尚未操作或已全部撤销）时焦点应回到的位置：
   * 没有任何编辑时，方向键移动的焦点会同步到这里，因此撤销掉最早一条编辑后，
   * 焦点回到该次选择发生前的实际位置；批量写入时保留写入前焦点。
   */
  readonly baseFocus: number
  /** 已发生的有效变化，按原序排列；撤销从末尾弹出。 */
  readonly undoStack: readonly EditEntry[]
  /** 已撤销的变化，最近撤销的在末尾，即下一条重做记录。 */
  readonly redoStack: readonly EditEntry[]
  readonly canUndo: boolean
  readonly canRedo: boolean
}

function validFocus(focus: number): boolean {
  return Number.isInteger(focus) && focus >= 0 && focus < QUESTION_COUNT
}

function freezeSheet(sheet: readonly Answer[]): AnswerSheet {
  return Object.freeze(sheet.slice())
}

function freezeStack(entries: readonly EditEntry[]): readonly EditEntry[] {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })))
}

function assemble(
  sheet: readonly Answer[],
  focus: number,
  baseFocus: number,
  undoStack: readonly EditEntry[],
  redoStack: readonly EditEntry[]
): EditState {
  return Object.freeze({
    sheet: freezeSheet(sheet),
    focus,
    baseFocus,
    undoStack: freezeStack(undoStack),
    redoStack: freezeStack(redoStack),
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0
  })
}

/**
 * 创建一轮全新的编辑轨迹（空白答卡、焦点在第一题）。
 * 批量整体写入后以写入后的答卡与保留的焦点重建，等价于开启一条全新轨迹。
 */
export function initHistory(sheet: readonly Answer[] = createEmptySheet(), focus = 0): EditState {
  if (sheet.length !== QUESTION_COUNT) {
    throw new Error(`编辑轨迹需要长度为 ${QUESTION_COUNT} 的答题卡`)
  }
  if (!validFocus(focus)) {
    throw new Error('初始焦点超出题目范围')
  }
  return assemble(sheet, focus, focus, [], [])
}

/**
 * 提交一次选项选择（纯函数）：
 * - 与当前值相同的重复选择、越界题号一律视为无效动作，原样返回同一状态（不留痕、焦点不动）；
 * - 有效变化追加一条记录并清空重做分支（撤销后另做新选择即分叉）；
 * - 操作后的焦点由调用方给出（键盘作答自动后移、末题停留由视图规则决定）。
 */
export function recordSelection(
  state: EditState,
  index: number,
  option: Option,
  nextFocus: number
): EditState {
  if (index < 0 || index >= QUESTION_COUNT || !validFocus(nextFocus)) return state
  if (state.sheet[index] === option) return state

  const entry: EditEntry = {
    index,
    before: state.sheet[index],
    after: option,
    focusAfter: nextFocus
  }
  const sheet = state.sheet.slice()
  sheet[index] = option
  return assemble(sheet, nextFocus, state.baseFocus, [...state.undoStack, entry], [])
}

/**
 * 仅移动焦点（方向键 / 点击题目，纯函数）：不改变答卡、不在轨迹留痕，也不清空重做分支。
 * 越界（含边界外的目标）一律夹取忽略；尚无任何编辑时，同步更新底线焦点，
 * 使“先移动再作答、随后撤销”能把焦点送回该次作答发生前的位置。
 */
export function moveFocus(state: EditState, target: number): EditState {
  const focus = Math.max(0, Math.min(QUESTION_COUNT - 1, target))
  if (focus === state.focus) return state
  const baseFocus = state.undoStack.length === 0 ? focus : state.baseFocus
  return assemble(state.sheet, focus, baseFocus, state.undoStack, state.redoStack)
}

/**
 * 撤销最近一次有效变化（纯函数）：按逆序恢复变化前答案，
 * 焦点回到该变化发生之前的位置（上一条记录操作后的焦点，无记录时回到底线焦点）。
 * 无轨迹可撤销时原样返回（按钮禁用时快捷键同样无效果）。
 */
export function undoSelection(state: EditState): EditState {
  if (state.undoStack.length === 0) return state

  const entry = state.undoStack[state.undoStack.length - 1]
  const remaining = state.undoStack.slice(0, -1)
  const sheet = state.sheet.slice()
  sheet[entry.index] = entry.before
  const focus = remaining.length > 0 ? remaining[remaining.length - 1].focusAfter : state.baseFocus
  return assemble(sheet, focus, state.baseFocus, remaining, [...state.redoStack, entry])
}

/**
 * 重做最近撤销的变化（纯函数）：按原序恢复变化后答案与该操作后的焦点。
 * 无记录可重做时原样返回。
 */
export function redoSelection(state: EditState): EditState {
  if (state.redoStack.length === 0) return state

  const entry = state.redoStack[state.redoStack.length - 1]
  const remaining = state.redoStack.slice(0, -1)
  const sheet = state.sheet.slice()
  sheet[entry.index] = entry.after
  return assemble(sheet, entry.focusAfter, state.baseFocus, [...state.undoStack, entry], remaining)
}
