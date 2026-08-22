import { describe, expect, test } from 'bun:test'

import type { LocalWorkspaceThemeIntent } from '@/app/workspace-document/local-authority/client'
import { createLocalWorkspaceThemeConsumer } from '@/app/workspace-document/local-authority/theme'

function intent(overrides: Partial<LocalWorkspaceThemeIntent> = {}): LocalWorkspaceThemeIntent {
  return {
    consumedAt: null,
    createdAt: '2026-08-19T12:00:00.000Z',
    sequence: 1,
    theme: 'dark',
    updatedAt: '2026-08-19T12:00:00.000Z',
    version: 1,
    ...overrides
  }
}

describe('local workspace theme consumer', () => {
  test('applies an unconsumed theme and consumes it once', async () => {
    const applied: string[] = []
    const consumed: number[] = []
    const consumer = createLocalWorkspaceThemeConsumer({
      applyTheme: (theme) => {
        applied.push(theme)
      },
      consumeIntent: async (sequence) => {
        consumed.push(sequence)
        return true
      },
      readIntent: async () => intent()
    })

    await expect(consumer.applyPending()).resolves.toBe(true)
    expect(applied).toEqual(['dark'])
    expect(consumed).toEqual([1])
  })

  test('skips a consumed theme', async () => {
    let applyCalls = 0
    let consumeCalls = 0
    const consumer = createLocalWorkspaceThemeConsumer({
      applyTheme: () => {
        applyCalls += 1
      },
      consumeIntent: async () => {
        consumeCalls += 1
        return true
      },
      readIntent: async () => intent({ consumedAt: '2026-08-19T12:00:01.000Z' })
    })

    await expect(consumer.applyPending()).resolves.toBe(false)
    expect(applyCalls).toBe(0)
    expect(consumeCalls).toBe(0)
  })

  test('coalesces overlapping applies', async () => {
    let resolveRead: ((value: LocalWorkspaceThemeIntent) => void) | undefined
    let applyCalls = 0
    const consumer = createLocalWorkspaceThemeConsumer({
      applyTheme: () => {
        applyCalls += 1
      },
      consumeIntent: async () => true,
      readIntent: () =>
        new Promise<LocalWorkspaceThemeIntent>((resolve) => {
          resolveRead = resolve
        })
    })

    const first = consumer.applyPending()
    const second = consumer.applyPending()
    resolveRead?.(intent({ theme: 'light' }))
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(applyCalls).toBe(1)
  })
})
