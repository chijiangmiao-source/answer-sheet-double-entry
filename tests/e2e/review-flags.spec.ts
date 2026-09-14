import { expect, test } from '@playwright/test'

async function startRound(page: import('@playwright/test').Page, round: 1 | 2) {
  const panel = page.getByRole('region', { name: `第 ${round} 轮录入` })
  // 仅聚焦不点击：避免点击落在中间题目上改变默认焦点题。
  await panel.focus()
  return panel
}

async function pressKeys(page: import('@playwright/test').Page, keys: string[]) {
  for (const key of keys) await page.keyboard.press(key)
}

async function expectNoReviewMarks(panel: import('@playwright/test').Locator) {
  await expect(panel.locator('.review--on')).toHaveCount(0)
  await expect(panel.locator('[data-testid^="review-"]')).toHaveCount(20)
  for (let n = 1; n <= 20; n++) {
    await expect(panel.getByTestId(`review-${n}`)).toHaveAttribute('aria-pressed', 'false')
  }
}

test.describe('待复核标记', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('两轮标记不同且仅一处答案差异：只在该差异行显示对应轮次的提示', async ({ page }) => {
    // 首录：20 题全 A，标记第 3 题（差异题）与第 8 题（答案一致题）。
    await startRound(page, 1)
    await page.getByTestId('review-3').click()
    await page.getByTestId('review-8').click()
    await pressKeys(page, Array(20).fill('A'))
    await page.getByTestId('submit-round').click()

    // 第二轮从空答案、空标记开始：首录标记不能泄露。
    const round2 = page.getByRole('region', { name: `第 2 轮录入` })
    await expect(round2).toBeVisible()
    await expect(round2.locator('.option--selected')).toHaveCount(0)
    await expectNoReviewMarks(round2)

    // 复录：第 3 题录 B（唯一差异），其余 A；只标记第 8 题（与首录标的第 3 题不同）。
    await round2.focus()
    await page.getByTestId('review-8').click()
    await pressKeys(page, ['A', 'A', 'B', ...Array(17).fill('A')])
    await page.getByTestId('submit-round').click()

    await expect(page.getByTestId('verdict-text')).toHaveText('不通过')
    await expect(page.getByTestId('verdict-score')).toHaveText('19/20')

    // 差异表只有第 3 题一行（行本身是 tr；格内提示 span 不计入行数）。
    const rows = page.locator('tr[data-testid^="diff-"]')
    await expect(rows).toHaveCount(1)
    const row3 = page.getByTestId('diff-3')
    await expect(row3.locator('td')).toHaveCount(3)
    await expect(row3.locator('td').nth(0)).toHaveText('第 3 题')
    // 首录格：选项 A 与“首录待复核”提示同格；复录格只有选项 B。
    await expect(row3.locator('td').nth(1)).toHaveText(/^A\s*首录待复核$/)
    await expect(row3.locator('td').nth(2)).toHaveText('B')

    // 只显示首录的待复核提示；第 8 题答案一致不出差异行，其标记不在结果页出现。
    await expect(page.getByTestId('diff-3-first-review')).toBeVisible()
    await expect(page.getByTestId('diff-3-second-review')).toHaveCount(0)
    await expect(page.locator('[data-testid$="-review"]')).toHaveCount(1)
    await expect(page.getByTestId('diff-8')).toHaveCount(0)
  })

  test('两轮都标记同一差异题时差异行显示两个轮次提示', async ({ page }) => {
    await startRound(page, 1)
    await page.getByTestId('review-5').click()
    await pressKeys(page, Array(20).fill('A'))
    await page.getByTestId('submit-round').click()

    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await expectNoReviewMarks(round2)
    await round2.focus()
    await page.getByTestId('review-5').click()
    await pressKeys(page, [...Array(4).fill('A'), 'C', ...Array(15).fill('A')])
    await page.getByTestId('submit-round').click()

    const row5 = page.getByTestId('diff-5')
    await expect(row5).toBeVisible()
    await expect(row5.getByTestId('diff-5-first-review')).toHaveText('首录待复核')
    await expect(row5.getByTestId('diff-5-second-review')).toHaveText('第二遍待复核')
    await expect(page.locator('[data-testid$="-review"]')).toHaveCount(2)
  })

  test('漏答被拦截后原位错误与标记保留，补齐提交；第二轮无标记泄露；重新开始清空', async ({
    page
  }) => {
    await startRound(page, 1)
    await pressKeys(page, Array(19).fill('A')) // 第 20 题故意漏答
    await page.getByTestId('review-2').click()
    await page.getByTestId('review-20').click() // 漏答题同样可以标记
    await page.getByTestId('submit-round').click()

    // 被拦截：漏答原位提示与两个标记都保留。
    await expect(page.getByRole('region', { name: '第 1 轮录入' })).toBeVisible()
    await expect(page.getByTestId('missing-summary')).toContainText('第 20 题')
    await expect(page.getByTestId('question-20').getByTestId('missing-marker')).toBeVisible()
    await expect(page.getByTestId('review-2')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('review-20')).toHaveAttribute('aria-pressed', 'true')

    // 补齐第 20 题后提交，进入第二轮。
    await page.keyboard.press('A')
    await page.getByTestId('submit-round').click()

    // 第二轮：空答案、空标记，首录标记无泄露。
    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await expect(round2).toBeVisible()
    await expect(round2.locator('.option--selected')).toHaveCount(0)
    await expectNoReviewMarks(round2)

    // 复录答案逐题一致（不标记）：通过页不出现差异表与任何待复核提示。
    await round2.focus()
    await pressKeys(page, Array(20).fill('A'))
    await page.getByTestId('submit-round').click()
    await expect(page.getByTestId('verdict-text')).toHaveText('通过')
    await expect(page.getByTestId('diffs')).toHaveCount(0)
    await expect(page.locator('[data-testid$="-review"]')).toHaveCount(0)

    // 重新开始：清空答案、标记、漏答反馈与结果，回到空白首录。
    await page.getByTestId('restart').click()
    const round1 = page.getByRole('region', { name: '第 1 轮录入' })
    await expect(round1).toBeVisible()
    await expect(round1.locator('.option--selected')).toHaveCount(0)
    await expectNoReviewMarks(round1)
    await expect(page.getByTestId('missing-summary')).toHaveCount(0)
    await expect(page.getByTestId('result')).toHaveCount(0)
  })
})
