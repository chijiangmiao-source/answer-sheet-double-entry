import { mount, VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PracticeView from '../../src/components/PracticeView.vue'
import { OPTIONS, type Option } from '../../src/data/questions'

function mountPractice() {
  return mount(PracticeView, { attachTo: document.body })
}

function press(wrapper: VueWrapper, key: string, init: Record<string, boolean> = {}) {
  return wrapper.find('section.practice').trigger('keydown', { key, ...init })
}

/** 当前页面展示的目标字母。 */
function currentTarget(wrapper: VueWrapper): Option {
  return wrapper.get('[data-testid="practice-target"]').text() as Option
}

/** 选一个与 target 不同的字母作为误按。 */
function wrongLetter(target: Option, avoid?: Option): Option {
  const found = OPTIONS.find((o) => o !== target && o !== avoid)
  if (!found) throw new Error('无法选出误按字母')
  return found
}

/** 一路按页面目标字母直到完成页出现。 */
async function finishAll(wrapper: VueWrapper) {
  for (let i = 0; i < 20; i++) {
    await press(wrapper, currentTarget(wrapper))
  }
}

async function startPractice(wrapper: VueWrapper) {
  await wrapper.get('[data-testid="practice-start"]').trigger('click')
}

describe('PracticeView 校准流程', () => {
  it('初始为待开始页：只有说明与开始按钮，不显示目标字母', async () => {
    const wrapper = mountPractice()
    expect(wrapper.find('[data-testid="practice-idle"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="practice-target"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="practice-done"]').exists()).toBe(false)

    await startPractice(wrapper)
    expect(wrapper.get('[data-testid="practice-step"]').text()).toBe('第 1 / 20 题')
    expect(currentTarget(wrapper)).toMatch(/^[ABCD]$/)
  })

  it('按下目标字母自动前进，页面只显示当前题号与目标字母', async () => {
    const wrapper = mountPractice()
    await startPractice(wrapper)

    await press(wrapper, currentTarget(wrapper))
    expect(wrapper.get('[data-testid="practice-step"]').text()).toBe('第 2 / 20 题')

    // 页面不暴露后续序列：只有一个目标字母区域
    expect(wrapper.findAll('[data-testid="practice-target"]')).toHaveLength(1)
  })

  it('合法但错误的字母不推进，可继续尝试直至命中', async () => {
    const wrapper = mountPractice()
    await startPractice(wrapper)

    const target = currentTarget(wrapper)
    await press(wrapper, wrongLetter(target))
    await press(wrapper, wrongLetter(target, wrongLetter(target)))
    expect(wrapper.get('[data-testid="practice-step"]').text()).toBe('第 1 / 20 题')

    await press(wrapper, target)
    expect(wrapper.get('[data-testid="practice-step"]').text()).toBe('第 2 / 20 题')
  })

  it('A-D 以外的按键、Ctrl/Cmd/Alt 组合键与自动重复都不推进', async () => {
    const wrapper = mountPractice()
    await startPractice(wrapper)
    const target = currentTarget(wrapper)

    for (const key of ['e', '1', 'Enter', ' ', 'Tab', 'ArrowDown']) {
      await press(wrapper, key)
    }
    await press(wrapper, 'a', { ctrlKey: true })
    await press(wrapper, 'b', { metaKey: true })
    await press(wrapper, 'c', { altKey: true })
    await press(wrapper, target, { repeat: true }) // 浏览器自动重复不计数
    expect(wrapper.get('[data-testid="practice-step"]').text()).toBe('第 1 / 20 题')

    // 忽略按键不污染统计：随后全程命中，首次命中应为 20/20
    await finishAll(wrapper)
    expect(wrapper.get('[data-testid="practice-first-hits"]').text()).toContain('20 / 20')
    expect(wrapper.get('[data-testid="practice-missteps"]').text()).toContain('无')
  })

  it('全对完成后展示首次命中 20/20、误按题号“无”、各字母误按 0 次', async () => {
    const wrapper = mountPractice()
    await startPractice(wrapper)
    await finishAll(wrapper)

    expect(wrapper.find('[data-testid="practice-running"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="practice-first-hits"]').text()).toContain('20 / 20')
    expect(wrapper.get('[data-testid="practice-missteps"]').text()).toContain('无')
    for (const letter of OPTIONS) {
      expect(wrapper.get(`[data-testid="practice-miss-${letter}"]`).text()).toContain('0 次')
    }
  })

  it('含误按完成：结束页展示首次命中数、误按题号与各字母误按次数', async () => {
    const wrapper = mountPractice()
    await startPractice(wrapper)

    // 第 1 题：连续误按两个不同字母（只记首次），再命中
    const t1 = currentTarget(wrapper)
    const w1 = wrongLetter(t1)
    await press(wrapper, w1)
    await press(wrapper, wrongLetter(t1, w1))
    await press(wrapper, t1)

    // 第 2 题：误按一次（与第 1 题不同的错误字母）后命中
    const t2 = currentTarget(wrapper)
    const w2 = wrongLetter(t2, w1)
    await press(wrapper, w2)
    await press(wrapper, t2)

    // 其余题目一次命中
    for (let i = 2; i < 20; i++) {
      await press(wrapper, currentTarget(wrapper))
    }

    expect(wrapper.get('[data-testid="practice-first-hits"]').text()).toContain('18 / 20')
    expect(wrapper.get('[data-testid="practice-missteps"]').text()).toContain('第 1、2 题')
    expect(wrapper.get(`[data-testid="practice-miss-${w1}"]`).text()).toContain('1 次')
    expect(wrapper.get(`[data-testid="practice-miss-${w2}"]`).text()).toContain('1 次')
    // 误按总数恰为 2：同一题的重复误按没有被重复计数
    const counts = OPTIONS.map((letter) => {
      const text = wrapper.get(`[data-testid="practice-miss-${letter}"]`).text()
      return Number(text.match(/(\d+) 次/)?.[1])
    })
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(2)
  })

  it('重新校准得到全新会话：进度与统计归零，可再次完整完成', async () => {
    const wrapper = mountPractice()
    await startPractice(wrapper)

    // 制造进度与误按后重新校准
    await press(wrapper, wrongLetter(currentTarget(wrapper)))
    await press(wrapper, currentTarget(wrapper))
    await wrapper.get('[data-testid="practice-restart"]').trigger('click')

    expect(wrapper.get('[data-testid="practice-step"]').text()).toBe('第 1 / 20 题')
    await finishAll(wrapper)
    // 旧会话的误按不带入新会话
    expect(wrapper.get('[data-testid="practice-first-hits"]').text()).toContain('20 / 20')
    expect(wrapper.get('[data-testid="practice-missteps"]').text()).toContain('无')

    // 完成页也可重新校准
    await wrapper.get('[data-testid="practice-restart"]').trigger('click')
    expect(wrapper.get('[data-testid="practice-step"]').text()).toBe('第 1 / 20 题')
  })

  it('点击“返回首页”发出 exit，由外层卸载即丢弃本次校准', async () => {
    const wrapper = mountPractice()
    await startPractice(wrapper)
    await press(wrapper, currentTarget(wrapper))

    await wrapper.get('[data-testid="practice-exit"]').trigger('click')
    expect(wrapper.emitted('exit')).toHaveLength(1)
  })
})
