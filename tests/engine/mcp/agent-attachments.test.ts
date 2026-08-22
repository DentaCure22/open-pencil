import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Hono } from 'hono'

import {
  isVisionImage,
  resolveAgentAttachmentImagePaths,
  resolveAgentConversationAttachments
} from '#mcp/agent-attachments/paths'
import {
  agentAttachmentLimitError,
  registerAgentAttachmentRoutes
} from '#mcp/agent-attachments/routes'
import { AgentAttachmentStore } from '#mcp/agent-attachments/store'
import {
  isVideoAttachment,
  parseVideoDuration,
  videoContactSheetPlan
} from '#mcp/agent-attachments/video'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('agent attachments', () => {
  test('recognizes model-readable images and video containers', () => {
    expect(isVisionImage('capture.png')).toBeTrue()
    expect(isVisionImage('capture', 'image/webp')).toBeTrue()
    expect(isVisionImage('vector.svg', 'image/svg+xml')).toBeFalse()
    expect(isVideoAttachment('walkthrough.MOV', '')).toBeTrue()
    expect(isVideoAttachment('capture', 'video/mp4')).toBeTrue()
    expect(isVideoAttachment('notes.md', 'text/markdown')).toBeFalse()
  })

  test('parses duration and builds a bounded uniform contact-sheet plan', () => {
    expect(parseVideoDuration('Duration: 01:02:03.50, start: 0.000000')).toBe(3_723.5)
    expect(parseVideoDuration('Duration: N/A')).toBeNull()
    expect(videoContactSheetPlan(1)).toEqual({
      columns: 4,
      fps: 4,
      frameCount: 4,
      intervalSeconds: 0.25,
      rows: 1
    })
    expect(videoContactSheetPlan(9.05)).toMatchObject({
      columns: 5,
      frameCount: 19,
      rows: 4
    })
    expect(videoContactSheetPlan(600)).toMatchObject({
      columns: 5,
      frameCount: 20,
      rows: 4
    })
  })

  test('only accepts vision paths created inside the attachment store', () => {
    const authorityRoot = path.join(tmpdir(), 'openpencil-authority')
    const inside = path.join(authorityRoot, 'agent-attachments', 'filmstrip.jpg')
    const outside = path.join(tmpdir(), 'outside.png')
    expect(
      resolveAgentAttachmentImagePaths(authorityRoot, [inside, outside, inside, 42, '../bad.png'])
    ).toEqual([inside])
  })

  test('builds durable conversation parts only from stored attachments', async () => {
    const authorityRoot = await mkdtemp(path.join(tmpdir(), 'openpencil-agent-parts-'))
    roots.push(authorityRoot)
    const attachmentRoot = path.join(authorityRoot, 'agent-attachments')
    await mkdir(attachmentRoot, { recursive: true })
    const imagePath = path.join(attachmentRoot, 'reference.png')
    const videoPath = path.join(attachmentRoot, 'walkthrough.mov')
    const outsidePath = path.join(authorityRoot, 'outside.txt')
    const linkedOutsidePath = path.join(attachmentRoot, 'linked-outside.txt')
    await writeFile(imagePath, Buffer.from('png bytes'))
    await writeFile(videoPath, Buffer.from('video bytes'))
    await writeFile(outsidePath, Buffer.from('outside'))
    await symlink(outsidePath, linkedOutsidePath)

    const parts = await resolveAgentConversationAttachments(authorityRoot, [
      { name: 'reference.png', path: imagePath, type: 'image/png' },
      { name: 'walkthrough.mov', path: videoPath, type: 'video/quicktime' },
      { name: 'outside.txt', path: outsidePath, type: 'text/plain' },
      { name: 'linked-outside.txt', path: linkedOutsidePath, type: 'text/plain' }
    ])

    expect(parts).toEqual([
      {
        alt: 'reference.png',
        type: 'image',
        url: `data:image/png;base64,${Buffer.from('png bytes').toString('base64')}`
      },
      {
        mediaType: 'video/quicktime',
        name: 'walkthrough.mov',
        size: 11,
        type: 'attachment'
      }
    ])
  })

  test('accepts useful video sizes while bounding each file and the whole batch', () => {
    expect(agentAttachmentLimitError([])).toBe('Attach between one and five files.')
    expect(agentAttachmentLimitError(Array.from({ length: 6 }, () => ({ size: 1 })))).toBe(
      'Attach between one and five files.'
    )
    expect(agentAttachmentLimitError([{ size: 20 * 1024 * 1024 + 1 }])).toBeNull()
    expect(agentAttachmentLimitError([{ size: 100 * 1024 * 1024 + 1 }])).toBe(
      'Each attachment must be 100 MB or smaller.'
    )
    expect(
      agentAttachmentLimitError([
        { size: 90 * 1024 * 1024 },
        { size: 90 * 1024 * 1024 },
        { size: 90 * 1024 * 1024 }
      ])
    ).toBe('Attachments must be 250 MB or smaller in total.')
  })

  test('persists arbitrary file types with sanitized paths', async () => {
    const authorityRoot = await mkdtemp(path.join(tmpdir(), 'openpencil-agent-attachments-'))
    roots.push(authorityRoot)
    const app = new Hono()
    const store = new AgentAttachmentStore(authorityRoot)
    registerAgentAttachmentRoutes(app, {
      authorityRoot,
      getAuthToken: () => 'local-token',
      store
    })
    const data = new FormData()
    data.append('files', new File(['video bytes'], '../walk through.mp4', { type: 'video/mp4' }))
    data.append('files', new File(['export const ready = true'], 'index.ts'))

    const response = await app.request('/agent-router/v1/attachments', {
      body: data,
      headers: { Authorization: 'Bearer local-token' },
      method: 'POST'
    })

    expect(response.status).toBe(201)
    const payload = (await response.json()) as {
      attachments: Array<{ name: string; path: string; size: number; type: string }>
    }
    expect(payload.attachments).toHaveLength(2)
    const videoAttachment = payload.attachments[0]
    const scriptAttachment = payload.attachments[1]
    expect(videoAttachment).toMatchObject({
      name: 'walk through.mp4',
      size: 11,
      type: 'video/mp4'
    })
    expect(path.dirname(path.dirname(videoAttachment.path))).toBe(
      path.join(authorityRoot, 'agent-attachments')
    )
    expect(path.basename(videoAttachment.path)).not.toContain(' ')
    expect(await readFile(videoAttachment.path, 'utf8')).toBe('video bytes')
    expect(await readFile(scriptAttachment.path, 'utf8')).toBe('export const ready = true')

    await store.claim('thread-1', payload.attachments)
    await store.releaseThread('thread-1')
    expect(await readFile(videoAttachment.path, 'utf8').catch(() => null)).toBeNull()
  })

  test('expires abandoned upload batches without touching claimed conversation files', async () => {
    const authorityRoot = await mkdtemp(path.join(tmpdir(), 'openpencil-agent-leases-'))
    roots.push(authorityRoot)
    const store = new AgentAttachmentStore(authorityRoot)
    const expired = await store.createBatchDirectory('2026-08-20T00:00:00.000Z')
    const claimed = await store.createBatchDirectory('2026-08-20T00:00:00.000Z')
    const expiredFile = path.join(expired, 'expired.txt')
    const claimedFile = path.join(claimed, 'claimed.txt')
    await writeFile(expiredFile, 'expired')
    await writeFile(claimedFile, 'claimed')
    await store.claim('thread-1', [claimedFile])

    expect(await store.prunePending(Date.parse('2026-08-22T00:00:00.000Z'))).toBe(1)
    expect(await readFile(expiredFile, 'utf8').catch(() => null)).toBeNull()
    expect(await readFile(claimedFile, 'utf8')).toBe('claimed')
    expect(await store.reconcile([], Date.parse('2026-08-22T00:00:00.000Z'))).toBe(1)
    expect(await readFile(claimedFile, 'utf8').catch(() => null)).toBeNull()
  })
})
