import process from 'node:process'

import { defineConfig } from '@playwright/test'

const DEFAULT_E2E_PORT = 1420

function e2ePort(): number {
  const value = process.env.OPENPENCIL_E2E_PORT
  if (!value) return DEFAULT_E2E_PORT

  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`OPENPENCIL_E2E_PORT must be an integer from 1 to 65535; received "${value}"`)
  }
  return port
}

const port = e2ePort()
const baseURL = `http://127.0.0.1:${port}`
const reuseExistingServer = process.env.OPENPENCIL_E2E_REUSE_SERVER === '1'

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  workers: 1,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.3
    },
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.3
    }
  },
  use: {
    baseURL,
    testIdAttribute: 'data-test-id',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    launchOptions: {
      args: ['--enable-unsafe-swiftshader']
    }
  },
  projects: [
    {
      name: 'openpencil',
      testDir: './tests/e2e',
      fullyParallel: false
    },
    {
      name: 'openpencil-webkit',
      testDir: './tests/e2e',
      testMatch: [
        '**/*.webkit.spec.ts',
        '**/design/panel.spec.ts',
        '**/export/basic.spec.ts',
        '**/fonts/settings.spec.ts'
      ],
      use: {
        browserName: 'webkit'
      }
    },
    {
      name: 'figma',
      testDir: './tests/figma'
    }
  ],
  webServer: {
    command: `OPENPENCIL_DISABLE_LOCAL_AUTOMATION=1 OPENPENCIL_E2E_PREFLIGHT=1 OPENPENCIL_VITE_PORT=${port} bun run test:serve`,
    name: `OpenPencil ${port}`,
    reuseExistingServer,
    url: baseURL
  }
})
