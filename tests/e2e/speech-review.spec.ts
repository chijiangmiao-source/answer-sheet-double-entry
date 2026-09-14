import { expect, test, type Page } from '@playwright/test'

/**
 * 在页面脚本执行前替换 Web Speech API：
 * Chromium 在无头环境可能没有可用语音，这里装一个确定性桩，
 * 记录每条交给引擎的核读文本与 cancel 次数，并异步结束每条播报。
 */
async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __speechLog: string[]
      __speechCancels: number
    }
    w.__speechLog = []
    w.__speechCancels = 0

    class FakeUtterance {
      text: string
      lang = ''
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    }

    const fakeSynthesis = {
      speak: (utterance: FakeUtterance) => {
        w.__speechLog.push(utterance.text)
        // 微任务中正常结束，驱动应用侧播报队列继续读下一条。
        queueMicrotask(() => utterance.onend?.())
      },
      cancel: () => {
        w.__speechCancels += 1
      },
      getVoices: () => []
    }

    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance })
    Object.defineProperty(window, 'speechSynthesis', { value: fakeSynthesis })
  })
}

async function speechLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __speechLog: string[] }).__speechLog)
}

async function speechCancels(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __speechCancels: number }).__speechCancels)
}

async function focusRound(page: Page, round: 1 | 2) {
  const panel = page.getByRole('region', { name: `第 ${round} 轮录入` })
  await panel.focus()
  return panel
}

async function pressKeys(page: Page, keys: string[]) {
  for (const key of keys) await page.keyboard.press(key)
}

async function enableSpeech(page: Page) {
  await page.getByTestId('speech-toggle').click()
  await expect(page.getByTestId('speech-toggle')).toHaveAttribute('aria-pressed', 'true')
}

test.describe('语音核读', () => {
  test.beforeEach(async ({ page }) => {
    await stubSpeech(page)
    await page.goto('/')
  })

  test('开启后逐题录入两轮：每次有效选择播报，裁决仍为通过 20/20', async ({ page }) => {
    await enableSpeech(page)
    await focusRound(page, 1)

    await pressKeys(page, Array(20).fill('A'))
    const logAfterFirst = await speechLog(page)
    expect(logAfterFirst).toHaveLength(20)
    expect(logAfterFirst[0]).toBe('第 1 题，所选 A')
    expect(logAfterFirst[19]).toBe('第 20 题，所选 A')

    await page.getByTestId('submit-round').click()

    // 轮次切换本身不产生任何播报；取消旧轮尚未播放的内容。
    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await expect(round2).toBeVisible()
    expect(await speechLog(page)).toHaveLength(20)
    expect(await speechCancels(page)).toBeGreaterThan(0)

    // 用户开关跨轮保持开启；第二轮仍为空白答卡。
    await expect(round2.getByTestId('speech-toggle')).toHaveAttribute('aria-pressed', 'true')
    await expect(round2.locator('.option--selected')).toHaveCount(0)

    await round2.focus()
    await pressKeys(page, Array(20).fill('A'))
    expect(await speechLog(page)).toHaveLength(40)
    await page.getByTestId('submit-round').click()

    await expect(page.getByTestId('verdict-text')).toHaveText('通过')
    await expect(page.getByTestId('verdict-score')).toHaveText('20/20')
    await expect(page.getByTestId('diffs')).toHaveCount(0)
  })

  test('撤销重做、批量整卡写入、焦点移动、忽略按键与轮次切换均不额外播报，键盘操作照常', async ({
    page
  }) => {
    await enableSpeech(page)
    const round1 = await focusRound(page, 1)

    // 三次有效单题选择 → 恰好三条播报
    await pressKeys(page, ['A', 'A', 'B'])
    const spoken3 = await speechLog(page)
    expect(spoken3).toEqual(['第 1 题，所选 A', '第 2 题，所选 A', '第 3 题，所选 B'])
    // 焦点已随作答到第 4 题
    await expect(round1.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-4'
    )

    // 焦点移动与被忽略按键静默，且键盘行为保持可用
    await pressKeys(page, ['ArrowDown', 'ArrowUp', 'x', '1'])
    await expect(round1.locator('.question--current')).toHaveAttribute(
      'data-testid',
      'question-4'
    )

    // 撤销 / 重做（快捷键）只改答案不留语音
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect(round1.locator('[data-testid="q2-A"]')).not.toHaveClass(/option--selected/)
    await page.keyboard.press('Control+Shift+Z')
    await page.keyboard.press('Control+Shift+Z')
    await expect(round1.locator('[data-testid="q3-B"]')).toHaveClass(/option--selected/)
    expect(await speechLog(page)).toEqual(spoken3)

    // 批量整卡写入 20 个 D：答卡被整体覆盖，但不产生任何播报
    await page.getByTestId('batch-toggle').click()
    await page.getByTestId('batch-input').fill(Array(20).fill('D').join(' '))
    await page.getByTestId('batch-apply').click()
    await expect(round1.locator('.option--selected')).toHaveCount(20)
    expect(await speechLog(page)).toEqual(spoken3)

    // 批量后的单题有效选择仍正常核读（第 1 题 D 改 A，直接鼠标点选）
    await page.getByTestId('q1-A').click()
    expect(await speechLog(page)).toEqual([...spoken3, '第 1 题，所选 A'])

    await page.getByTestId('submit-round').click()

    // 第二轮：开关保持、空白起点；切换瞬间无新增播报，撤销快捷键依旧可用
    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await expect(round2).toBeVisible()
    expect(await speechLog(page)).toHaveLength(4)
    await expect(round2.getByTestId('speech-toggle')).toHaveAttribute('aria-pressed', 'true')
    await round2.focus()
    await page.keyboard.press('Control+z')
    await expect(round2.locator('.option--selected')).toHaveCount(0)

    // 第二轮录成与首录一致（第 1 题 A，其余 D），裁决通过
    await pressKeys(page, ['A', ...Array(19).fill('D')])
    await page.getByTestId('submit-round').click()
    await expect(page.getByTestId('verdict-text')).toHaveText('通过')
    await expect(page.getByTestId('verdict-score')).toHaveText('20/20')
  })

  test('关闭核读立即取消语音，关闭期间录入静默且不影响提交', async ({ page }) => {
    await enableSpeech(page)
    await focusRound(page, 1)
    await pressKeys(page, ['A', 'B'])
    expect(await speechLog(page)).toHaveLength(2)
    const cancelsBefore = await speechCancels(page)

    await page.getByTestId('speech-toggle').click()
    await expect(page.getByTestId('speech-toggle')).toHaveAttribute('aria-pressed', 'false')
    expect(await speechCancels(page)).toBeGreaterThan(cancelsBefore)

    await focusRound(page, 1)
    await pressKeys(page, Array(18).fill('C'))
    expect(await speechLog(page)).toHaveLength(2) // 关闭期间静默
    await expect(page.locator('[data-testid="q20-C"]')).toHaveClass(/option--selected/)
    await page.getByTestId('submit-round').click()

    const round2 = page.getByRole('region', { name: '第 2 轮录入' })
    await expect(round2).toBeVisible()
    // 偏好被持久化为关闭：第二轮入口仍是关闭状态
    await expect(round2.getByTestId('speech-toggle')).toHaveAttribute('aria-pressed', 'false')
  })
})
