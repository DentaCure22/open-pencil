import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const GENERIC_HARNESS_FILES = [
  'events.ts',
  'media-recovery.ts',
  'provider-usage.ts',
  'reasoning-history.ts',
  'router-config.ts',
  'router-state.ts',
  'router.ts',
  'telemetry.ts',
  'title-generator.ts',
  'worker-mcp.ts'
] as const

describe('Pi provider boundary', () => {
  test('keeps vendor protocol and model policy out of the generic harness', () => {
    for (const name of GENERIC_HARNESS_FILES) {
      const source = readFileSync(path.resolve('packages/mcp/src/pi', name), 'utf8')
      expect(source, name).not.toMatch(/antigravity|xai|openai-codex|gemini|grok|\bagy\b/i)
      expect(source, name).not.toMatch(/cursor\/|['"]cursor['"]/i)
      expect(source, name).not.toMatch(/providers\/(?:antigravity|xai)/i)
    }
  })
})
