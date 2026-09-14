import { QUESTION_COUNT, type Option } from '../data/questions'
import type { Answer, AnswerSheet } from './types'
import { createEmptySheet } from './scoring'

/** 轨迹中某一道题的一次值变化（变化前可能为未作答 null）。 */
export interface EditChange {
  /** 题目下标（0 起，题号 - 1）。 */
  readonly index: number
  /** 变化前的答案（可能为未作答 null）。 */
  readonly before: Answer
  /** 变化后的答案（单题选择必为选项；批量步骤允许为 null 以支持部分覆盖场景）。 */
  readonly after: Answer
}

/**
 * 一轮答卡的一条可撤销编辑步骤：
 * 单题选择只含一个变化；批量整卡写入含全部发生变化的题目，作为一个原子步骤，
 * 一次撤销即可恢复覆盖前整张答卡。步骤同时记录操作前与操作后的焦点，
 * 因此即使操作前用过方向键移动，撤销也能把焦点送回操作发生时的位置。
 */
export interface EditEntry {
  readonly changes: readonly EditChange[]
  /** 本步骤发生前焦点所在的题目下标（0 起）。 */
  readonly focusBefore: number
  /** 本步骤完成后焦点所在的题目下标（0 起）。 */
  readonly focusAfter: number
}

/**
 * 一轮录入的可撤销/可重做状态（不可变值）。
 * 视图层只消费 sheet / focus / canUndo / canRedo，不直接改答卡。
 */
export interface EditState {
  readonly sheet: AnswerSheet
  readonly focus: number
  /** 已发生的有效步骤，按原序排列；撤销从末尾弹出。 */
  readonly undoStack: readonly EditEntry[]
  /** 已撤销的步骤，最近撤销的在末尾，即下一条重做记录。 */
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
  return Object.freeze(
    entries.map((entry) =>
      Object.freeze({
        changes: Object.freeze(entry.changes.map((change) => Object.freeze({ ...change }))),
        focusBefore: entry.focusBefore,
        focusAfter: entry.focusAfter
      })
    )
  )
}

function assemble(
  sheet: readonly Answer[],
  focus: number,
  undoStack: readonly EditEntry[],
  redoStack: readonly EditEntry[]
): EditState {
  return Object.freeze({
    sheet: freezeSheet(sheet),
    focus,
    undoStack: freezeStack(undoStack),
    redoStack: freezeStack(redoStack),
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0
  })
}

/**
 * 创建一轮全新的编辑轨迹（默认空白答卡、焦点在第一题）。
 * App.vue 以轮次为 key 整体重建组件，第二轮拿到的就是全新状态，
 * 不含任何首录答案或轨迹；“重新开始”同理。
 */
export function initHistory(sheet: readonly Answer[] = createEmptySheet(), focus = 0): EditState {
  if (sheet.length !== QUESTION_COUNT) {
    throw new Error(`编辑轨迹需要长度为 ${QUESTION_COUNT} 的答题卡`)
  }
  if (!validFocus(focus)) {
    throw new Error('初始焦点超出题目范围')
  }
  return assemble(sheet, focus, [], [])
}

/**
 * 提交一次选项选择（纯函数）：
 * - 与当前值相同的重复选择、越界题号一律视为无效动作，原样返回同一状态（不留痕、焦点不动）；
 * - 有效变化追加一条步骤并清空重做分支（撤销后另做新选择即分叉）；
 * - 步骤记录操作前的实际焦点与操作后的焦点（键盘作答自动后移、末题停留由视图规则决定）。
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
    changes: [{ index, before: state.sheet[index], after: option }],
    focusBefore: state.focus,
    focusAfter: nextFocus
  }
  const sheet = state.sheet.slice()
  sheet[index] = option
  return assemble(sheet, nextFocus, [...state.undoStack, entry], [])
}

/**
 * 批量整卡写入（纯函数）：一次性替换整张答卡，作为轨迹中的一个原子步骤：
 * - 只有值真正发生变化的题目记入该步骤；没有任何变化时原样返回（不留痕）；
 * - 撤销该步骤一次性恢复覆盖前整张答卡（含此前已录入的答案），重做再次整体写入；
 * - 与普通选择相同，写入后清空重做分支（之前被撤销的分支作废）；
 * - 焦点不被写入带走，仍停留在写入前的当前题。
 */
export function recordBatch(state: EditState, nextSheet: readonly Answer[]): EditState {
  if (nextSheet.length !== QUESTION_COUNT) return state

  const changes: EditChange[] = []
  for (let index = 0; index < QUESTION_COUNT; index++) {
    if (state.sheet[index] !== nextSheet[index]) {
      changes.push({ index, before: state.sheet[index], after: nextSheet[index] })
    }
  }
  if (changes.length === 0) return state

  const entry: EditEntry = { changes, focusBefore: state.focus, focusAfter: state.focus }
  return assemble(nextSheet.slice(), state.focus, [...state.undoStack, entry], [])
}

/**
 * 仅移动焦点（方向键 / 点击题目，纯函数）：不改变答卡、不在轨迹留痕，也不清空重做分支。
 * 越界目标夹取到边界；夹取后仍未变化时原样返回。
 */
export function moveFocus(state: EditState, target: number): EditState {
  const focus = Math.max(0, Math.min(QUESTION_COUNT - 1, target))
  if (focus === state.focus) return state
  return assemble(state.sheet, focus, state.undoStack, state.redoStack)
}

/**
 * 撤销最近一个步骤（纯函数）：按逆序恢复该步骤全部题目的变化前答案，
 * 焦点回到该步骤发生之前的位置。
 * 无轨迹可撤销时原样返回（按钮禁用时快捷键同样无效果）。
 */
export function undoSelection(state: EditState): EditState {
  if (state.undoStack.length === 0) return state

  const entry = state.undoStack[state.undoStack.length - 1]
  const remaining = state.undoStack.slice(0, -1)
  const sheet = state.sheet.slice()
  for (const change of entry.changes) sheet[change.index] = change.before
  return assemble(sheet, entry.focusBefore, remaining, [...state.redoStack, entry])
}

/**
 * 重做最近撤销的步骤（纯函数）：按原序恢复该步骤全部题目的变化后答案，
 * 焦点回到该步骤操作后的位置。
 * 无记录可重做时原样返回。
 */
export function redoSelection(state: EditState): EditState {
  if (state.redoStack.length === 0) return state

  const entry = state.redoStack[state.redoStack.length - 1]
  const remaining = state.redoStack.slice(0, -1)
  const sheet = state.sheet.slice()
  for (const change of entry.changes) sheet[change.index] = change.after
  return assemble(sheet, entry.focusAfter, [...state.undoStack, entry], remaining)
}
