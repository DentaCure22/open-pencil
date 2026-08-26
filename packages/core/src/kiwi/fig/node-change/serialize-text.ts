import type { NodeChange, Paint } from '@open-pencil/kiwi/fig/codec'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { bytesToHex } from '#core/bytes/hex'
import { encodePathCommandsBlob } from '#core/kiwi/fig/node-change/path-commands'
import { buildDerivedTextData as buildSharedDerivedTextData } from '#core/text/derived-text/data'
import { normalizeFontFamily, weightToFigmaStyle, weightToStyle } from '#core/text/fonts'
import { getGlyphOutlineMetricsSync } from '#core/text/opentype'

import type { KiwiNodeChange } from './export-node'
import { applyFontFeaturesToKiwi } from './font/features'
import { TEXT_DIRECTION_PLUGIN_KEY, upsertPluginData } from './plugin-data'
import { exportTextData, fontVariationToKiwi } from './text-data-export'

type SerializeTextNodeInput = {
  blobs: Uint8Array[]
  fillToKiwiPaint: (fill: SceneNode['fills'][number]) => Paint
  fontDigestMap?: Map<string, Uint8Array>
  glyphBlobMap?: Map<string, number>
  graph: SceneGraph
  node: SceneNode
  nodeChange: KiwiNodeChange
}

function textLines(text: string): NonNullable<NodeChange['textData']>['lines'] {
  const lineCount = Math.max(1, text.split('\n').length)
  return Array.from({ length: lineCount }, () => ({ lineType: 'PLAIN' }))
}

function appendGlyphBlob(
  blobs: Uint8Array[],
  glyphBlobMap: Map<string, number>,
  blob: Uint8Array
): number {
  const key = bytesToHex(blob)
  const existing = glyphBlobMap.get(key)
  if (existing !== undefined) return existing
  const index = blobs.push(blob) - 1
  glyphBlobMap.set(key, index)
  return index
}

function buildDerivedTextData(
  node: SceneNode,
  digestMap: Map<string, Uint8Array>,
  blobs: Uint8Array[],
  glyphBlobMap: Map<string, number>
): NodeChange['derivedTextData'] {
  const fontMeta: NonNullable<NodeChange['derivedTextData']>['fontMetaData'] = []
  const seen = new Set<string>()

  const addFont = (family: string, weight: number, italic: boolean) => {
    const style = weightToStyle(weight, italic)
    const normalized = normalizeFontFamily(family)
    const key = `${normalized}|${style}`
    if (seen.has(key)) return
    seen.add(key)
    fontMeta.push({
      key: { family: normalized, style: weightToFigmaStyle(weight, italic), postscript: '' },
      fontLineHeight: 1.2,
      fontDigest: digestMap.get(key),
      fontStyle: italic ? 'ITALIC' : 'NORMAL',
      fontWeight: weight
    })
  }

  addFont(node.fontFamily, node.fontWeight, node.italic)
  for (const run of node.styleRuns) {
    addFont(
      run.style.fontFamily ?? node.fontFamily,
      run.style.fontWeight ?? node.fontWeight,
      run.style.italic ?? node.italic
    )
  }

  const lineHeight = node.lineHeight ?? Math.ceil(node.fontSize * 1.2)
  const glyphAdvance = node.text.length > 0 ? node.width / Math.max(node.text.length, 1) : 0
  const derivedGlyphs = node.figmaDerivedTextGlyphs ?? []
  const glyphs =
    derivedGlyphs.length > 0
      ? derivedGlyphs.map((glyph, index) => ({
          commandsBlob: appendGlyphBlob(blobs, glyphBlobMap, glyph.commandsBlob),
          position: { x: glyph.x, y: glyph.y },
          fontSize: glyph.fontSize,
          firstCharacter: index,
          advance:
            index + 1 < derivedGlyphs.length
              ? Math.max(derivedGlyphs[index + 1].x - glyph.x, 0)
              : glyphAdvance,
          rotation: 0
        }))
      : (
          getGlyphOutlineMetricsSync(
            node.fontFamily,
            weightToStyle(node.fontWeight, node.italic),
            node.text,
            node.fontSize
          ) ?? []
        ).map((glyph, index) => ({
          commandsBlob: appendGlyphBlob(
            blobs,
            glyphBlobMap,
            encodePathCommandsBlob(glyph.commands, node.fontSize)
          ),
          position: { x: glyph.x || index * glyphAdvance, y: lineHeight },
          fontSize: node.fontSize,
          firstCharacter: index,
          advance: glyph.advance || glyphAdvance,
          rotation: 0
        }))

  const logicalIndexToCharacterOffsetMap = Array.from(
    { length: node.text.length + 1 },
    (_, index) => index * glyphAdvance
  )

  return buildSharedDerivedTextData({
    node,
    glyphs,
    fontMetaData: fontMeta,
    baseline: lineHeight,
    width: node.width,
    lineHeight,
    lineAscent: Math.max(lineHeight - node.fontSize * 0.2, 0),
    logicalIndexToCharacterOffsetMap
  })
}

function resolveTextAutoResize(node: SceneNode, graph: SceneGraph): SceneNode['textAutoResize'] {
  if (node.source.id) return node.textAutoResize
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  if (
    parent &&
    parent.layoutMode !== 'NONE' &&
    parent.layoutMode !== 'GRID' &&
    node.layoutPositioning !== 'ABSOLUTE'
  ) {
    return 'HEIGHT'
  }
  return node.textAutoResize
}

export function serializeTextNode({
  blobs,
  fillToKiwiPaint,
  fontDigestMap,
  glyphBlobMap,
  graph,
  node,
  nodeChange
}: SerializeTextNodeInput): void {
  upsertPluginData(node, TEXT_DIRECTION_PLUGIN_KEY, node.textDirection)
  nodeChange.fontSize = node.fontSize
  nodeChange.fontName = {
    family: normalizeFontFamily(node.fontFamily),
    style: weightToFigmaStyle(node.fontWeight, node.italic),
    postscript: ''
  }
  nodeChange.textData = exportTextData(node, textLines, fillToKiwiPaint)
  if (node.fontVariations.length > 0) {
    nodeChange.fontVariations = node.fontVariations.map(fontVariationToKiwi)
  }
  nodeChange.textAutoResize = resolveTextAutoResize(node, graph)
  nodeChange.textAlignHorizontal = node.textAlignHorizontal
  nodeChange.textAlignVertical = node.textAlignVertical
  nodeChange.textUserLayoutVersion = 4
  nodeChange.textExplicitLayoutVersion = 1
  nodeChange.textBidiVersion = 1
  nodeChange.textDecorationSkipInk = node.textDecorationSkipInk
  nodeChange.fontVariantCommonLigatures = true
  nodeChange.fontVariantContextualLigatures = true
  applyFontFeaturesToKiwi(nodeChange, node.fontFeatures)
  nodeChange.fontVersion = ''
  nodeChange.emojiImageSet = 'APPLE'
  if (node.textCase !== 'ORIGINAL') nodeChange.textCase = node.textCase
  if (fontDigestMap) {
    nodeChange.derivedTextData = buildDerivedTextData(
      node,
      fontDigestMap,
      blobs,
      glyphBlobMap ?? new Map()
    )
  }
  if (node.leadingTrim !== 'NONE') nodeChange.leadingTrim = node.leadingTrim
  if (node.lineHeight != null) {
    nodeChange.lineHeight = { value: node.lineHeight, units: 'PIXELS' }
  }
  nodeChange.letterSpacing = { value: node.letterSpacing, units: 'PIXELS' }
  if (node.textDecoration !== 'NONE') {
    nodeChange.textDecoration = node.textDecoration === 'UNDERLINE' ? 'UNDERLINE' : 'STRIKETHROUGH'
  }
  if (node.textDecorationStyle !== 'SOLID') {
    nodeChange.textDecorationStyle = node.textDecorationStyle
  }
  if (node.textDecorationThickness != null) {
    nodeChange.textDecorationThickness = {
      value: node.textDecorationThickness,
      units: 'PIXELS'
    }
  }
  if (node.textUnderlineOffset != null) {
    nodeChange.textUnderlineOffset = { value: node.textUnderlineOffset, units: 'PIXELS' }
  }
  if (node.textDecorationFills.length > 0) {
    nodeChange.textDecorationFillPaints = node.textDecorationFills.map(fillToKiwiPaint)
  }
}
