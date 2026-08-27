import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { BotBackupService } from '#mcp/agent-router/bot-backup'
import { botCharterKey, ensureBotCharter } from '#mcp/agent-router/bot-charter'
import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import { WorkMapStore } from '#mcp/agent-router/work-map'

function botThread(): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-26T12:00:00.000Z',
    effort: 'medium',
    id: 'thread:daily',
    messages: [],
    model: 'test/model',
    recentUpdate: 'Ready.',
    sessionId: 'session-daily',
    state: 'completed',
    task: 'Daily reviewer',
    toolScope: 'general',
    updatedAt: '2026-08-26T12:00:00.000Z',
    workerId: 'worker-1'
  }
}

describe('Bot backup service', () => {
  test('creates one verified JSON snapshot per day and prunes old snapshots', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-bot-backup-'))
    const sessionDirectory = path.join(root, 'pi-sessions')
    const sessionFile = path.join(sessionDirectory, '2026-08-26T12-00-00-000Z_session-daily.jsonl')
    const charterSource = ensureBotCharter(root, {
      botId: 'bot:daily',
      directoryName: 'Daily reviewer'
    })
    const charterRelativePath = path.posix.join(
      'bot-charters',
      botCharterKey('bot:daily'),
      'AGENTS.md'
    )
    const workMap = new WorkMapStore()
    workMap.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          bot_id: 'bot:daily',
          op: 'create_bot',
          project_id: null,
          thread_id: 'thread:daily'
        },
        {
          bot_id: 'bot:daily',
          every_minutes: 1_440,
          next_run_at: '2026-08-27T12:00:00.000Z',
          op: 'create_routine',
          prompt: 'Review current work',
          routine_id: 'routine:daily'
        }
      ]
    })
    const service = new BotBackupService(
      root,
      workMap,
      {
        conversation: (threadId) => (threadId === 'thread:daily' ? botThread() : null)
      },
      {
        autoStart: false,
        retentionSnapshots: 2
      }
    )

    try {
      await mkdir(sessionDirectory, { recursive: true })
      await writeFile(sessionFile, '{"type":"session"}\n{"type":"message"}\n{"partial":')

      const first = service.snapshotIfDue(new Date('2026-08-26T18:00:00.000Z'))
      const duplicate = service.snapshotIfDue(new Date('2026-08-26T23:00:00.000Z'))
      service.snapshotIfDue(new Date('2026-08-27T18:00:00.000Z'))
      service.snapshotIfDue(new Date('2026-08-28T18:00:00.000Z'))

      expect(first?.date).toBe('2026-08-26')
      expect(duplicate).toBeNull()
      expect((await readdir(path.join(root, 'backups', 'bot-routine-history-v1'))).sort()).toEqual([
        '2026-08-27',
        '2026-08-28'
      ])

      const latest = path.join(root, 'backups', 'bot-routine-history-v1', '2026-08-28')
      const manifest = JSON.parse(await readFile(path.join(latest, 'manifest.json'), 'utf8'))
      const savedWorkMap = JSON.parse(await readFile(path.join(latest, 'work-map.json'), 'utf8'))
      const savedThread = JSON.parse(
        await readFile(path.join(latest, 'conversations', 'thread%3Adaily.json'), 'utf8')
      )
      const savedSession = await readFile(
        path.join(latest, 'sessions', path.basename(sessionFile)),
        'utf8'
      )
      const savedCharter = await readFile(path.join(latest, charterRelativePath), 'utf8')

      expect(manifest).toMatchObject({
        bots: [
          {
            botId: 'bot:daily',
            sessionId: 'session-daily',
            threadId: 'thread:daily'
          }
        ],
        contract: 'openpencil-bot-backup/v1',
        date: '2026-08-28',
        missing: []
      })
      expect(manifest.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'work-map.json',
            sha256: expect.any(String)
          }),
          expect.objectContaining({
            path: charterRelativePath,
            sha256: expect.any(String)
          }),
          expect.objectContaining({
            path: 'conversations/thread%3Adaily.json',
            sha256: expect.any(String)
          }),
          expect.objectContaining({
            path: `sessions/${path.basename(sessionFile)}`,
            sha256: expect.any(String)
          })
        ])
      )
      expect(savedWorkMap).toMatchObject({
        bots: [{ id: 'bot:daily' }],
        requests: [],
        routines: [{ id: 'routine:daily' }]
      })
      expect(savedThread).toMatchObject({
        id: 'thread:daily',
        sessionId: 'session-daily'
      })
      expect(savedSession).toBe('{"type":"session"}\n{"type":"message"}\n')
      expect(savedCharter).toBe(await readFile(charterSource, 'utf8'))
    } finally {
      service.close()
      await rm(root, { force: true, recursive: true })
    }
  })
})
