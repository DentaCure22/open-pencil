import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import { ConversationMediaStore } from '#mcp/pi/conversation-media'
import { PiRouterState } from '#mcp/pi/router-state'

function imageThread(url: string): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-21T00:00:00.000Z',
    effort: 'high',
    id: 'thread-1',
    messages: [
      {
        createdAt: '2026-08-21T00:00:00.000Z',
        id: 'assistant-1',
        parts: [
          { alt: 'Image', type: 'image', url },
          {
            images: [{ alt: 'Tool image', url }],
            name: 'imagegen',
            state: 'success',
            type: 'tool'
          }
        ],
        role: 'assistant',
        text: ''
      }
    ],
    model: 'xai-auth/grok-4.6',
    recentUpdate: 'Done',
    sessionId: 'session-1',
    state: 'completed',
    task: 'Generate an image',
    updatedAt: '2026-08-21T00:00:00.000Z',
    workerId: 'worker-1'
  }
}

describe('Pi conversation media storage', () => {
  test('stores repeated image data once and hydrates it for chat clients', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-conversation-media-'))
    const historyPath = path.join(root, 'pi-conversations.json')
    const dataUrl = `data:image/png;base64,${Buffer.from('small-png').toString('base64')}`
    const thread = imageThread(dataUrl)
    const store = new ConversationMediaStore(historyPath)

    try {
      expect(store.externalize(thread)).toBe(true)
      expect(JSON.stringify(thread)).not.toContain('data:image/png;base64')
      expect(await readdir(path.join(root, 'pi-conversations-media'))).toHaveLength(1)

      const hydrated = store.materialize(thread)
      expect(hydrated.messages[0]?.parts?.[0]).toMatchObject({ url: dataUrl })
      expect(hydrated.messages[0]?.parts?.[1]).toMatchObject({
        images: [{ url: dataUrl }]
      })
      expect(JSON.stringify(thread)).not.toContain('data:image/png;base64')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('removes stored media after no conversation references it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-conversation-media-prune-'))
    const historyPath = path.join(root, 'pi-conversations.json')
    const videoPath = path.join(root, 'generated.webm')
    await writeFile(videoPath, Buffer.from('orphaned-webm'))
    const thread = imageThread('not-an-image')
    const tool = thread.messages[0]?.parts?.[1]
    if (tool?.type !== 'tool') throw new Error('Expected tool part')
    tool.images = undefined
    tool.videos = [{ mimeType: 'video/webm', name: 'generated.webm', url: videoPath }]
    const store = new ConversationMediaStore(historyPath)

    try {
      expect(await store.externalizeVideos(thread)).toBe(true)
      expect(await readdir(path.join(root, 'pi-conversations-media'))).toHaveLength(1)
      tool.videos = []
      expect(await store.prune([thread])).toBe(1)
      expect(await readdir(path.join(root, 'pi-conversations-media'))).toHaveLength(0)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('stores local videos once and hydrates them as protected media URLs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-conversation-video-'))
    const historyPath = path.join(root, 'pi-conversations.json')
    const videoPath = path.join(root, 'generated.webm')
    await writeFile(videoPath, Buffer.from('small-webm'))
    const thread = imageThread('not-an-image')
    const tool = thread.messages[0]?.parts?.[1]
    if (tool?.type !== 'tool') throw new Error('Expected tool part')
    tool.images = undefined
    tool.name = 'ima2-media_generate_video'
    tool.videos = [{ mimeType: 'video/webm', name: 'generated.webm', url: videoPath }]
    const store = new ConversationMediaStore(historyPath)

    try {
      expect(await store.externalizeVideos(thread)).toBe(true)
      expect(JSON.stringify(thread)).not.toContain(videoPath)
      expect(await readdir(path.join(root, 'pi-conversations-media'))).toHaveLength(1)

      const hydrated = store.materialize(thread)
      const hydratedTool = hydrated.messages[0]?.parts?.[1]
      expect(hydratedTool).toMatchObject({
        videos: [
          {
            mimeType: 'video/webm',
            name: 'generated.webm',
            url: expect.stringMatching(/^\/agent-router\/v1\/pi\/media\/[a-f0-9]{64}\.webm$/)
          }
        ]
      })
      expect(JSON.stringify(hydratedTool)).not.toContain('base64')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('migrates legacy inline images and batches non-terminal history writes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-conversation-history-'))
    const historyPath = path.join(root, 'pi-conversations.json')
    const dataUrl = `data:image/png;base64,${Buffer.from('legacy-image').toString('base64')}`
    await writeFile(historyPath, JSON.stringify([imageThread(dataUrl)]))
    const state = new PiRouterState(historyPath)

    try {
      expect(await readFile(historyPath, 'utf8')).not.toContain('data:image/png;base64')
      expect(state.conversation('thread-1')?.messages[0]?.parts?.[0]).toMatchObject({
        url: dataUrl
      })

      const target = state.threads[0]
      expect(target).toBeDefined()
      if (!target) throw new Error('Expected the persisted Pi thread.')
      target.recentUpdate = 'Batched update'
      state.schedulePersist()
      expect(await readFile(historyPath, 'utf8')).not.toContain('Batched update')
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 150)
      })
      expect(await readFile(historyPath, 'utf8')).toContain('Batched update')
    } finally {
      state.close()
      await rm(root, { force: true, recursive: true })
    }
  })
})
