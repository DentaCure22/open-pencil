import { describe, expect, test } from 'bun:test'

import { resolveBunExecutable } from '@/app/automation/bridge/vite-plugin'

describe('OpenPencil automation Vite plugin', () => {
  test('reuses the Bun executable that launched the package script', () => {
    expect(
      resolveBunExecutable({
        npm_execpath: '/Users/tester/.bun/bin/bun',
        PATH: '/usr/bin:/bin'
      })
    ).toBe('/Users/tester/.bun/bin/bun')
  })

  test('supports an explicit Bun executable override', () => {
    expect(
      resolveBunExecutable({
        npm_execpath: '/usr/local/bin/npm',
        OPENPENCIL_BUN_EXECUTABLE: '/opt/bun/bin/bun'
      })
    ).toBe('/opt/bun/bin/bun')
  })

  test('falls back to PATH for non-Bun package managers', () => {
    expect(resolveBunExecutable({ npm_execpath: '/usr/local/bin/npm' })).toBe('bun')
  })
})
