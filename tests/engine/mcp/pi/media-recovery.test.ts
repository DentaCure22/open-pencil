import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import { recoverDurableMediaResults } from '#mcp/pi/media-recovery'

function thread(): AgentConversationThread {
  return {
    canFollowUp: false,
    createdAt: '2026-08-21T12:00:00.000Z',
    effort: 'high',
    id: 'thread-image',
    messages: [
      {
        createdAt: '2026-08-21T12:00:01.000Z',
        id: 'user-image',
        role: 'user',
        text: 'Make a clean toolbar'
      },
      {
        createdAt: '2026-08-21T12:00:02.000Z',
        id: 'tool-image',
        parts: [
          {
            input:
              '{"Arguments":{"prompt":"A clean toolbar"},"ToolName":"ima2-media_generate_image"}',
            name: 'ima2-media_generate_image',
            output: '{"jobId":"job-image","status":"running"}',
            state: 'stopped',
            type: 'tool'
          }
        ],
        role: 'assistant',
        text: ''
      }
    ],
    model: 'xai/grok-4.6',
    recentUpdate: 'Image generation stopped.',
    sessionId: null,
    state: 'needs_attention',
    task: 'Make an image',
    updatedAt: '2026-08-21T12:00:02.000Z',
    workerId: 'worker-1'
  }
}

describe('Pi durable media recovery', () => {
  test('attaches a result that completed after the agent turn stopped', () => {
    const jobDirectory = mkdtempSync(join(tmpdir(), 'openpencil-image-recovery-'))
    const next = thread()
    writeFileSync(
      join(jobDirectory, 'completed.json'),
      JSON.stringify({
        createdAt: '2026-08-21T12:00:03.000Z',
        finishedAt: '2026-08-21T12:00:05.000Z',
        jobId: 'job-image',
        prompt: 'A clean toolbar',
        result: { images: [{ path: resolve('packages/demos/videos/toolbar.png') }] },
        status: 'completed'
      })
    )

    try {
      expect(recoverDurableMediaResults(next, jobDirectory)).toBe(true)
      expect(next.messages.at(-1)?.completedAt).toBe('2026-08-21T12:00:05.000Z')
      expect(next.messages.at(-1)?.parts?.[0]).toMatchObject({
        images: [
          { alt: 'Generated image', url: expect.stringContaining('data:image/png;base64,') }
        ],
        state: 'success',
        type: 'tool'
      })
      expect(recoverDurableMediaResults(next, jobDirectory)).toBe(false)
    } finally {
      rmSync(jobDirectory, { force: true, recursive: true })
    }
  })

  test('attaches an edited image returned as a singular result path', () => {
    const jobDirectory = mkdtempSync(join(tmpdir(), 'openpencil-image-edit-recovery-'))
    const next = thread()
    const tool = next.messages.at(-1)?.parts?.[0]
    if (tool?.type !== 'tool') throw new Error('Expected image tool')
    tool.name = 'ima2-media_edit_image'
    tool.input = '{"Arguments":{"prompt":"Turn one eye green"},"ToolName":"ima2-media_edit_image"}'
    tool.output = '{"jobId":"job-image-edit","status":"running"}'
    writeFileSync(
      join(jobDirectory, 'completed-edit.json'),
      JSON.stringify({
        createdAt: '2026-08-21T12:00:03.000Z',
        finishedAt: '2026-08-21T12:00:05.000Z',
        jobId: 'job-image-edit',
        prompt: 'Turn one eye green',
        result: { ok: true, path: resolve('packages/demos/videos/toolbar.png') },
        status: 'completed'
      })
    )

    try {
      expect(recoverDurableMediaResults(next, jobDirectory)).toBe(true)
      expect(tool).toMatchObject({
        images: [
          { alt: 'Generated image', url: expect.stringContaining('data:image/png;base64,') }
        ],
        state: 'success'
      })
    } finally {
      rmSync(jobDirectory, { force: true, recursive: true })
    }
  })

  test('attaches a generated video path without embedding the clip', () => {
    const jobDirectory = mkdtempSync(join(tmpdir(), 'openpencil-video-recovery-'))
    const next = thread()
    const tool = next.messages.at(-1)?.parts?.[0]
    if (tool?.type !== 'tool') throw new Error('Expected media tool')
    tool.name = 'ima2-media_generate_video'
    tool.input =
      '{"Arguments":{"prompt":"A clean toolbar in motion"},"ToolName":"ima2-media_generate_video"}'
    tool.output = '{"jobId":"job-video","status":"running"}'
    writeFileSync(
      join(jobDirectory, 'completed-video.json'),
      JSON.stringify({
        createdAt: '2026-08-21T12:00:03.000Z',
        finishedAt: '2026-08-21T12:00:05.000Z',
        jobId: 'job-video',
        kind: 'generate_video',
        prompt: 'A clean toolbar in motion',
        result: { ok: true, path: resolve('packages/demos/videos/toolbar.webm') },
        status: 'completed'
      })
    )

    try {
      expect(recoverDurableMediaResults(next, jobDirectory)).toBe(true)
      expect(next.messages.at(-1)?.completedAt).toBe('2026-08-21T12:00:05.000Z')
      expect(tool).toMatchObject({
        state: 'success',
        videos: [
          {
            mimeType: 'video/webm',
            name: 'toolbar.webm',
            url: resolve('packages/demos/videos/toolbar.webm')
          }
        ]
      })
      expect(JSON.stringify(tool)).not.toContain('base64')
      expect(recoverDurableMediaResults(next, jobDirectory)).toBe(false)
    } finally {
      rmSync(jobDirectory, { force: true, recursive: true })
    }
  })

  test('does not guess between repeated prompts from different conversations', () => {
    const jobDirectory = mkdtempSync(join(tmpdir(), 'openpencil-ambiguous-media-recovery-'))
    const first = thread()
    const second = thread()
    second.id = 'thread-image-2'
    second.messages = structuredClone(first.messages)
    const secondToolMessage = second.messages[1]
    if (!secondToolMessage) throw new Error('Expected second media message')
    second.messages[1] = {
      ...secondToolMessage,
      createdAt: '2026-08-21T12:00:12.000Z',
      id: 'tool-image-2'
    }
    for (const candidate of [first, second]) {
      const part = candidate.messages[1]?.parts?.[0]
      if (part?.type === 'tool') part.output = undefined
    }
    for (const [id, createdAt] of [
      ['job-first', '2026-08-21T12:00:03.000Z'],
      ['job-second', '2026-08-21T12:00:13.000Z']
    ] as const) {
      writeFileSync(
        join(jobDirectory, `${id}.json`),
        JSON.stringify({
          createdAt,
          finishedAt: createdAt,
          jobId: id,
          prompt: 'A clean toolbar',
          result: { images: [{ path: resolve('packages/demos/videos/toolbar.png') }] },
          status: 'completed'
        })
      )
    }

    try {
      expect(recoverDurableMediaResults([first, second], jobDirectory)).toBe(false)
      for (const candidate of [first, second]) {
        const part = candidate.messages[1]?.parts?.[0]
        expect(part?.type === 'tool' ? part.images : undefined).toBeUndefined()
      }
    } finally {
      rmSync(jobDirectory, { force: true, recursive: true })
    }
  })

  test('uses an exact durable job id when repeated prompts are otherwise ambiguous', () => {
    const jobDirectory = mkdtempSync(join(tmpdir(), 'openpencil-exact-media-recovery-'))
    const first = thread()
    const second = thread()
    second.id = 'thread-image-2'
    second.messages = structuredClone(first.messages)
    const secondToolMessage = second.messages[1]
    if (!secondToolMessage) throw new Error('Expected second media message')
    second.messages[1] = { ...secondToolMessage, id: 'tool-image-2' }
    const firstPart = first.messages[1]?.parts?.[0]
    const secondPart = second.messages[1]?.parts?.[0]
    if (firstPart?.type !== 'tool' || secondPart?.type !== 'tool') {
      throw new Error('Expected media tools')
    }
    firstPart.output = JSON.stringify({ jobId: 'job-first', status: 'running' })
    secondPart.output = JSON.stringify({ jobId: 'job-second', status: 'running' })
    for (const id of ['job-first', 'job-second'] as const) {
      writeFileSync(
        join(jobDirectory, `${id}.json`),
        JSON.stringify({
          createdAt: '2026-08-21T12:00:03.000Z',
          finishedAt: '2026-08-21T12:00:05.000Z',
          jobId: id,
          prompt: 'A clean toolbar',
          result: { images: [{ path: resolve('packages/demos/videos/toolbar.png') }] },
          status: 'completed'
        })
      )
    }

    try {
      expect(recoverDurableMediaResults([first, second], jobDirectory)).toBe(true)
      expect(firstPart.output).toContain('job-first')
      expect(secondPart.output).toContain('job-second')
      expect(firstPart.state).toBe('success')
      expect(secondPart.state).toBe('success')
    } finally {
      rmSync(jobDirectory, { force: true, recursive: true })
    }
  })

  test('recovers each exact job independently inside one repeated-prompt conversation', () => {
    const jobDirectory = mkdtempSync(join(tmpdir(), 'openpencil-repeated-media-recovery-'))
    const next = thread()
    const firstPart = next.messages[1]?.parts?.[0]
    if (firstPart?.type !== 'tool') throw new Error('Expected first media tool')
    firstPart.images = [{ alt: 'Generated image', url: 'data:image/png;base64,existing' }]
    const secondPart = structuredClone(firstPart)
    secondPart.images = undefined
    secondPart.output = JSON.stringify({ jobId: 'job-second', status: 'running' })
    next.messages.push({
      createdAt: '2026-08-21T12:00:04.000Z',
      id: 'tool-image-2',
      parts: [secondPart],
      role: 'assistant',
      text: ''
    })
    writeFileSync(
      join(jobDirectory, 'job-second.json'),
      JSON.stringify({
        createdAt: '2026-08-21T12:00:03.000Z',
        finishedAt: '2026-08-21T12:00:05.000Z',
        jobId: 'job-second',
        prompt: 'A clean toolbar',
        result: { images: [{ path: resolve('packages/demos/videos/toolbar.png') }] },
        status: 'completed'
      })
    )

    try {
      expect(recoverDurableMediaResults(next, jobDirectory)).toBe(true)
      expect(firstPart.output).toContain('job-image')
      expect(secondPart.output).toContain('job-second')
      expect(secondPart.images?.[0]?.url).toContain('data:image/png;base64,')
    } finally {
      rmSync(jobDirectory, { force: true, recursive: true })
    }
  })
})
