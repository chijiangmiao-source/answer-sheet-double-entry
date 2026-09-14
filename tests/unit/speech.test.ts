import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import RoundView from '../../src/components/RoundView.vue'
import { useSpeechPreference } from '../../src/composables/useSpeechPreference'
import {
  SpeechEngineKey,
  buildAnnouncement,
  createSpeechController,
  type SpeechEngine
} from '../../src/core/speech'

interface FakeEngine {
  engine: SpeechEngine
  /** 已交给引擎朗读的文本（入队即记录，含尚未读完的）。 */
  spoken: string[]
  /** 当前在播条目的结束回调（正常/失败统一走它）。 */
  pending: Array<() => void>
  /** 每次 cancel 时仍在播（含排队）的条目数。 */
  cancels: number[]
  setSpeakThrows(): void
  finishAll(): void
}

function makeFakeEngine(supported = true): FakeEngine {
  let throwNext = false
  const fake = {} as FakeEngine
  fake.spoken = []
  fake.pending = []
  fake.cancels = []
  fake.setSpeakThrows = () => {
    throwNext = true
  }
  fake.finishAll = () => {
    // onEnd 会同步驱动下一条入队，循环到队列清空。
    while (fake.pending.length > 0) {
      fake.pending.shift()!()
    }
  }

  fake.engine = {
    supported,
    speak(text, handlers) {
      fake.spoken.push(text)
      if (throwNext) {
        throwNext = false
        throw new Error('语音引擎朗读失败')
      }
      fake.pending.push(handlers.onEnd)
    },
    cancel() {
      fake.cancels.push(fake.pending.length)
      fake.pending.length = 0
    }
  }
  return fake
}

describe('语音核读 · 播报映射', () => {
  it('有效选择映射为“第几题、所选字母”', () => {
    expect(buildAnnouncement(1, 'A')).toBe('第 1 题，所选 A')
    expect(buildAnnouncement(3, 'B')).toBe('第 3 题，所选 B')
    expect(buildAnnouncement(20, 'D')).toBe('第 20 题，所选 D')
  })

  it('关闭时不播报；开启后立即播报，连录时其余条目排队顺序播出', () => {
    const fake = makeFakeEngine()
    const speech = createSpeechController(fake.engine)

    speech.announce(1, 'A')
    expect(fake.spoken).toEqual([])

    speech.setEnabled(true)
    speech.announce(1, 'A')
    speech.announce(2, 'B')
    speech.announce(3, 'C')
    // 第一条立即朗读，后两条排队，连录不打断当前播报。
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])

    fake.finishAll()
    expect(fake.spoken).toEqual(['第 1 题，所选 A', '第 2 题，所选 B', '第 3 题，所选 C'])
  })

  it('单条朗读抛错只中止当前语音，不抛出且后续条目继续播出', () => {
    const fake = makeFakeEngine()
    const speech = createSpeechController(fake.engine, true)
    fake.setSpeakThrows()
    expect(() => speech.announce(1, 'A')).not.toThrow()
    // 失败条目不阻断后续播报。
    speech.announce(2, 'B')
    expect(fake.spoken).toEqual(['第 1 题，所选 A', '第 2 题，所选 B'])
  })
})

describe('语音核读 · 关闭取消', () => {
  it('关闭时立即取消尚未播放的内容，排队条目与过期回调都不再播出', () => {
    const fake = makeFakeEngine()
    const speech = createSpeechController(fake.engine, true)
    speech.announce(1, 'A')
    speech.announce(2, 'B')
    speech.announce(3, 'C')
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])

    speech.setEnabled(false)
    expect(fake.cancels).toEqual([1]) // 引擎的 cancel 被调用，当时 1 条在播
    expect(speech.enabled).toBe(false)

    // 关闭期间新的有效选择不进入队列。
    speech.announce(4, 'D')
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])

    // 即使旧在播条目迟到的结束回调到达，也不能放行队列中的旧内容。
    // 重新开启后，旧队列已清空，只播此后的新条目。
    speech.setEnabled(true)
    fake.finishAll()
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])
    speech.announce(5, 'A')
    expect(fake.spoken).toEqual(['第 1 题，所选 A', '第 5 题，所选 A'])
  })

  it('dispose 取消全部语音且之后任何播报均无效', () => {
    const fake = makeFakeEngine()
    const speech = createSpeechController(fake.engine, true)
    speech.announce(1, 'A')
    speech.announce(2, 'B')
    speech.dispose()
    expect(fake.cancels).toEqual([1])
    speech.announce(3, 'C')
    speech.setEnabled(true) // 已销毁，重新开启也无效
    speech.announce(4, 'D')
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])
  })
})

describe('语音核读 · 不支持环境', () => {
  it('引擎不支持时无法开启，announce 为空操作且从不触碰引擎朗读', () => {
    const fake = makeFakeEngine(false)
    const speech = createSpeechController(fake.engine, true) // 即使初值要求开启
    expect(speech.supported).toBe(false)
    expect(speech.enabled).toBe(false)

    speech.setEnabled(true)
    expect(speech.enabled).toBe(false)
    speech.announce(1, 'A')
    expect(fake.spoken).toEqual([])
  })
})

// ---- RoundView 集成：只在单题有效选择时把题号与选项交给适配层 ----

function mountWith(engine: SpeechEngine, round: 1 | 2 = 1) {
  return mount(RoundView, {
    props: { round },
    attachTo: document.body,
    global: { provide: { [SpeechEngineKey as symbol]: engine } }
  })
}

async function press(wrapper: VueWrapper, key: string) {
  await wrapper.find('section.round').trigger('keydown', { key })
}

async function enableSpeech(wrapper: VueWrapper) {
  await wrapper.get('[data-testid="speech-toggle"]').trigger('click')
  expect(wrapper.get('[data-testid="speech-toggle"]').attributes('aria-pressed')).toBe('true')
}

describe('RoundView 语音核读', () => {
  beforeEach(() => {
    // 单例偏好在用例间复用：每例先恢复为关闭并清掉落盘值，避免相互污染。
    localStorage.clear()
    useSpeechPreference().setSpeechReviewEnabled(false)
  })

  it('有效单题选择（键盘/鼠标）按题号与所选字母播报', async () => {
    const fake = makeFakeEngine()
    const wrapper = mountWith(fake.engine)
    await enableSpeech(wrapper)

    await press(wrapper, 'A')
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])
    fake.finishAll()

    await wrapper.get('[data-testid="q5-D"]').trigger('click')
    expect(fake.spoken).toEqual(['第 1 题，所选 A', '第 5 题，所选 D'])

    // 小写字母同样映射为选项字母。
    fake.finishAll()
    await press(wrapper, 'b') // 当前焦点在第 6 题
    expect(fake.spoken.at(-1)).toBe('第 6 题，所选 B')
    wrapper.unmount()
  })

  it('重复点击同一选项、被忽略按键、焦点移动均静默', async () => {
    const fake = makeFakeEngine()
    const wrapper = mountWith(fake.engine)
    await enableSpeech(wrapper)

    await wrapper.get('[data-testid="q1-A"]').trigger('click')
    await wrapper.get('[data-testid="q1-A"]').trigger('click') // 重复选同一项
    await wrapper.get('[data-testid="q1-A"]').trigger('click')
    await press(wrapper, 'x') // 非选项按键
    await press(wrapper, '1')
    await press(wrapper, 'Tab')
    await press(wrapper, 'ArrowDown') // 仅移动焦点
    await wrapper.get('[data-testid="question-9"]').trigger('click') // 鼠标移焦点

    expect(fake.spoken).toEqual(['第 1 题，所选 A'])
    wrapper.unmount()
  })

  it('撤销 / 重做不触发播报', async () => {
    const fake = makeFakeEngine()
    const wrapper = mountWith(fake.engine)
    await enableSpeech(wrapper)

    await press(wrapper, 'A')
    await press(wrapper, 'B')
    await press(wrapper, 'C')
    fake.finishAll() // 排空队列，确认三次选择都已交给引擎
    await wrapper.get('[data-testid="undo"]').trigger('click')
    await wrapper.get('[data-testid="undo"]').trigger('click')
    await wrapper.get('[data-testid="redo"]').trigger('click')
    await wrapper.find('section.round').trigger('keydown', { key: 'z', ctrlKey: true })
    await wrapper
      .find('section.round')
      .trigger('keydown', { key: 'z', ctrlKey: true, shiftKey: true })

    expect(fake.spoken).toEqual(['第 1 题，所选 A', '第 2 题，所选 B', '第 3 题，所选 C'])
    wrapper.unmount()
  })

  it('批量整卡写入不触发播报', async () => {
    const fake = makeFakeEngine()
    const wrapper = mountWith(fake.engine)
    await enableSpeech(wrapper)

    await press(wrapper, 'A')
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])

    await wrapper.get('[data-testid="batch-toggle"]').trigger('click')
    await wrapper.get('[data-testid="batch-input"]').setValue(Array(20).fill('d').join(' '))
    await wrapper.get('[data-testid="batch-apply"]').trigger('click')
    expect(wrapper.findAll('.option--selected')).toHaveLength(20)
    // 20 题整卡写入没有产生任何语音事件。
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])

    // 批量后再做单题有效选择，核读照常。
    fake.finishAll()
    await wrapper.get('[data-testid="q2-C"]').trigger('click')
    expect(fake.spoken.at(-1)).toBe('第 2 题，所选 C')
    wrapper.unmount()
  })

  it('关闭核读立即取消在播与排队内容，之后选择静默；再次开启恢复', async () => {
    const fake = makeFakeEngine()
    const wrapper = mountWith(fake.engine)
    await enableSpeech(wrapper)

    await press(wrapper, 'A')
    await press(wrapper, 'B')
    await press(wrapper, 'C')
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])

    await wrapper.get('[data-testid="speech-toggle"]').trigger('click')
    expect(wrapper.get('[data-testid="speech-toggle"]').attributes('aria-pressed')).toBe('false')
    expect(fake.cancels.length).toBeGreaterThan(0)

    // 关闭期间录入照常进行，但不再产生语音。
    await press(wrapper, 'D')
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])
    expect(wrapper.get('[data-testid="q4-D"]').classes()).toContain('option--selected')

    await wrapper.get('[data-testid="speech-toggle"]').trigger('click')
    await wrapper.get('[data-testid="q4-A"]').trigger('click')
    expect(fake.spoken.at(-1)).toBe('第 4 题，所选 A')
    wrapper.unmount()
  })

  it('播报失败不回滚答案、不阻止完整性校验与提交', async () => {
    const fake = makeFakeEngine()
    fake.setSpeakThrows()
    const wrapper = mountWith(fake.engine)
    await enableSpeech(wrapper)

    for (let i = 0; i < 20; i++) await press(wrapper, 'A')
    // 20 题全部作答成功，语音抛错没有回滚任何答案。
    expect(wrapper.findAll('.option--selected')).toHaveLength(20)
    await wrapper.get('[data-testid="submit-round"]').trigger('click')
    expect(wrapper.emitted('submit')).toBeDefined()
    wrapper.unmount()
  })

  it('跨轮重新挂载：保持开关偏好，但取消并清空旧轮待播内容', async () => {
    const fake = makeFakeEngine()
    const first = mountWith(fake.engine, 1)
    await enableSpeech(first)
    await press(first, 'A')
    await press(first, 'B')
    await press(first, 'C') // 仅第 1 条在播，第 2、3 条排队
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])
    first.unmount() // 轮次切换：旧实例销毁
    expect(fake.cancels.length).toBeGreaterThan(0)

    // 第二轮重新挂载：开关保持开启，但旧轮排队内容永不播出。
    const second = mountWith(fake.engine, 2)
    expect(second.get('[data-testid="speech-toggle"]').attributes('aria-pressed')).toBe('true')
    expect(fake.spoken).toEqual(['第 1 题，所选 A'])
    // 新轮第一次有效选择立即播出，说明待播队列已空、在播状态已复位。
    await press(second, 'D')
    expect(fake.spoken).toEqual(['第 1 题，所选 A', '第 1 题，所选 D'])
    second.unmount()
  })

  it('不支持语音的环境：入口禁用并就地说明，录入与提交不受影响', async () => {
    const fake = makeFakeEngine(false)
    const wrapper = mountWith(fake.engine)
    const toggle = wrapper.get('[data-testid="speech-toggle"]')
    expect(toggle.attributes('disabled')).toBeDefined()
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('[data-testid="speech-unsupported"]').text()).toContain('不支持')
    await toggle.trigger('click') // 点击被禁用，不会开启
    expect(toggle.attributes('aria-pressed')).toBe('false')

    await press(wrapper, 'A')
    expect(fake.spoken).toEqual([])
    for (let i = 1; i < 20; i++) await press(wrapper, 'B')
    await wrapper.get('[data-testid="submit-round"]').trigger('click')
    expect(wrapper.emitted('submit')).toBeDefined()
    wrapper.unmount()
  })
})
