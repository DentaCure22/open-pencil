import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  botCharterForThread,
  botCharterKey,
  botCharterPath,
  ensureBotCharter
} from '#mcp/agent-router/bot-charter'
import { WorkMapStore } from '#mcp/agent-router/work-map'

describe('Bot charter files', () => {
  test('creates one private path-safe charter and preserves later Bot-owned edits', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-bot-charter-'))
    const botId = 'bot:../../Dental Chart/🦷'

    try {
      const charterPath = ensureBotCharter(root, {
        botId,
        directoryName: 'Dental Chart'
      })
      const expectedPath = path.join(root, 'bot-charters', botCharterKey(botId), 'AGENTS.md')
      const relativePath = path.relative(root, charterPath)

      expect(charterPath).toBe(expectedPath)
      expect(botCharterPath(root, botId)).toBe(expectedPath)
      expect(relativePath.startsWith('..')).toBe(false)
      expect(path.isAbsolute(relativePath)).toBe(false)
      expect(botCharterKey(botId)).toBe(
        '8729389291f3c7e34b45ba81b6b59546deb006b0844497ad3b9edc4610541632'
      )

      const generated = await readFile(charterPath, 'utf8')
      expect(generated).toContain(JSON.stringify(botId))
      expect(generated).toContain(JSON.stringify('Dental Chart'))
      expect(generated).toContain('capable person texting')
      expect(generated).toContain('delivery channels for this same Bot')
      if (process.platform !== 'win32') {
        expect((await stat(charterPath)).mode & 0o777).toBe(0o600)
      }

      await writeFile(charterPath, '# User-maintained charter\n')
      expect(
        ensureBotCharter(root, {
          botId,
          directoryName: 'Renamed directory'
        })
      ).toBe(charterPath)
      expect(await readFile(charterPath, 'utf8')).toBe('# User-maintained charter\n')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('resolves each exact Bot thread without falling back to the first Bot or an ordinary chat', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-bot-charter-thread-'))
    const workMap = new WorkMapStore()
    workMap.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Morning Email Check',
          op: 'create_project',
          project_id: 'project:email'
        },
        {
          bot_id: 'bot:email',
          op: 'create_bot',
          project_id: 'project:email',
          thread_id: 'thread:email'
        },
        {
          name: 'Dental Chart',
          op: 'create_project',
          project_id: 'project:dental'
        },
        {
          bot_id: 'bot:dental',
          op: 'create_bot',
          project_id: 'project:dental',
          thread_id: 'thread:bot'
        },
        {
          op: 'place_chat',
          project_id: 'project:dental',
          thread_id: 'thread:ordinary'
        }
      ]
    })

    try {
      const email = botCharterForThread(root, workMap.snapshot(), 'thread:email')
      const dental = botCharterForThread(root, workMap.snapshot(), 'thread:bot')

      expect(email).toEqual({
        botId: 'bot:email',
        path: botCharterPath(root, 'bot:email')
      })
      expect(dental).toEqual({
        botId: 'bot:dental',
        path: botCharterPath(root, 'bot:dental')
      })
      if (!email || !dental) throw new Error('Expected both Bot charters to resolve.')
      expect(email.path).not.toBe(dental.path)
      expect(await readFile(email.path, 'utf8')).toContain(
        'Its directory is "Morning Email Check".'
      )
      expect(await readFile(dental.path, 'utf8')).toContain('Its directory is "Dental Chart".')
      expect(botCharterForThread(root, workMap.snapshot(), 'thread:ordinary')).toBeNull()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
