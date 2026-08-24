import { describe, expect, test } from 'bun:test'

import {
  hmrSocketUrlFor,
  isHmrRemountMessage,
  parseHmrSessionId,
  shouldReloadOnSessionChange,
  shouldReloadOnTransition
} from '@/app/smylr-live-inspector/dev-server-watchdog'

describe('Smylr dev server watchdog', () => {
  test('reloads live frames when the Turbopack session id changes', () => {
    expect(shouldReloadOnSessionChange(null, '1')).toBe(false)
    expect(shouldReloadOnSessionChange('1', '1')).toBe(false)
    expect(shouldReloadOnSessionChange('1', '2')).toBe(true)
    expect(parseHmrSessionId('{"type":"turbopack-connected","data":{"sessionId":99}}')).toBe('99')
    expect(parseHmrSessionId('{"type":"built"}')).toBeNull()
    expect(isHmrRemountMessage('{"type":"turbopack-message"}')).toBe(true)
    expect(isHmrRemountMessage('{"type":"serverComponentChanges"}')).toBe(true)
    expect(isHmrRemountMessage('{"type":"clientChanges"}')).toBe(true)
    expect(isHmrRemountMessage('{"type":"built"}')).toBe(false)
    expect(isHmrRemountMessage('{"type":"turbopack-connected"}')).toBe(false)
    expect(hmrSocketUrlFor('http://127.0.0.1:3000')).toBe('ws://127.0.0.1:3000/_next/hmr')
  })

  test('reloads live frames only when the server comes back after being down', () => {
    // Unknown baseline: never reload on the first observation.
    expect(shouldReloadOnTransition(null, true)).toBe(false)
    expect(shouldReloadOnTransition(null, false)).toBe(false)
    // Steady states: no reload.
    expect(shouldReloadOnTransition(true, true)).toBe(false)
    expect(shouldReloadOnTransition(false, false)).toBe(false)
    // Going down: no reload (the frame shows its unavailable state instead).
    expect(shouldReloadOnTransition(true, false)).toBe(false)
    // Restart edge: down -> up is the one moment stale frames must reload.
    expect(shouldReloadOnTransition(false, true)).toBe(true)
  })
})
