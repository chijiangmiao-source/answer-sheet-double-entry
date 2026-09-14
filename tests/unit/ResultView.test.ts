import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ResultView from '../../src/components/ResultView.vue'
import { QUESTION_COUNT } from '../../src/data/questions'
import type { Difference, Verdict } from '../../src/core/types'

function diff(partial: Partial<Difference> & Pick<Difference, 'number' | 'first' | 'second'>): Difference {
  return Object.freeze({
    firstReviewed: false,
    secondReviewed: false,
    ...partial
  }) as Difference
}

function verdict(differences: readonly Difference[]): Verdict {
  return Object.freeze({
    passed: differences.length === 0,
    score: `${QUESTION_COUNT - differences.length}/${QUESTION_COUNT}`,
    differences: Object.freeze(differences)
  })
}

describe('ResultView 待复核提示', () => {
  it('不通过时只在被标记轮次的差异格展示提示', () => {
    const wrapper = mount(ResultView, {
      props: {
        verdict: verdict([
          diff({ number: 3, first: 'A', second: 'B', firstReviewed: true }),
          diff({ number: 8, first: 'A', second: 'C', secondReviewed: true }),
          diff({ number: 12, first: 'A', second: 'D', firstReviewed: true, secondReviewed: true }),
          diff({ number: 15, first: 'B', second: 'C' })
        ])
      }
    })

    // 第 3 题：仅首录提示
    expect(wrapper.find('[data-testid="diff-3-first-review"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="diff-3-second-review"]').exists()).toBe(false)
    // 第 8 题：仅第二遍提示
    expect(wrapper.find('[data-testid="diff-8-first-review"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="diff-8-second-review"]').exists()).toBe(true)
    // 第 12 题：两轮都提示
    expect(wrapper.find('[data-testid="diff-12-first-review"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="diff-12-second-review"]').exists()).toBe(true)
    // 第 15 题：双方都未标记，不出现任何提示
    expect(wrapper.find('[data-testid="diff-15-first-review"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="diff-15-second-review"]').exists()).toBe(false)
    // 既有字段原样保留
    expect(wrapper.get('[data-testid="diff-3"]').findAll('td')[0].text()).toBe('第 3 题')
  })

  it('通过时不展示差异表，也没有任何待复核提示', () => {
    const wrapper = mount(ResultView, { props: { verdict: verdict([]) } })
    expect(wrapper.find('[data-testid="diffs"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid$="-review"]')).toHaveLength(0)
    expect(wrapper.get('[data-testid="verdict-text"]').text()).toBe('通过')
    expect(wrapper.get('[data-testid="verdict-score"]').text()).toBe('20/20')
  })
})
