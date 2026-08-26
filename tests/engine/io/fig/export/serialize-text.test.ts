import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { serializeTextNode } from '#core/kiwi/fig/node-change/serialize-text'

const unexpectedPaint = () => {
  throw new Error('This text fixture should not serialize a paint')
}

describe('Figma text serialization', () => {
  test('uses height auto-resize for new auto-layout text but preserves imported sizing', () => {
    const graph = new SceneGraph()
    const parent = graph.createNode('FRAME', graph.getPages()[0].id, {
      layoutMode: 'VERTICAL'
    })
    const text = graph.createNode('TEXT', parent.id, {
      text: 'Auto-layout text',
      textAutoResize: 'NONE'
    })
    const generatedNodeChange = {}

    serializeTextNode({
      blobs: [],
      fillToKiwiPaint: unexpectedPaint,
      graph,
      node: text,
      nodeChange: generatedNodeChange
    })
    expect(generatedNodeChange).toMatchObject({
      textAutoResize: 'HEIGHT',
      textData: { characters: 'Auto-layout text' }
    })

    text.source.id = '4:22'
    const importedNodeChange = {}
    serializeTextNode({
      blobs: [],
      fillToKiwiPaint: unexpectedPaint,
      graph,
      node: text,
      nodeChange: importedNodeChange
    })
    expect(importedNodeChange).toMatchObject({ textAutoResize: 'NONE' })
  })

  test('deduplicates preserved glyph blobs through the serializer interface', () => {
    const graph = new SceneGraph()
    const text = graph.createNode('TEXT', graph.getPages()[0].id, { text: 'A' })
    text.figmaDerivedTextGlyphs = [
      {
        commandsBlob: new Uint8Array([1, 2, 3]),
        fontSize: text.fontSize,
        x: 0,
        y: 0
      }
    ]
    const blobs: Uint8Array[] = []
    const glyphBlobMap = new Map<string, number>()

    const serialize = () => {
      const nodeChange = {}
      serializeTextNode({
        blobs,
        fillToKiwiPaint: unexpectedPaint,
        fontDigestMap: new Map(),
        glyphBlobMap,
        graph,
        node: text,
        nodeChange
      })
      return nodeChange
    }

    expect(serialize()).toMatchObject({
      derivedTextData: { glyphs: [{ commandsBlob: 0 }] }
    })
    expect(serialize()).toMatchObject({
      derivedTextData: { glyphs: [{ commandsBlob: 0 }] }
    })
    expect(blobs).toHaveLength(1)
  })
})
