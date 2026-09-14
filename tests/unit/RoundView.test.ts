import { mount, VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RoundView from '../../src/components/RoundView.vue'
import type { Answer } from '../../src/core/types'
import type { Option } from '../../src/data/questions'

function mountRound(round: 1 | 2 = 1) {
  return mount(RoundView, {
    props: { round },
    attachTo: document.body
  })
}

function press(wrapper: VueWrapper, key: string) {
  return wrapper.find('section.round').trigger('keydown', { key })
}

function pressWith(
  wrapper: VueWrapper,
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }
) {
  return wrapper.find('section.round').trigger('keydown', { key, ...modifiers })
}

async function undoByKey(wrapper: VueWrapper) {
  await pressWith(wrapper, 'z', { ctrlKey: true })
}

async function redoByKey(wrapper: VueWrapper, key: string, shiftKey = true) {
  await pressWith(wrapper, key, { ctrlKey: true, shiftKey })
}

async function answerAll(wrapper: VueWrapper, value: Option) {
  for (let i = 0; i < 20; i++) {
    await press(wrapper, value)
  }
}

describe('RoundView 键盘录入', () => {
  it('仅接受 A/B/C/D，其他按键直接忽略', async () => {
    const wrapper = mountRound()
    await press(wrapper, 'e')
    await press(wrapper, '1')
    await press(wrapper, 'Tab')
    await press(wrapper, 'Enter')
    await press(wrapper, ' ')

    expect(wrapper.findAll('[data-testid="missing-marker"]')).toHaveLength(0)
    await wrapper.find('[data-testid="submit-round"]').trigger('click')
    expect(wrapper.find('[data-testid="missing-summary"]').exists()).toBe(true)
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('A/B/C/D 作答并自动后移，方向键前后移动且夹在边界', async () => {
    const wrapper = mountRound()
    await press(wrapper, 'b') // 小写同样接受
    await press(wrapper, 'D')
    expect(wrapper.findAll('.question--current')[0].attributes('data-testid')).toBe('question-3')

    await press(wrapper, 'ArrowUp')
    expect(wrapper.findAll('.question--current')[0].attributes('data-testid')).toBe('question-2')
    await press(wrapper, 'ArrowLeft')
    expect(wrapper.findAll('.question--current')[0].attributes('data-testid')).toBe('question-1')
    await press(wrapper, 'ArrowUp')
    expect(wrapper.findAll('.question--current')[0].attributes('data-testid')).toBe('question-1')

    await press(wrapper, 'ArrowRight')
    await press(wrapper, 'ArrowRight')
    await press(wrapper, 'ArrowDown')
    expect(wrapper.findAll('.question--current')[0].attributes('data-testid')).toBe('question-4')

    expect(wrapper.find('[data-testid="q1-B"]').classes()).toContain('option--selected')
    expect(wrapper.find('[data-testid="q2-D"]').classes()).toContain('option--selected')
  })

  it('漏题提交被阻止，并在对应题目原位置给出提示', async () => {
    const wrapper = mountRound()
    await press(wrapper, 'A')
    await press(wrapper, 'B')
    // 其余 18 题不答，直接提交
    await wrapper.find('[data-testid="submit-round"]').trigger('click')

    expect(wrapper.emitted('submit')).toBeUndefined()
    const summary = wrapper.get('[data-testid="missing-summary"]').text()
    expect(summary).toContain('18')
    expect(summary).toContain('3')
    expect(summary).toContain('20')

    const markers = wrapper.findAll('[data-testid="missing-marker"]')
    expect(markers).toHaveLength(18)
    // 已答的第 1、2 题原位置无漏答标记
    expect(wrapper.find('[data-testid="question-1"]').find('[data-testid="missing-marker"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="question-3"]').find('[data-testid="missing-marker"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="question-20"]').find('[data-testid="missing-marker"]').exists()).toBe(true)
  })

  it('补齐漏题后可成功提交并输出 20 个答案', async () => {
    const wrapper = mountRound()
    await press(wrapper, 'A')
    await wrapper.find('[data-testid="submit-round"]').trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()

    for (let i = 1; i < 20; i++) await press(wrapper, 'C')
    await wrapper.find('[data-testid="submit-round"]').trigger('click')

    const events = wrapper.emitted('submit')
    expect(events).toBeDefined()
    const answers = events![0][0] as readonly Answer[]
    expect(answers).toHaveLength(20)
    expect(answers.every((a) => a !== null)).toBe(true)
    expect(answers[0]).toBe('A')
    expect(answers[19]).toBe('C')
  })
})

describe('RoundView 轮次隔离', () => {
  it('第二轮组件独立挂载时页面内容、焦点与输入均不预填首录答案', async () => {
    const first = mountRound(1)
    await answerAll(first, 'A')
    expect(first.find('.question--current').attributes('data-testid')).toBe('question-20')
    first.unmount()

    // 第二轮：以 round=2 重新挂载（与 App.vue 中 :key 切换后的行为一致）
    const second = mountRound(2)
    expect(second.find('h2').text()).toContain('第 2 轮')
    expect(second.findAll('.option--selected')).toHaveLength(0)
    // 焦点默认第一题，而不是首录停留的第 20 题
    expect(second.find('.question--current').attributes('data-testid')).toBe('question-1')
    // DOM 中不存在任何已选状态/首录值
    expect(second.find('[data-testid="q1-A"]').classes()).not.toContain('option--selected')
    expect(second.find('[data-testid="missing-summary"]').exists()).toBe(false)
  })

  it('鼠标点选选项同样生效', async () => {
    const wrapper = mountRound()
    await wrapper.find('[data-testid="q5-D"]').trigger('click')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-6')
    expect(wrapper.find('[data-testid="q5-D"]').classes()).toContain('option--selected')
  })
})

describe('RoundView 批量填入', () => {
  it('合法文本一次性写入 20 题（原子覆盖已有答案），写入后可单题修改并提交', async () => {
    const wrapper = mountRound()
    // 先用键盘录入 2 题，验证批量写入会整体覆盖而非跳过
    await press(wrapper, 'A')
    await press(wrapper, 'B')

    await wrapper.find('[data-testid="batch-toggle"]').trigger('click')
    const input = wrapper.find('[data-testid="batch-input"]')
    // 混合分隔符与大小写的 20 个选项
    await input.setValue(Array(20).fill('c').join(', \n'))

    expect(wrapper.find('[data-testid="batch-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="batch-preview"]').exists()).toBe(true)
    await wrapper.find('[data-testid="batch-apply"]').trigger('click')

    // 20 题全部写成 C（此前的 A、B 被整体覆盖），填入区自动收起
    for (let n = 1; n <= 20; n++) {
      expect(wrapper.find(`[data-testid="q${n}-C"]`).classes()).toContain('option--selected')
    }
    expect(wrapper.find('[data-testid="batch-panel"]').exists()).toBe(false)

    // 写入后仍可按原流程改单题并提交
    await wrapper.find('[data-testid="q1-D"]').trigger('click')
    await wrapper.find('[data-testid="submit-round"]').trigger('click')
    const events = wrapper.emitted('submit')
    expect(events).toBeDefined()
    const answers = events![0][0] as readonly Answer[]
    expect(answers).toHaveLength(20)
    expect(answers[0]).toBe('D')
    expect(answers[1]).toBe('C')
    expect(answers[19]).toBe('C')
  })

  it('非法字符与数量不足时指出错误、禁用确认，答卡不被部分覆盖', async () => {
    const wrapper = mountRound()
    await press(wrapper, 'A') // 第 1 题已答 A
    await wrapper.find('[data-testid="batch-toggle"]').trigger('click')
    const input = wrapper.find('[data-testid="batch-input"]')
    const apply = wrapper.find('[data-testid="batch-apply"]')

    // 含非法字符：指出首个非法字符，确认不可用
    await input.setValue('A B X C')
    expect(wrapper.find('[data-testid="batch-error"]').text()).toContain('X')
    expect(apply.attributes('disabled')).toBeDefined()

    // 数量不足：指出当前数量，确认不可用
    await input.setValue('A B C')
    expect(wrapper.find('[data-testid="batch-error"]').text()).toContain('3')
    expect(apply.attributes('disabled')).toBeDefined()

    // 即使强制触发点击也不会写入
    await apply.trigger('click')

    // 答卡保持原样：仍只有第 1 题 A，其余 19 题漏答
    expect(wrapper.find('[data-testid="q1-A"]').classes()).toContain('option--selected')
    expect(wrapper.findAll('.option--selected')).toHaveLength(1)
    await wrapper.find('[data-testid="submit-round"]').trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.findAll('[data-testid="missing-marker"]')).toHaveLength(19)
  })

  it('关闭批量填入区不改变已录答案', async () => {
    const wrapper = mountRound()
    await wrapper.find('[data-testid="batch-toggle"]').trigger('click')
    await wrapper.find('[data-testid="batch-input"]').setValue(Array(20).fill('B').join(' '))
    await wrapper.find('[data-testid="batch-apply"]').trigger('click')

    // 再次打开后直接收起，不做任何写入
    await wrapper.find('[data-testid="batch-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="batch-panel"]').exists()).toBe(true)
    await wrapper.find('[data-testid="batch-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="batch-panel"]').exists()).toBe(false)

    // 已录的 20 个 B 原样保留
    for (let n = 1; n <= 20; n++) {
      expect(wrapper.find(`[data-testid="q${n}-B"]`).classes()).toContain('option--selected')
    }
  })

  it('批量输入框中的按键不会录入答卡、不移动题序', async () => {
    const wrapper = mountRound()
    await wrapper.find('[data-testid="batch-toggle"]').trigger('click')
    const input = wrapper.find('[data-testid="batch-input"]')
    await input.trigger('keydown', { key: 'A' })
    await input.trigger('keydown', { key: 'd' })
    await input.trigger('keydown', { key: 'ArrowDown' })

    expect(wrapper.findAll('.option--selected')).toHaveLength(0)
    expect(wrapper.findAll('.question--current')[0].attributes('data-testid')).toBe('question-1')
  })
})

describe('RoundView 撤销 / 重做', () => {
  it('初始撤销、重做按钮均禁用', async () => {
    const wrapper = mountRound()
    expect(wrapper.find('[data-testid="undo"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="redo"]').attributes('disabled')).toBeDefined()
  })

  it('误触后鼠标撤销恢复答案与焦点，重做再恢复', async () => {
    const wrapper = mountRound()
    // 第 1 题误选 A，焦点自动到第 2 题
    await wrapper.find('[data-testid="q1-A"]').trigger('click')
    expect(wrapper.find('[data-testid="q1-A"]').classes()).toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-2')
    expect(wrapper.find('[data-testid="undo"]').attributes('disabled')).toBeUndefined()

    // 鼠标撤销：答案还原为空，焦点回到第 1 题，重做变为可用
    await wrapper.find('[data-testid="undo"]').trigger('click')
    expect(wrapper.find('[data-testid="q1-A"]').classes()).not.toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-1')
    expect(wrapper.find('[data-testid="undo"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="redo"]').attributes('disabled')).toBeUndefined()

    // 鼠标重做：答案与焦点都回到操作后的状态
    await wrapper.find('[data-testid="redo"]').trigger('click')
    expect(wrapper.find('[data-testid="q1-A"]').classes()).toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-2')
    expect(wrapper.find('[data-testid="redo"]').attributes('disabled')).toBeDefined()
  })

  it('Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 重做，与按钮行为一致', async () => {
    const wrapper = mountRound()
    await press(wrapper, 'B') // 第 1 题 B，焦点到第 2 题
    await undoByKey(wrapper)
    expect(wrapper.find('[data-testid="q1-B"]').classes()).not.toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-1')

    await redoByKey(wrapper, 'Z') // 大写 Z 同样识别
    expect(wrapper.find('[data-testid="q1-B"]').classes()).toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-2')

    // Meta 键（Cmd）与 shift 组合的重做同样可用
    await pressWith(wrapper, 'z', { metaKey: true })
    expect(wrapper.find('[data-testid="q1-B"]').classes()).not.toContain('option--selected')
    await pressWith(wrapper, 'z', { metaKey: true, shiftKey: true })
    expect(wrapper.find('[data-testid="q1-B"]').classes()).toContain('option--selected')
  })

  it('连续撤销按逆序恢复答案与焦点，连续重做按原序恢复', async () => {
    const wrapper = mountRound()
    await press(wrapper, 'A') // 1=A, 焦点 2
    await press(wrapper, 'B') // 2=B, 焦点 3
    await press(wrapper, 'C') // 3=C, 焦点 4

    await undoByKey(wrapper)
    expect(wrapper.find('[data-testid="q3-C"]').classes()).not.toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-3')
    await undoByKey(wrapper)
    expect(wrapper.find('[data-testid="q2-B"]').classes()).not.toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-2')
    await undoByKey(wrapper)
    expect(wrapper.find('[data-testid="q1-A"]').classes()).not.toContain('option--selected')
    expect(wrapper.findAll('.option--selected')).toHaveLength(0)
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-1')

    await redoByKey(wrapper, 'Z')
    expect(wrapper.find('[data-testid="q1-A"]').classes()).toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-2')
    await redoByKey(wrapper, 'Z')
    expect(wrapper.find('[data-testid="q2-B"]').classes()).toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-3')
    await redoByKey(wrapper, 'Z')
    expect(wrapper.find('[data-testid="q3-C"]').classes()).toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-4')
  })

  it('重复选择同一选项不进入轨迹，被忽略按键也不留痕', async () => {
    const wrapper = mountRound()
    await wrapper.find('[data-testid="q1-A"]').trigger('click')
    await undoByKey(wrapper) // 轨迹清空，焦点回到第 1 题
    // 在同一题上重复点选 A：仅第一次是有效变化，重复选择不产生记录
    await wrapper.find('[data-testid="q1-A"]').trigger('click')
    await wrapper.find('[data-testid="q1-A"]').trigger('click')
    await press(wrapper, 'x')
    await press(wrapper, '1')
    expect(wrapper.find('[data-testid="q1-A"]').classes()).toContain('option--selected')
    expect(wrapper.findAll('.option--selected')).toHaveLength(1)

    // 一次撤销即可清空全部，说明重复选择与无效按键均未留痕
    await undoByKey(wrapper)
    expect(wrapper.findAll('.option--selected')).toHaveLength(0)
    expect(wrapper.find('[data-testid="undo"]').attributes('disabled')).toBeDefined()
  })

  it('撤销后做出新选择会截断重做分支', async () => {
    const wrapper = mountRound()
    await press(wrapper, 'A')
    await press(wrapper, 'B')
    await undoByKey(wrapper) // 撤销 B
    expect(wrapper.find('[data-testid="redo"]').attributes('disabled')).toBeUndefined()

    // 在撤销状态下改选第 2 题为 D，重做分支被清空
    await press(wrapper, 'D')
    expect(wrapper.find('[data-testid="redo"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="q2-D"]').classes()).toContain('option--selected')

    // 撤销两次：先撤 D（焦点回第 2 题），再撤 A
    await undoByKey(wrapper)
    expect(wrapper.find('[data-testid="q2-D"]').classes()).not.toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-2')
    await undoByKey(wrapper)
    expect(wrapper.find('[data-testid="q1-A"]').classes()).not.toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-1')
  })

  it('撤销造成漏题后提交在原题显示漏答反馈', async () => {
    const wrapper = mountRound()
    await answerAll(wrapper, 'A')
    // 撤销两次：第 20、19 题变回漏答，焦点逆序回到第 19 题
    await undoByKey(wrapper)
    await undoByKey(wrapper)
    expect(wrapper.find('[data-testid="q19-A"]').classes()).not.toContain('option--selected')
    expect(wrapper.find('[data-testid="q20-A"]').classes()).not.toContain('option--selected')

    await wrapper.find('[data-testid="submit-round"]').trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
    const summary = wrapper.get('[data-testid="missing-summary"]').text()
    expect(summary).toContain('2')
    expect(summary).toContain('19')
    expect(summary).toContain('20')
    expect(wrapper.find('[data-testid="question-19"]').find('[data-testid="missing-marker"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="question-20"]').find('[data-testid="missing-marker"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="question-18"]').find('[data-testid="missing-marker"]').exists()).toBe(false)

    // 重做补齐后可正常提交
    await redoByKey(wrapper, 'Z')
    await redoByKey(wrapper, 'Z')
    await wrapper.find('[data-testid="submit-round"]').trigger('click')
    const events = wrapper.emitted('submit')
    expect(events).toBeDefined()
    expect(events![0][0]).toHaveLength(20)
  })

  it('按钮禁用时快捷键也不改变答卡', async () => {
    const wrapper = mountRound()
    await undoByKey(wrapper)
    await redoByKey(wrapper, 'Z')
    expect(wrapper.findAll('.option--selected')).toHaveLength(0)
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-1')

    await press(wrapper, 'C')
    await pressWith(wrapper, 'z', { ctrlKey: true, shiftKey: true }) // 无重做可做
    expect(wrapper.find('[data-testid="q1-C"]').classes()).toContain('option--selected')
    expect(wrapper.find('.question--current').attributes('data-testid')).toBe('question-2')
  })

  it('撤销/重做只作用于本轮，第二轮挂载时轨迹为空', async () => {
    const first = mountRound(1)
    await press(first, 'A')
    await press(first, 'B')
    await undoByKey(first)
    expect(first.find('[data-testid="redo"]').attributes('disabled')).toBeUndefined()
    first.unmount()

    const second = mountRound(2)
    expect(second.find('[data-testid="undo"]').attributes('disabled')).toBeDefined()
    expect(second.find('[data-testid="redo"]').attributes('disabled')).toBeDefined()
    expect(second.findAll('.option--selected')).toHaveLength(0)
    // 任何撤销都不能恢复首录快照
    await undoByKey(second)
    await pressWith(second, 'z', { metaKey: true, shiftKey: true })
    expect(second.findAll('.option--selected')).toHaveLength(0)
    expect(second.find('.question--current').attributes('data-testid')).toBe('question-1')
  })
})
