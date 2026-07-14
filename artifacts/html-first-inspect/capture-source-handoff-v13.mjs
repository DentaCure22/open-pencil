import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(
  '/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base/node_modules/.bun/playwright@1.58.2/node_modules/playwright'
)

const outputs = {
  ready:
    '/Users/omar/Documents/Open Pencil/artifacts/html-first-inspect/html-source-handoff-v13-ready.jpg',
  verified:
    '/Users/omar/Documents/Open Pencil/artifacts/html-first-inspect/html-source-handoff-v13-verified.jpg'
}
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { height: 720, width: 1280 } })
const byTestId = (id) => page.locator(`[data-test-id="${id}"]`)

try {
  await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'New live board' }).click()
  await page.getByRole('button', { name: 'Edit branch' }).click()

  const inspectModes = byTestId('html-board-mode-inspect')
  await inspectModes.nth(1).click()
  const draftFrame = page.frameLocator('iframe[data-html-board-id]').nth(1)
  await draftFrame.locator('[data-openpencil-slot="hero-actions"]').dispatchEvent('click')
  await byTestId('html-board-slot-component-select').selectOption('smylr-button-live')
  await byTestId('html-board-slot-add-selected').click()
  await byTestId('html-board-workflow-more').click()
  await byTestId('html-board-request-review').click()
  await byTestId('html-board-mark-preferred').click()
  await byTestId('html-board-source-verified').waitFor()

  await byTestId('html-board-mode-design').nth(1).click()
  await byTestId('html-board-fit-workflow').click()
  await byTestId('html-board-workflow-more').click()
  await page.waitForTimeout(1_000)

  await byTestId('html-board-create-change-set').click()
  await byTestId('html-board-approve-change-set').click()
  await byTestId('html-board-check-change-set').click()
  await byTestId('html-board-copy-implementation-request').waitFor()
  await page.waitForTimeout(600)
  await page.screenshot({ fullPage: false, path: outputs.ready, quality: 92, type: 'jpeg' })

  const proof = await page.evaluate(() => ({
    boardCount: document.querySelectorAll('iframe[data-html-board-id]').length,
    hasCopyImplementationRequest: Boolean(
      document.querySelector('[data-test-id="html-board-copy-implementation-request"]')
    ),
    hasVerifiedSource: Boolean(document.querySelector('[data-test-id="html-board-source-verified"]'))
  }))
  console.log(JSON.stringify({ outputs, proof }, null, 2))
} finally {
  await browser.close()
}
