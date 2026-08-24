import { describe, expect, mock, test } from 'bun:test'

import type { SceneNode } from '@open-pencil/scene-graph'

import {
  PARAGRAPH_CACHE_BUDGET_BYTES,
  acquireCachedParagraph,
  acquireLiveParagraph,
  estimateParagraphBytes,
  evictParagraphCache,
  invalidateParagraphCache,
  paragraphCacheKey,
  releaseLiveParagraph,
  type ParagraphCacheOwner
} from '#core/canvas/paragraph-cache'

function textNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: 'text-1',
    type: 'TEXT',
    text: 'Hello',
    width: 120,
    height: 24,
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    italic: false,
    letterSpacing: 0,
    lineHeight: null,
    textAlignHorizontal: 'LEFT',
    textDirection: 'AUTO',
    textAutoResize: 'NONE',
    textTruncation: 'DISABLED',
    leadingTrim: 'NONE',
    textDecoration: 'NONE',
    styleRuns: [],
    fontVariations: [],
    fontFeatures: [],
    ...overrides
  } as SceneNode
}

function createOwner(build: ReturnType<typeof mock>): ParagraphCacheOwner {
  return {
    buildParagraph: build,
    paragraphCache: new Map(),
    paragraphCacheBytes: 0
  }
}

describe('paragraph cache', () => {
  test('reuses one paragraph across identical draws and rebuilds when text changes', () => {
    const first = { delete: mock() }
    const second = { delete: mock() }
    const build = mock((node: SceneNode) => (node.text === 'Hello' ? first : second))
    const owner = createOwner(build)
    const node = textNode()

    const reused = acquireCachedParagraph(owner, node)
    expect(acquireCachedParagraph(owner, node)).toBe(reused)
    expect(build).toHaveBeenCalledTimes(1)
    expect(first.delete).not.toHaveBeenCalled()

    const rebuilt = acquireCachedParagraph(owner, textNode({ text: 'Changed' }))
    expect(rebuilt).toBe(second)
    expect(build).toHaveBeenCalledTimes(2)
    expect(first.delete).not.toHaveBeenCalled()
  })

  test('evicts the oldest paragraph before inserting when the byte budget is full', () => {
    const oldest = { delete: mock() }
    const newest = { delete: mock() }
    const build = mock((node: SceneNode) => (node.id === 'old' ? oldest : newest))
    const owner = createOwner(build)
    const oldNode = textNode({ id: 'old', text: 'a' })
    acquireCachedParagraph(owner, oldNode)
    const cached = owner.paragraphCache.values().next().value
    if (!cached) throw new Error('expected a cached paragraph')
    cached.bytes = PARAGRAPH_CACHE_BUDGET_BYTES
    owner.paragraphCacheBytes = PARAGRAPH_CACHE_BUDGET_BYTES

    acquireCachedParagraph(owner, textNode({ id: 'new', text: 'b' }))

    expect(oldest.delete).toHaveBeenCalledTimes(1)
    expect(newest.delete).not.toHaveBeenCalled()
    expect(owner.paragraphCache.size).toBe(1)
    expect(owner.paragraphCacheBytes).toBe(
      estimateParagraphBytes(textNode({ id: 'new', text: 'b' }))
    )
  })

  test('full invalidation deletes every cached paragraph', () => {
    const first = { delete: mock() }
    const second = { delete: mock() }
    const build = mock((node: SceneNode) => (node.id === 'a' ? first : second))
    const owner = createOwner(build)
    acquireCachedParagraph(owner, textNode({ id: 'a' }))
    acquireCachedParagraph(owner, textNode({ id: 'b' }))

    invalidateParagraphCache(owner)

    expect(first.delete).toHaveBeenCalledTimes(1)
    expect(second.delete).toHaveBeenCalledTimes(1)
    expect(owner.paragraphCache.size).toBe(0)
    expect(owner.paragraphCacheBytes).toBe(0)
  })

  test('node invalidation deletes only that node’s cached paragraphs', () => {
    const keep = { delete: mock() }
    const drop = { delete: mock() }
    const build = mock((node: SceneNode) => (node.id === 'keep' ? keep : drop))
    const owner = createOwner(build)
    acquireCachedParagraph(owner, textNode({ id: 'keep' }))
    acquireCachedParagraph(owner, textNode({ id: 'drop' }))

    invalidateParagraphCache(owner, 'drop')

    expect(drop.delete).toHaveBeenCalledTimes(1)
    expect(keep.delete).not.toHaveBeenCalled()
    expect([...owner.paragraphCache.values()].map((entry) => entry.nodeId)).toEqual(['keep'])
  })

  test('mock render hosts still delete one-shot paragraphs', () => {
    const paragraph = { delete: mock() }
    const live = acquireLiveParagraph({ buildParagraph: mock(() => paragraph) }, textNode())

    expect(live.cached).toBe(false)
    releaseLiveParagraph(live)
    expect(paragraph.delete).toHaveBeenCalledTimes(1)
  })

  test('layout signature includes color and width so fills and resize miss the cache', () => {
    const node = textNode()
    expect(paragraphCacheKey(node, new Float32Array([0, 0, 0, 1]))).not.toBe(
      paragraphCacheKey(node, new Float32Array([1, 0, 0, 1]))
    )
    expect(paragraphCacheKey(node)).not.toBe(paragraphCacheKey(textNode({ width: 240 })))
  })

  test('evict helper is a no-op when the incoming entry already fits', () => {
    const paragraph = { delete: mock() }
    const owner = createOwner(mock(() => paragraph))
    acquireCachedParagraph(owner, textNode())
    evictParagraphCache(owner, 1)
    expect(paragraph.delete).not.toHaveBeenCalled()
    expect(owner.paragraphCache.size).toBe(1)
  })

  test('live text drawing reuses cached paragraphs instead of deleting every paint', async () => {
    const scene = await Bun.file('packages/core/src/canvas/scene.ts').text()
    expect(scene).toContain('acquireLiveParagraph')
    expect(scene).toContain('releaseLiveParagraph')
    expect(scene).not.toContain('paragraph.delete()')
  })
})
