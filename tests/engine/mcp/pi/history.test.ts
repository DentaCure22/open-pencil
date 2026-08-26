import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import { PiAgentRouter } from '#mcp/pi/router'

type LegacyDispatcherThread = AgentConversationThread & {
  nativeConversationId: string
  originThreadId: null
  routingKey: string
}

function legacyDispatcherThread(): LegacyDispatcherThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-21T12:00:00.000Z',
    effort: 'high',
    id: 'legacy-dispatcher-thread',
    messages: [
      {
        createdAt: '2026-08-21T12:00:00.000Z',
        id: 'legacy-user',
        role: 'user',
        text: 'Route this task.'
      },
      {
        completedAt: '2026-08-21T12:01:00.000Z',
        createdAt: '2026-08-21T12:01:00.000Z',
        id: 'legacy-assistant',
        role: 'assistant',
        text: 'Done.'
      }
    ],
    model: 'xai-auth/grok-4.6',
    nativeConversationId: 'legacy-session',
    originThreadId: null,
    recentUpdate: 'Done.',
    routingKey: 'workspace:document:target',
    sessionId: 'legacy-session',
    state: 'completed',
    task: 'Route this task.',
    updatedAt: '2026-08-21T12:01:00.000Z',
    workerId: 'dispatcher'
  }
}

describe('PiAgentRouter legacy history', () => {
  test('keeps a dispatcher-labelled thread until it is explicitly deleted', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-pi-history-'))
    const historyPath = path.join(root, 'history.json')
    await writeFile(historyPath, JSON.stringify([legacyDispatcherThread()]))
    const router = new PiAgentRouter({
      executable: '/usr/bin/true',
      historyPath,
      warmPoolSize: 0,
      workspaceRoot: process.cwd()
    })

    try {
      expect(router.conversation('legacy-dispatcher-thread')).toMatchObject({
        id: 'legacy-dispatcher-thread',
        workerId: 'dispatcher'
      })
      expect(JSON.parse(await readFile(historyPath, 'utf8'))).toHaveLength(1)

      expect(router.delete('legacy-dispatcher-thread')).toBe(true)
      expect(router.conversation('legacy-dispatcher-thread')).toBeNull()
      expect(JSON.parse(await readFile(historyPath, 'utf8'))).toEqual([])
    } finally {
      router.close()
      await rm(root, { force: true, recursive: true })
    }
  })
})
