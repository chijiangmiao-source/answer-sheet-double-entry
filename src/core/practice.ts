import { OPTIONS, type Option } from '../data/questions'

/**
 * 键位校准（独立领域模块）。
 *
 * 正式双录前，录入员用 20 步目标序列确认 A / B / C / D 四个键位输入可靠。
 * 本模块与答卡会话、裁决结果完全隔离：不读取、不写入任何答题数据，
 * 校准进度与统计只存在于不可变的 PracticeSession 值对象中，刷新或离开训练页即丢弃。
 *
 * 服务契约仅两个入口：
 * - start(seed)：用可注入的种子确定性地生成目标序列，返回全新会话；
 * - acceptKey(session, key)：提交一次按键，返回迁移后的新会话（原会话不被修改）。
 * 视图层只能消费会话、提交按键，不能改写进度或统计。
 */

/** 校准步数：固定 20 步。 */
export const PRACTICE_STEP_COUNT = 20
/** 每个字母在目标序列中出现的次数（4 字母 × 5 = 20 步）。 */
export const PRACTICE_PER_LETTER = 5
/** 同一字母允许的最大连续出现次数。 */
export const PRACTICE_MAX_RUN = 2

/**
 * 一次键位校准的不可变会话状态。
 * 所有字段只读且深度冻结；任何迁移都由 acceptKey 返回新对象完成。
 */
export interface PracticeSession {
  /** 生成目标序列所用的种子（已规范化为无符号 32 位整数）。 */
  readonly seed: number
  /** 目标序列：长度 20，四个字母各 5 次，同一字母不连续超过两次。 */
  readonly targets: readonly Option[]
  /** 当前步下标（0 起）；等于步数时表示全部完成。 */
  readonly index: number
  /** 首次命中数：第一次按键即命中目标字母的步数。 */
  readonly firstHits: number
  /** 发生过误按的题号（1 起，升序；每题至多记录一次）。 */
  readonly missteps: readonly number[]
  /** 各字母的误按次数（每题只计首次误按的那一次）。 */
  readonly missesByLetter: Readonly<Record<Option, number>>
  /** 当前步是否已记录过首次误按（再按错不重复计数，允许继续尝试）。 */
  readonly currentMissed: boolean
  /** 是否已完成全部 20 步。 */
  readonly done: boolean
}

/**
 * mulberry32 伪随机数发生器：体积小、可种子化，同一种子的输出序列完全确定。
 * 仅用于校准序列生成，与答卡业务无关。
 */
function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 构造多重集合：四个字母各 PRACTICE_PER_LETTER 次，共 20 个。 */
function buildPool(): Option[] {
  const pool: Option[] = []
  for (const letter of OPTIONS) {
    for (let i = 0; i < PRACTICE_PER_LETTER; i++) pool.push(letter)
  }
  return pool
}

/** Fisher-Yates 洗牌，随机性全部来自注入的 rng。 */
function shuffle(pool: readonly Option[], rng: () => number): Option[] {
  const arr = pool.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/** 校验“同一字母不连续超过 PRACTICE_MAX_RUN 次”。 */
function respectsRunLimit(sequence: readonly Option[]): boolean {
  let run = 1
  for (let i = 1; i < sequence.length; i++) {
    run = sequence[i] === sequence[i - 1] ? run + 1 : 1
    if (run > PRACTICE_MAX_RUN) return false
  }
  return true
}

/**
 * 由种子确定性地生成目标序列：对多重集合洗牌，不满足连续约束时拒绝重洗。
 * rng 由种子唯一驱动，因此同一种子必然得到同一序列；约束保证四个字母
 * 各出现 5 次且同一字母不连续超过两次。
 */
function generateTargets(seed: number): readonly Option[] {
  const rng = createRng(seed)
  const pool = buildPool()
  for (;;) {
    const candidate = shuffle(pool, rng)
    if (respectsRunLimit(candidate)) return Object.freeze(candidate)
  }
}

function zeroMisses(): Record<Option, number> {
  return { A: 0, B: 0, C: 0, D: 0 }
}

/** 组装并深度冻结一个会话值对象。 */
function assemble(
  seed: number,
  targets: readonly Option[],
  index: number,
  firstHits: number,
  missteps: readonly number[],
  missesByLetter: Readonly<Record<Option, number>>,
  currentMissed: boolean
): PracticeSession {
  return Object.freeze({
    seed,
    targets,
    index,
    firstHits,
    missteps: Object.freeze(missteps.slice()),
    missesByLetter: Object.freeze({ ...missesByLetter }),
    currentMissed,
    done: index >= targets.length
  })
}

/**
 * 开始一次校准（纯函数）：用注入的种子确定性地生成 20 步目标序列，
 * 返回全新的不可变会话（第 1 步、统计全零）。种子规范化为无符号 32 位整数，
 * 同一种子在任何时刻、任何环境下生成的序列完全一致。
 */
export function start(seed: number): PracticeSession {
  const normalizedSeed = seed >>> 0
  return assemble(normalizedSeed, generateTargets(normalizedSeed), 0, 0, [], zeroMisses(), false)
}

/**
 * 提交一次按键（纯函数）：返回迁移后的新会话，原会话不被修改。
 * - A / B / C / D（大小写均可）以外的按键一律忽略，原样返回同一会话；
 * - 命中目标字母：前进到下一步；本步未曾误按则计一次首次命中；
 * - 合法但错误的字母：只记录该题首次误按（题号 + 该字母误按次数），
 *   不前进、允许继续尝试；该题后续误按不再重复计数；
 * - 已完成的会话不再接受任何按键。
 * Ctrl / Cmd / Alt 组合键与浏览器自动重复由视图层在调用前过滤，不进入本函数。
 */
export function acceptKey(session: PracticeSession, key: string): PracticeSession {
  if (session.done) return session
  const letter = key.toUpperCase()
  if (!(OPTIONS as readonly string[]).includes(letter)) return session
  const option = letter as Option

  if (option === session.targets[session.index]) {
    // 命中：前进一步；本步干净（从未误按）才累计首次命中。
    return assemble(
      session.seed,
      session.targets,
      session.index + 1,
      session.currentMissed ? session.firstHits : session.firstHits + 1,
      session.missteps,
      session.missesByLetter,
      false
    )
  }

  // 合法但错误的字母：每题只记首次误按，允许继续尝试（停留在本题）。
  if (session.currentMissed) return session
  return assemble(
    session.seed,
    session.targets,
    session.index,
    session.firstHits,
    [...session.missteps, session.index + 1],
    { ...session.missesByLetter, [option]: session.missesByLetter[option] + 1 },
    true
  )
}
