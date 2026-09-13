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
