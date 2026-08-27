import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_IDLE_UNLOAD_MS,
  resolveIdleUnloadGraceMs,
  resolveIdleUnloadMs,
  shouldUnloadIdleSession
} from '#mcp/pi/session-idle'

describe('session idle unload', () => {
  test('defaults to a short five-minute reuse window', () => {
    expect(resolveIdleUnloadMs({})).toBe(DEFAULT_IDLE_UNLOAD_MS)
    expect(DEFAULT_IDLE_UNLOAD_MS).toBe(5 * 60 * 1_000)
    expect(resolveIdleUnloadGraceMs({})).toBe(30_000)
  })

  test('honors env overrides', () => {
    expect(resolveIdleUnloadMs({ PI_SESSION_IDLE_UNLOAD_MS: '50' })).toBe(50)
    expect(resolveIdleUnloadGraceMs({ PI_SESSION_IDLE_UNLOAD_GRACE_MS: '10' })).toBe(10)
  })

  test('does not unload a running or never-settled session', () => {
    expect(
      shouldUnloadIdleSession({
        activeJobId: 'job-1',
        now: 100_000,
        settledAt: 0,
        unloadMs: 1_000
      })
    ).toBe(false)
    expect(
      shouldUnloadIdleSession({
        activeJobId: null,
        now: 100_000,
        settledAt: null,
        unloadMs: 1_000
      })
    ).toBe(false)
  })

  test('unloads after the idle window', () => {
    expect(
      shouldUnloadIdleSession({
        activeJobId: null,
        now: 21_000,
        settledAt: 1_000,
        unloadMs: 20_000
      })
    ).toBe(true)
  })
})
