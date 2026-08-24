import type { Paragraph } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

export const PARAGRAPH_CACHE_BUDGET_BYTES = 64 * 1024 * 1024

export interface ParagraphCacheEntry {
  bytes: number
  nodeId: string
  paragraph: Paragraph
}

export interface ParagraphCacheOwner {
  buildParagraph(node: SceneNode, color?: Float32Array, opts?: { halfLeading?: boolean }): Paragraph
  paragraphCache: Map<string, ParagraphCacheEntry>
  paragraphCacheBytes: number
}

export interface ParagraphCacheHost {
  buildParagraph(node: SceneNode, color?: Float32Array, opts?: { halfLeading?: boolean }): Paragraph
  paragraphCache?: Map<string, ParagraphCacheEntry>
  paragraphCacheBytes?: number
}

export interface LiveParagraph {
  cached: boolean
  paragraph: Paragraph
}

export function estimateParagraphBytes(node: SceneNode): number {
  return (node.text?.length ?? 0) * 64 + 4096
}

function colorKey(color?: Float32Array): string {
  if (!color || color.length < 4) return 'default'
  return `${color[0]},${color[1]},${color[2]},${color[3]}`
}

function compactJson(value: unknown): string {
  return value == null || (Array.isArray(value) && value.length === 0) ? '' : JSON.stringify(value)
}

export function paragraphCacheKey(
  node: SceneNode,
  color?: Float32Array,
  halfLeading = false
): string {
  return [
    node.id,
    colorKey(color),
    halfLeading ? '1' : '0',
    node.text,
    node.width,
    node.height,
    node.fontSize,
    node.fontFamily,
    node.fontWeight,
    node.italic ? '1' : '0',
    node.letterSpacing,
    node.lineHeight,
    node.textAlignHorizontal,
    node.textDirection,
    node.textAutoResize,
    node.textTruncation,
    node.maxLines,
    node.leadingTrim,
    node.textDecoration,
    node.textDecorationStyle,
    node.textDecorationThickness,
    compactJson(node.styleRuns),
    compactJson(node.fontVariations),
    compactJson(node.fontFeatures),
    compactJson(node.textDecorationFills)
  ].join('\0')
}

function deleteParagraphCacheEntry(
  r: ParagraphCacheOwner,
  key: string,
  entry: ParagraphCacheEntry
): void {
  entry.paragraph.delete()
  r.paragraphCache.delete(key)
  r.paragraphCacheBytes = Math.max(0, r.paragraphCacheBytes - entry.bytes)
}

export function evictParagraphCache(r: ParagraphCacheOwner, incomingBytes: number): void {
  while (
    r.paragraphCacheBytes + incomingBytes > PARAGRAPH_CACHE_BUDGET_BYTES &&
    r.paragraphCache.size > 0
  ) {
    const oldest = r.paragraphCache.entries().next().value
    if (!oldest) break
    deleteParagraphCacheEntry(r, oldest[0], oldest[1])
  }
}

export function acquireCachedParagraph(
  r: ParagraphCacheOwner,
  node: SceneNode,
  color?: Float32Array,
  opts?: { halfLeading?: boolean }
): Paragraph {
  const key = paragraphCacheKey(node, color, opts?.halfLeading)
  const existing = r.paragraphCache.get(key)
  if (existing) {
    r.paragraphCache.delete(key)
    r.paragraphCache.set(key, existing)
    return existing.paragraph
  }
  const paragraph = r.buildParagraph(node, color, opts)
  const bytes = estimateParagraphBytes(node)
  evictParagraphCache(r, bytes)
  r.paragraphCache.set(key, { bytes, nodeId: node.id, paragraph })
  r.paragraphCacheBytes += bytes
  return paragraph
}

export function acquireLiveParagraph(
  r: ParagraphCacheHost,
  node: SceneNode,
  color?: Float32Array,
  opts?: { halfLeading?: boolean }
): LiveParagraph {
  if (r.paragraphCache) {
    if (typeof r.paragraphCacheBytes !== 'number') r.paragraphCacheBytes = 0
    return {
      cached: true,
      paragraph: acquireCachedParagraph(r as ParagraphCacheOwner, node, color, opts)
    }
  }
  return { cached: false, paragraph: r.buildParagraph(node, color, opts) }
}

export function releaseLiveParagraph(live: LiveParagraph): void {
  if (!live.cached) live.paragraph.delete()
}

export function invalidateParagraphCache(r: ParagraphCacheOwner, nodeId?: string): void {
  if (nodeId === undefined) {
    for (const [key, entry] of r.paragraphCache) {
      entry.paragraph.delete()
      r.paragraphCache.delete(key)
    }
    r.paragraphCacheBytes = 0
    return
  }
  for (const [key, entry] of r.paragraphCache) {
    if (entry.nodeId === nodeId) deleteParagraphCacheEntry(r, key, entry)
  }
}
