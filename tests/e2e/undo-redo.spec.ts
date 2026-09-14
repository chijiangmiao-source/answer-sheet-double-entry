import { expect, test } from '@playwright/test'

async function focusRound(page: import('@playwright/test').Page, round: 1 | 2) {
  const panel = page.getByRole('region', { name: `第 ${round} 轮录入` })
  // 仅聚焦不点击：避免点击落在中间题目上改变默认焦点题。
  await panel.focus()
  return panel
}

async function pressKeys(page: import('@playwright/test').Page, keys: string[]) {
  for (const key of keys) await page.keyboard.press(key)
}

test.describe('撤销 / 重做', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('误选后用鼠标撤销、重做，再完成两轮：一致裁决通过 20/20', async ({ page }) => {
    const round1 = await focusRound(page, 1)
    const undo = page.getByTestId('undo')
    const redo = page.getByTestId('redo')
    await expect(undo).toBeDisabled()
    await expect(redo).toBeDisabled()

    // 第 1、2 题正常录 A，第 3 题误触 B
    await pressKeys(page, ['A', 'A', 'B'])
    await expect(round1.locator('[data-testid="q3-B"]')).toHaveClass(/option--selected/)
    await expect(undo).toBeEnabled()

    // 鼠标撤销：第 3 题还原为空，焦点回到第 3 题，重做可用
    await undo.click()
    await expect(round1.locator('[data-testid="q3-B"]')).not.toHaveClass(/option--selected/)
    await expect(round1.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-3'
    )
    await expect(redo).toBeEnabled()

    // 鼠标重做：B 恢复，焦点再次自动停到第 4 题（纸质卡核对后确认保留 B）
    await redo.click()
    await expect(round1.locator('[data-testid="q3-B"]')).toHaveClass(/option--selected/)
    await expect(round1.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-4'
    )

    // 鼠标点击后重新把键盘焦点放回录入区
    await round1.focus()
    // 第 4…19 题录 A（16 题），焦点到达第 20 题
    await pressKeys(page, Array(16).fill('A'))
    await expect(round1.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-20'
    )

    // 第 20 题误触 C（此前为空），改用快捷键撤销后重做，C 先清空再恢复
    await page.keyboard.press('C')
    await expect(round1.locator('[data-testid="q20-C"]')).toHaveClass(/option--selected/)
    await page.keyboard.press('Control+z')
    await expect(round1.locator('[data-testid="q20-C"]')).not.toHaveClass(/option--selected/)
    await expect(round1.locator('[data-testid="q20-A"]')).not.toHaveClass(/option--selected/)
    await page.keyboard.press('Control+Shift+Z')
    await expect(round1.locator('[data-testid="q20-C"]')).toHaveClass(/option--selected/)

    // 首录最终：A A B，第 4…19 题 A，第 20 题 C
    await page.getByTestId('submit-round').click()

    // 第二轮：新轨迹为空，撤销/重做均不可用
    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await expect(round2).toBeVisible()
    await expect(round2.getByTestId('undo')).toBeDisabled()
    await expect(round2.getByTestId('redo')).toBeDisabled()

    // 与首录逐题相同地录一遍
    await round2.focus()
    await pressKeys(page, ['A', 'A', 'B', ...Array(16).fill('A'), 'C'])
    await page.getByTestId('submit-round').click()

    await expect(page.getByTestId('verdict-text')).toHaveText('通过')
    await expect(page.getByTestId('verdict-score')).toHaveText('20/20')
    await expect(page.getByTestId('diffs')).toHaveCount(0)
  })

  test('撤销至漏题被原位拦截，补录后第二轮录成差异，仍按既有规则不通过', async ({ page }) => {
    const round1 = await focusRound(page, 1)
    await pressKeys(page, Array(20).fill('A'))

    // 连续撤销最近三题：第 18/19/20 题变回漏答，焦点逆序回到第 18 题
    await pressKeys(page, ['Control+z', 'Control+z', 'Control+z'])
    for (const n of [18, 19, 20]) {
      await expect(round1.locator(`[data-testid="q${n}-A"]`)).not.toHaveClass(
        /option--selected/
      )
    }
    await expect(round1.locator('[data-testid="q17-A"]')).toHaveClass(/option--selected/)
    await expect(round1.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-18'
    )

    // 漏题提交被拦截：顶部汇总 + 第 18/19/20 题原位反馈
    await page.getByTestId('submit-round').click()
    await expect(page.getByTestId('missing-summary')).toContainText('3')
    await expect(page.getByTestId('missing-summary')).toContainText('第 18、19、20 题')
    for (const n of [18, 19, 20]) {
      await expect(
        round1.locator(`[data-testid="question-${n}"] [data-testid="missing-marker"]`)
      ).toBeVisible()
    }

    // 补录三题（均为有效新选择，追加到轨迹），漏答反馈消失后提交
    await round1.focus()
    await pressKeys(page, ['A', 'A', 'A'])
    await expect(page.getByTestId('missing-summary')).toHaveCount(0)
    await page.getByTestId('submit-round').click()

    // 第二轮：空白起点且任何撤销都无法恢复/暴露首录快照
    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await expect(round2.locator('.option--selected')).toHaveCount(0)
    await expect(round2.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-1'
    )
    await round2.focus()
    await pressKeys(page, ['Control+z', 'Control+z', 'Control+Shift+Z'])
    await expect(round2.locator('.option--selected')).toHaveCount(0)
    await expect(round2.getByTestId('undo')).toBeDisabled()
    await expect(round2.getByTestId('redo')).toBeDisabled()

    // 第二轮第 10 题录 B，其余录 A
    await pressKeys(page, [...Array(9).fill('A'), 'B', ...Array(10).fill('A')])
    await page.getByTestId('submit-round').click()

    // 既有裁决规则不受撤销/补录影响：不通过 + 19/20，差异表只有第 10 题
    await expect(page.getByTestId('verdict-text')).toHaveText('不通过')
    await expect(page.getByTestId('verdict-score')).toHaveText('19/20')
    const rows = page.locator('[data-testid^="diff-"]')
    await expect(rows).toHaveCount(1)
    await expect(page.getByTestId('diff-10').locator('td')).toHaveText(['第 10 题', 'A', 'B'])
  })

  test('批量整卡覆盖后撤销恢复覆盖前答案；Ctrl/Cmd+字母不误填当前题', async ({ page }) => {
    const round1 = await focusRound(page, 1)

    // Ctrl / Cmd 与选项字母的组合是浏览器快捷键，不能当成作答
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+c')
    await expect(round1.locator('.option--selected')).toHaveCount(0)
    await expect(round1.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-1'
    )
    await expect(round1.getByTestId('undo')).toBeDisabled()

    // 覆盖前先录两题：第 1 题 A、第 2 题 B
    await pressKeys(page, ['A', 'B'])
    await expect(round1.locator('[data-testid="q2-B"]')).toHaveClass(/option--selected/)

    // 批量整卡写入 20 个 D
    await page.getByTestId('batch-toggle').click()
    await page.getByTestId('batch-input').fill(Array(20).fill('D').join(' '))
    await page.getByTestId('batch-apply').click()
    await expect(round1.locator('.option--selected')).toHaveCount(20)

    // 一次撤销恢复覆盖前整张答卡：1=A、2=B，其余 18 题空，焦点回第 3 题
    await round1.focus()
    await page.keyboard.press('Control+z')
    await expect(round1.locator('[data-testid="q1-A"]')).toHaveClass(/option--selected/)
    await expect(round1.locator('[data-testid="q2-B"]')).toHaveClass(/option--selected/)
    await expect(round1.locator('[data-testid="q1-D"]')).not.toHaveClass(/option--selected/)
    await expect(round1.locator('.option--selected')).toHaveCount(2)
    await expect(round1.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-3'
    )

    // 重做再次整体写入 20 个 D
    await page.keyboard.press('Control+Shift+Z')
    await expect(round1.locator('.option--selected')).toHaveCount(20)
    await expect(round1.locator('[data-testid="q1-D"]')).toHaveClass(/option--selected/)

    // 恢复后的答卡可正常提交进入第二轮
    await page.getByTestId('submit-round').click()
    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await expect(round2).toBeVisible()
    await expect(round2.locator('.option--selected')).toHaveCount(0)
  })
})
