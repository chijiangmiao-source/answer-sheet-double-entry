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

test.describe('双录核对台', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('两轮一致：提交后显示“通过”与 20/20', async ({ page }) => {
    await startRound(page, 1)
    await pressKeys(page, Array(20).fill('A'))
    await page.getByTestId('submit-round').click()

    // 第二轮为空白：无任何预填选择，焦点默认在第 1 题。
    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await expect(round2).toBeVisible()
    await expect(round2.locator('.option--selected')).toHaveCount(0)
    await expect(round2.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-1'
    )

    await round2.focus()
    await pressKeys(page, Array(20).fill('A'))
    await page.getByTestId('submit-round').click()

    await expect(page.getByTestId('verdict-text')).toHaveText('通过')
    await expect(page.getByTestId('verdict-score')).toHaveText('20/20')
    await expect(page.getByTestId('diffs')).toHaveCount(0)
  })

  test('两轮有差异：显示“不通过”，且仅列出差异题号与两轮选项', async ({ page }) => {
    await startRound(page, 1)
    await pressKeys(page, Array(20).fill('A'))
    await page.getByTestId('submit-round').click()

    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await round2.focus()
    // 第 3 题录 B，其余录 A。
    await pressKeys(page, ['A', 'A', 'B', ...Array(17).fill('A')])
    await page.getByTestId('submit-round').click()

    await expect(page.getByTestId('verdict-text')).toHaveText('不通过')
    await expect(page.getByTestId('verdict-score')).toHaveText('19/20')
    await expect(page.getByTestId('diffs')).toBeVisible()

    const rows = page.locator('[data-testid^="diff-"]')
    await expect(rows).toHaveCount(1)
    const row = page.getByTestId('diff-3')
    await expect(row).toBeVisible()
    await expect(row.locator('td')).toHaveText(['第 3 题', 'A', 'B'])
  })

  test('漏题不能提交并原位提示；用户可重新开始回到空白首录', async ({ page }) => {
    await startRound(page, 1)
    await pressKeys(page, Array(19).fill('A')) // 第 20 题故意漏答
    await page.getByTestId('submit-round').click()

    await expect(page.getByRole('region', { name: '第 1 轮录入' })).toBeVisible()
    await expect(page.getByTestId('missing-summary')).toContainText('第 20 题')
    await expect(page.getByTestId('question-20').getByTestId('missing-marker')).toBeVisible()

    // 补齐后完成两轮（制造一个差异进入结果页）。
    await page.keyboard.press('A')
    await page.getByTestId('submit-round').click()
    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await round2.focus()
    await pressKeys(page, ['B', ...Array(19).fill('A')])
    await page.getByTestId('submit-round').click()
    await expect(page.getByTestId('verdict-text')).toHaveText('不通过')

    // 主动重新开始：清除两轮状态，返回空白首录。
    await page.getByTestId('restart').click()
    const round1 = page.getByRole('region', { name: '第 1 轮录入' })
    await expect(round1).toBeVisible()
    await expect(round1.locator('.option--selected')).toHaveCount(0)
    await expect(round1.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-1'
    )
    await expect(page.getByTestId('missing-summary')).toHaveCount(0)
    await expect(page.getByTestId('result')).toHaveCount(0)
  })
})
