import { expect, test } from '@playwright/test'

/** 混合大小写与空格 / 逗号 / 换行分隔的 20 个选项（大写后为 ABCD 循环 5 次）。 */
const MIXED_TEXT = ['a B,c D', 'A b,C d', 'A B c,D', 'a B,C d', 'A,b c D'].join('\n')

test.describe('批量填入', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('两轮分别批量填入相同文本：通过 + 20/20', async ({ page }) => {
    // 第一轮：打开批量填入区，预览确认后一次性写入
    await page.getByTestId('batch-toggle').click()
    await page.getByTestId('batch-input').fill(MIXED_TEXT)
    await expect(page.getByTestId('batch-preview')).toBeVisible()
    await expect(page.getByTestId('batch-preview')).toContainText('20/20')
    await page.getByTestId('batch-apply').click()
    await expect(page.locator('.option--selected')).toHaveCount(20)
    await page.getByTestId('submit-round').click()

    // 第二轮：空白无预填，同样走批量填入
    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await expect(round2).toBeVisible()
    await expect(round2.locator('.option--selected')).toHaveCount(0)
    await expect(round2.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-1'
    )

    await page.getByTestId('batch-toggle').click()
    await page.getByTestId('batch-input').fill(MIXED_TEXT)
    await page.getByTestId('batch-apply').click()
    await expect(round2.locator('.option--selected')).toHaveCount(20)
    await page.getByTestId('submit-round').click()

    await expect(page.getByTestId('verdict-text')).toHaveText('通过')
    await expect(page.getByTestId('verdict-score')).toHaveText('20/20')
    await expect(page.getByTestId('diffs')).toHaveCount(0)
  })

  test('无效文本被拒绝后可继续用键盘补录，并完成不通过裁决', async ({ page }) => {
    // 第一轮：先尝试批量填入，含非法字符的文本被拒绝
    await page.getByTestId('batch-toggle').click()
    await page.getByTestId('batch-input').fill('A B C X D')
    await expect(page.getByTestId('batch-error')).toContainText('X')
    await expect(page.getByTestId('batch-apply')).toBeDisabled()
    await expect(page.locator('.option--selected')).toHaveCount(0)

    // 数量不足的文本同样被拒绝，答卡保持全空
    await page.getByTestId('batch-input').fill('A B C')
    await expect(page.getByTestId('batch-error')).toContainText('3')
    await expect(page.getByTestId('batch-apply')).toBeDisabled()
    await expect(page.locator('.option--selected')).toHaveCount(0)

    // 关闭批量填入区，改用原有键盘方式补录 20 题
    await page.getByTestId('batch-toggle').click()
    const round1 = page.getByRole('region', { name: '第 1 轮录入' })
    await round1.focus()
    for (let i = 0; i < 20; i++) await page.keyboard.press('A')
    await expect(round1.locator('.option--selected')).toHaveCount(20)
    await page.getByTestId('submit-round').click()

    // 第二轮：键盘录入，第 5 题录 B，其余录 A
    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await round2.focus()
    for (let i = 0; i < 20; i++) await page.keyboard.press(i === 4 ? 'B' : 'A')
    await page.getByTestId('submit-round').click()

    // 裁决：不通过 + 19/20，差异表只有第 5 题一行
    await expect(page.getByTestId('verdict-text')).toHaveText('不通过')
    await expect(page.getByTestId('verdict-score')).toHaveText('19/20')
    const rows = page.locator('[data-testid^="diff-"]')
    await expect(rows).toHaveCount(1)
    await expect(page.getByTestId('diff-5').locator('td')).toHaveText(['第 5 题', 'A', 'B'])
  })
})
