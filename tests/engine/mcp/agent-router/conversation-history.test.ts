import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { isConversationThread, type AgentConversationThread } from '#mcp/agent-router/contracts'
import {
  conversationPersistSignature,
  conversationThreadBodiesDirectory,
  readAgentConversationHistory,
  writeAgentConversationHistory
} from '#mcp/agent-router/conversation-history'

function thread(
  id: string,
  recentUpdate: string,
  extra: Partial<AgentConversationThread> = {}
): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-23T12:00:00.000Z',
    effort: 'high',
    id,
    messages: [
      {
        createdAt: '2026-08-23T12:00:00.000Z',
        id: `${id}:user`,
        role: 'user',
        text: 'Do this.'
      },
      {
        createdAt: '2026-08-23T12:01:00.000Z',
        id: `${id}:assistant`,
        parts: [{ name: 'read', output: `tool output for ${id}`, state: 'success', type: 'tool' }],
        role: 'assistant',
        text: 'Done.'
      }
    ],
    model: 'xai-auth/grok-4.6',
    recentUpdate,
    sessionId: id,
    state: 'completed',
    task: 'Do this.',
    updatedAt: '2026-08-23T12:01:00.000Z',
    workerId: `worker:${id}`,
    ...extra
  }
}

describe('agent conversation history files', () => {
  test('rejects malformed persisted message parts before hydration', () => {
    const candidate = thread('invalid-parts', 'Invalid parts.')
    const assistant = candidate.messages[1]
    if (!assistant) throw new Error('Expected assistant fixture message.')

    expect(
      isConversationThread({
        ...candidate,
        messages: [{ ...assistant, parts: [null] }]
      })
    ).toBe(false)
  })

  test('changes the persistence signature when equal-length content changes', () => {
    const original = thread('signature', 'Done.')
    const changed = structuredClone(original)
    const part = changed.messages[1]?.parts?.[0]
    if (part?.type !== 'tool') throw new Error('Expected tool fixture part.')
    part.output = 'tool output for two'

    expect(part.output.length).toBe('tool output for one'.length)
    expect(conversationPersistSignature(changed)).not.toBe(conversationPersistSignature(original))
  })

  test('loads a legacy full-thread array and splits dirty bodies on write', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-conversation-history-'))
    const historyPath = path.join(root, 'pi-conversations.json')
    const first = thread('one', 'First done.')
    const second = thread('two', 'Second done.')
    await writeFile(historyPath, JSON.stringify([first, second]))

    try {
      const loaded = readAgentConversationHistory(historyPath)
      expect(loaded.map((item) => item.id)).toEqual(['one', 'two'])
      expect(loaded[0]?.messages[1]?.parts?.[0]).toMatchObject({ output: 'tool output for one' })

      const written = new Map<string, string>()
      writeAgentConversationHistory(historyPath, loaded, written)
      const index = JSON.parse(await readFile(historyPath, 'utf8')) as AgentConversationThread[]
      expect(index).toHaveLength(2)
      expect(JSON.stringify(index)).not.toContain('tool output for one')
      expect((await readdir(conversationThreadBodiesDirectory(historyPath))).sort()).toEqual([
        'one.json',
        'two.json'
      ])

      const firstSignature = written.get('one')
      second.recentUpdate = 'Second changed.'
      second.updatedAt = '2026-08-23T12:02:00.000Z'
      writeAgentConversationHistory(historyPath, [first, second], written)
      expect(written.get('one')).toBe(firstSignature)
      expect(JSON.parse(await readFile(historyPath, 'utf8'))[1]).toMatchObject({
        recentUpdate: 'Second changed.'
      })
      expect(readAgentConversationHistory(historyPath)[1]?.recentUpdate).toBe('Second changed.')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('drops a deleted thread body and keeps persist signatures stable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-conversation-history-delete-'))
    const historyPath = path.join(root, 'pi-conversations.json')
    const kept = thread('kept', 'Keep me.')
    const gone = thread('gone', 'Delete me.')
    const written = new Map<string, string>()

    try {
      writeAgentConversationHistory(historyPath, [kept, gone], written)
      writeAgentConversationHistory(historyPath, [kept], written)
      expect(await readdir(conversationThreadBodiesDirectory(historyPath))).toEqual(['kept.json'])
      expect(conversationPersistSignature(kept)).toBe(written.get('kept'))
      expect(JSON.parse(await readFile(historyPath, 'utf8'))).toHaveLength(1)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
