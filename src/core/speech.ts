import type { InjectionKey } from 'vue'
import type { Option } from '../data/questions'

/**
 * 语音核读适配层。
 *
 * 职责边界：RoundView 只在“单题有效选择”发生时把（题号, 选项）交给 announce，
 * 重复点击同一选项、焦点移动、撤销/重做、批量整卡写入、被忽略按键都不会到达这里；
 * 适配层不接触答卡与编辑轨迹，播报失败（含 speak 抛错）只中止当前语音，
 * 不回滚答案、不阻止完整性校验与提交。
 */

/** 一条语音播报结束（正常读完或出错中止）时的回调。 */
export interface SpeechHandlers {
  readonly onEnd: () => void
}

export interface SpeechEngine {
  /** 浏览器是否具备语音合成能力。 */
  readonly supported: boolean
  /** 朗读 text；同一条目正常结束或失败后都必须调用 handlers.onEnd 恰好一次。 */
  speak(text: string, handlers: SpeechHandlers): void
  /** 取消正在播放与排队中的全部语音。 */
  cancel(): void
}

/**
 * 把一次有效选择映射为核读文本：“第 N 题，所选 X”。
 * 纯函数，题号从 1 起；供单测直接验证播报映射。
 */
export function buildAnnouncement(number: number, option: Option): string {
  return `第 ${number} 题，所选 ${option}`
}

export interface SpeechController {
  /** 浏览器是否具备语音合成能力（SpeechSynthesis 可用）。 */
  readonly supported: boolean
  /** 用户是否开启核读（仅在 supported 时可能为 true）。 */
  readonly enabled: boolean
  setEnabled(value: boolean): void
  /** 播报一次有效选择；核读关闭或环境不支持时为空操作。 */
  announce(number: number, option: Option): void
  /** 组件卸载时调用：取消尚未播放的内容，后续回调全部作废。 */
  dispose(): void
}

/**
 * 基于注入引擎创建核读控制器。
 *
 * 队列规则：快速连录时新播报排队等待，不打断上一条；某条出错只终止该条，
 * 后续条目继续播放。关闭核读或组件卸载时 cancel 清空队列（含正在播放的），
 * 并作废旧回调，保证旧轮次/旧开关状态的语音事件不会复活。
 */
export function createSpeechController(
  engine: SpeechEngine,
  initialEnabled = false
): SpeechController {
  /** 待播文本队列；连录不打断当前播报，逐条读出。 */
  const queue: string[] = []
  let speaking = false
  let disposed = false
  /** 单调递增：cancel / dispose 后旧序号的结束回调一律丢弃。 */
  let generation = 0
  let enabled = initialEnabled && engine.supported

  function speakNext(): void {
    if (speaking || disposed || !enabled) return
    const text = queue.shift()
    if (text === undefined) return
    speaking = true
    const myGeneration = generation
    try {
      engine.speak(text, {
        onEnd: () => {
          // 关闭/卸载后的过期回调不允许驱动新队列。
          if (myGeneration !== generation) return
          speaking = false
          speakNext()
        }
      })
    } catch {
      // 播报失败只停止当前语音：放行后续条目，绝不向上抛出影响录入。
      if (myGeneration !== generation) return
      speaking = false
      speakNext()
    }
  }

  function cancelPending(): void {
    generation += 1
    queue.length = 0
    speaking = false
    engine.cancel()
  }

  return {
    get supported() {
      return engine.supported
    },
    get enabled() {
      return enabled
    },
    setEnabled(value) {
      if (!engine.supported || disposed) return
      const next = !!value
      if (next === enabled) return
      enabled = next
      if (!enabled) cancelPending() // 关闭核读：立即取消尚未播放的内容
    },
    announce(number, option) {
      if (!enabled || disposed || !engine.supported) return
      queue.push(buildAnnouncement(number, option))
      speakNext()
    },
    dispose() {
      if (disposed) return
      disposed = true
      enabled = false
      cancelPending()
    }
  }
}

/**
 * 引擎注入键：测试可通过 provide 替换为假引擎；生产代码缺省使用 Web Speech 引擎。
 * 仅类型引用 vue，编译后擦除，不影响适配层纯逻辑。
 */
export const SpeechEngineKey: InjectionKey<SpeechEngine> = Symbol('speech-engine')

/** 浏览器原生 Web Speech API 适配：不支持时 supported 为 false，任何调用均安全。 */
export class WebSpeechEngine implements SpeechEngine {
  readonly supported: boolean

  constructor(
    private readonly synthesis: SpeechSynthesis | undefined,
    private readonly createUtterance: (text: string) => SpeechSynthesisUtterance
  ) {
    this.supported = !!synthesis && typeof synthesis.speak === 'function'
  }

  speak(text: string, handlers: SpeechHandlers): void {
    if (!this.supported || !this.synthesis) return
    const utterance = this.createUtterance(text)
    utterance.lang = 'zh-CN'
    // 出错与正常结束都视为“本条结束”：只停当前这条，队列继续。
    utterance.onend = () => handlers.onEnd()
    utterance.onerror = () => handlers.onEnd()
    this.synthesis.speak(utterance)
  }

  cancel(): void {
    if (!this.supported || !this.synthesis) return
    this.synthesis.cancel()
  }
}

/** 从当前 window 构造原生引擎；jsdom/无语音环境下 supported 为 false。 */
export function createWebSpeechEngine(win: Window = window): WebSpeechEngine {
  const synthesis = typeof win.speechSynthesis !== 'undefined' ? win.speechSynthesis : undefined
  // SpeechSynthesisUtterance 构造器挂在全局而非 Window 接口上，取全局构造函数。
  const Ctor: typeof SpeechSynthesisUtterance | undefined =
    typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : undefined
  return new WebSpeechEngine(synthesis, (text) => {
    if (!Ctor) throw new Error('当前环境不支持 SpeechSynthesisUtterance')
    return new Ctor(text)
  })
}
