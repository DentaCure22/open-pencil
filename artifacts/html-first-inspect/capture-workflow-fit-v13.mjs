import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(
  '/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base/node_modules/.bun/playwright@1.58.2/node_modules/playwright'
)

const output =
  '/Users/omar/Documents/Open Pencil/artifacts/html-first-inspect/html-workflow-fit-v13-settled.jpg'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { height: 720, width: 1280 } })

try {
  await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'New live board' }).click()
  await page.locator('iframe[data-html-board-id]').waitFor()
  await page.getByRole('button', { name: 'Edit branch' }).click()
  await page.locator('iframe[data-html-board-id]').nth(1).waitFor()
  await page.getByRole('button', { name: 'Layers' }).click()
  await page.getByRole('treeitem', { exact: true, name: 'HTML Board' }).click()
  await page.getByRole('button', { name: 'Next state' }).click()
  await page.locator('iframe[data-html-board-id]').nth(2).waitFor()
  await page.getByRole('button', { name: 'Layers' }).click()
  await page.getByRole('button', { name: 'Fit flow' }).click()
  await page.waitForTimeout(1_500)

  const framing = await page.evaluate(() => {
    const panels = {
      left: document.querySelector('[data-test-id="layers-panel"]'),
      right: document.querySelector('[data-test-id="properties-panel"]')
    }
    const boardRects = [...document.querySelectorAll('iframe[data-html-board-id]')]
      .map((frame) => frame.getBoundingClientRect())
      .map((rect) => ({ bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top }))
    return {
      boardRects,
      leftPanelRight: panels.left?.getBoundingClientRect().right ?? 0,
      rightPanelLeft: panels.right?.getBoundingClientRect().left ?? innerWidth
    }
  })
  if (framing.boardRects.length !== 3) throw new Error('Expected three HTML boards')
  if (framing.boardRects.some((rect) => rect.left <= framing.leftPanelRight)) {
    throw new Error('A board is hidden under the left panel')
  }
  if (framing.boardRects.some((rect) => rect.right >= framing.rightPanelLeft)) {
    throw new Error('A board is hidden under the right panel')
  }

  await page.screenshot({ fullPage: false, path: output, quality: 92, type: 'jpeg' })
  console.log(JSON.stringify({ framing, output }, null, 2))
} finally {
  await browser.close()
}
