import { expect, test, type Page } from '@playwright/test'

const LETTERS = ['A', 'B', 'C', 'D'] as const

/** 进入训练页并开始校准，返回训练区（已聚焦）。 */
async function startPractice(page: Page) {
  await page.getByTestId('practice-entry').click()
  const region = page.getByRole('region', { name: '键位校准' })
  await expect(region).toBeVisible()
  await page.getByTestId('practice-start').click()
  await expect(page.getByTestId('practice-step')).toHaveText('第 1 / 20 题')
  // 仅聚焦不点击：避免点击落在按钮上改变状态。
  await region.focus()
  return region
}

/** 当前页面展示的目标字母。 */
async function currentTarget(page: Page): Promise<string> {
  const text = await page.getByTestId('practice-target').textContent()
  return (text ?? '').trim()
}

/** 选一个与 target（及 avoid）不同的字母作为误按。 */
function wrongOf(target: string, avoid?: string): string {
  const found = LETTERS.find((l) => l !== target && l !== avoid)
  if (!found) throw new Error('无法选出误按字母')
  return found
}

/** 按一下页面当前目标字母。 */
async function pressTarget(page: Page) {
  await page.keyboard.press(await currentTarget(page))
}

test.describe('键位校准', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('全对完成：首次命中 20/20，无误按记录', async ({ page }) => {
    await startPractice(page)

    for (let step = 1; step <= 20; step++) {
      await expect(page.getByTestId('practice-step')).toHaveText(`第 ${step} / 20 题`)
      await pressTarget(page)
    }

    await expect(page.getByTestId('practice-done')).toBeVisible()
    await expect(page.getByTestId('practice-first-hits')).toHaveText('首次命中：20 / 20')
    await expect(page.getByTestId('practice-missteps')).toHaveText('误按题号：无')
    for (const letter of LETTERS) {
      await expect(page.getByTestId(`practice-miss-${letter}`)).toHaveText(`${letter}：0 次`)
    }
  })

  test('含误按后完成：统计首次命中数、误按题号与各字母误按次数', async ({ page }) => {
    await startPractice(page)

    // 第 1 题：连续误按两个不同错误字母（只记首次），再命中前进。
    const t1 = await currentTarget(page)
    const w1 = wrongOf(t1)
    await page.keyboard.press(w1)
    await page.keyboard.press(wrongOf(t1, w1))
    await page.keyboard.press(t1)
    await expect(page.getByTestId('practice-step')).toHaveText('第 2 / 20 题')

    // 第 2 题：误按一次（与第 1 题不同的错误字母）后命中。
    const t2 = await currentTarget(page)
    const w2 = wrongOf(t2, w1)
    await page.keyboard.press(w2)
    await page.keyboard.press(t2)

    // 其余 18 题一次命中。
    for (let step = 3; step <= 20; step++) {
      await expect(page.getByTestId('practice-step')).toHaveText(`第 ${step} / 20 题`)
      await pressTarget(page)
    }

    await expect(page.getByTestId('practice-first-hits')).toHaveText('首次命中：18 / 20')
    await expect(page.getByTestId('practice-missteps')).toHaveText('误按题号：第 1、2 题')
    await expect(page.getByTestId(`practice-miss-${w1}`)).toHaveText(`${w1}：1 次`)
    await expect(page.getByTestId(`practice-miss-${w2}`)).toHaveText(`${w2}：1 次`)
    // 误按总数恰为 2：同一题的重复误按未被重复计数。
    let total = 0
    for (const letter of LETTERS) {
      const text = await page.getByTestId(`practice-miss-${letter}`).textContent()
      total += Number((text ?? '').match(/(\d+) 次/)?.[1])
    }
    expect(total).toBe(2)
  })

  test('无效按键与浏览器自动重复不推进、不计数', async ({ page }) => {
    const region = await startPractice(page)

    // A-D 以外的按键与 Ctrl/Alt 组合键一律忽略。
    await page.keyboard.press('e')
    await page.keyboard.press('1')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Alt+b')
    // 浏览器自动重复（按住不放）不计数：直接派发 repeat=true 的按键事件。
    const target = await currentTarget(page)
    await region.dispatchEvent('keydown', { key: target, repeat: true })
    await expect(page.getByTestId('practice-step')).toHaveText('第 1 / 20 题')

    // 有效按键仍正常前进。
    await page.keyboard.press(target)
    await expect(page.getByTestId('practice-step')).toHaveText('第 2 / 20 题')

    // 被忽略的按键不污染统计：剩余全对完成后首次命中仍为 20/20。
    for (let step = 2; step <= 20; step++) await pressTarget(page)
    await expect(page.getByTestId('practice-first-hits')).toHaveText('首次命中：20 / 20')
    await expect(page.getByTestId('practice-missteps')).toHaveText('误按题号：无')
  })

  test('重新校准得到全新会话：进度与统计归零', async ({ page }) => {
    await startPractice(page)

    // 制造进度与一次误按：第 1 题误按后命中，第 2 题命中，来到第 3 题。
    const t1 = await currentTarget(page)
    await page.keyboard.press(wrongOf(t1))
    await page.keyboard.press(t1)
    await pressTarget(page)
    await expect(page.getByTestId('practice-step')).toHaveText('第 3 / 20 题')

    // 训练中重新校准：回到第 1 题的全新会话。
    await page.getByTestId('practice-restart').click()
    await expect(page.getByTestId('practice-step')).toHaveText('第 1 / 20 题')

    // 新会话统计干净：全程一次命中后首次命中 20/20，旧误按不带入。
    const region = page.getByRole('region', { name: '键位校准' })
    await region.focus()
    for (let step = 1; step <= 20; step++) await pressTarget(page)
    await expect(page.getByTestId('practice-first-hits')).toHaveText('首次命中：20 / 20')
    await expect(page.getByTestId('practice-missteps')).toHaveText('误按题号：无')

    // 完成页也可重新校准，再次得到全新会话。
    await page.getByTestId('practice-restart').click()
    await expect(page.getByTestId('practice-step')).toHaveText('第 1 / 20 题')
    await expect(page.getByTestId('practice-done')).toHaveCount(0)
  })

  test('校准与双录隔离：入口在首页，离开或刷新即丢弃，答卡不受污染', async ({ page }) => {
    // 首页默认仍是双录流程，校准入口在首页。
    await expect(page.getByRole('region', { name: '第 1 轮录入' })).toBeVisible()
    await page.getByTestId('practice-entry').click()
    await expect(page.getByRole('region', { name: '第 1 轮录入' })).toBeHidden()

    // 进行几步校准（含一次误按）。
    await page.getByTestId('practice-start').click()
    const region = page.getByRole('region', { name: '键位校准' })
    await region.focus()
    const t1 = await currentTarget(page)
    await page.keyboard.press(wrongOf(t1))
    await page.keyboard.press(t1)
    await expect(page.getByTestId('practice-step')).toHaveText('第 2 / 20 题')

    // 离开训练页：本次校准丢弃；答卡未被训练按键污染。
    await page.getByTestId('practice-exit').click()
    await expect(page.getByRole('region', { name: '第 1 轮录入' })).toBeVisible()
    await expect(page.locator('.option--selected')).toHaveCount(0)

    // 再次进入：从待开始页重新来过，上次进度不保留。
    await page.getByTestId('practice-entry').click()
    await expect(page.getByTestId('practice-idle')).toBeVisible()
    await expect(page.getByTestId('practice-step')).toHaveCount(0)

    // 刷新同样丢弃校准，回到双录首页。
    await page.getByTestId('practice-start').click()
    await expect(page.getByTestId('practice-step')).toHaveText('第 1 / 20 题')
    await page.reload()
    await expect(page.getByRole('region', { name: '第 1 轮录入' })).toBeVisible()
    await expect(page.getByRole('region', { name: '键位校准' })).toHaveCount(0)
  })
})
