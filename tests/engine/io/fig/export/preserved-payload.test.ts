import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  applyPreservedFigmaNodeFields,
  hasPreservedUnsupportedEffects,
  materializeFigmaPayload,
  nodeForExplicitGeometryExport
} from '#core/kiwi/fig/node-change/preserved-payload'

type MaterializedPayload = {
  colorVar?: unknown
  firstBlob?: unknown
  secondBlob?: unknown
  stackJustify?: unknown
  variableConsumptionMap?: unknown
}

function importedRectangle() {
  const graph = new SceneGraph()
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    name: 'Preserved payload test'
  })
  node.source.format = 'fig'
  node.source.id = '4:42'
  return node
}

describe('preserved Figma payload export', () => {
  test('materializes blobs, filters unsafe variable maps, and normalizes legacy layout values', () => {
    const blobs: Uint8Array[] = []
    const blobIndexByHex = new Map<string, number>()
    const source = {
      firstBlob: { __openPencilFigmaBlob: new Uint8Array([1, 2, 3]) },
      secondBlob: { __openPencilFigmaBlob: new Uint8Array([1, 2, 3]) },
      stackJustify: 'SPACE_EVENLY',
      colorVar: { value: 'hidden by default' },
      variableConsumptionMap: {
        entries: [
          { variableData: { dataType: 'COLOR' } },
          { variableData: { dataType: 'PROP_REF', value: { propRefValue: { key: 'x' } } } }
        ]
      }
    }

    const materialized = materializeFigmaPayload(source, blobs, {
      blobIndexByHex
    }) as MaterializedPayload

    expect(materialized.firstBlob).toBe(0)
    expect(materialized.secondBlob).toBe(0)
    expect(blobs).toHaveLength(1)
    expect(materialized.stackJustify).toBe('SPACE_BETWEEN')
    expect(materialized.colorVar).toBeUndefined()
    expect(materialized.variableConsumptionMap).toEqual({
      entries: [{ variableData: { dataType: 'PROP_REF', value: { propRefValue: { key: 'x' } } } }]
    })
  })

  test('lets explicit structural fields win while repairing preserved paint aliases', () => {
    const node = importedRectangle()
    node.source.fig.rawNodeFields.pageType = 'SLIDES'
    node.source.fig.rawNodeFields.strokeJoin = 'BEVEL'
    node.source.fig.rawNodeFields.fillPaints = [
      {
        blendMode: 'NORMAL',
        color: { a: 1, b: 0, g: 0, r: 1 },
        colorVar: {
          value: { alias: { assetRef: { key: 'brand-red', version: '7' } } }
        },
        opacity: 1,
        type: 'SOLID',
        visible: true
      }
    ]
    const nodeChange = {
      fillPaints: [{ type: 'SOLID' }],
      pageType: 'DESIGN',
      strokeJoin: 'MITER'
    }
    const guid = { localID: 9, sessionID: 4 }

    applyPreservedFigmaNodeFields(
      {
        assetRefToVarGuid: new Map([['brand-red@7', guid]]),
        blobs: []
      },
      node,
      nodeChange
    )

    expect(nodeChange.pageType).toBe('DESIGN')
    expect(nodeChange.strokeJoin).toBe('MITER')
    expect(nodeChange.fillPaints[0]).toMatchObject({
      colorVar: { value: { alias: { guid } } }
    })
  })

  test('suppresses regenerated geometry when an imported payload must win', () => {
    const node = importedRectangle()
    node.fillGeometry = [{ commands: [], windingRule: 'NONZERO' }]
    node.strokeGeometry = [{ commands: [], windingRule: 'NONZERO' }]
    node.vectorNetwork = { regions: [], segments: [], vertices: [] }
    node.source.fig.rawNodeFields.fillGeometry = [{ windingRule: 'EVENODD' }]
    node.source.fig.rawNodeFields.vectorData = { normalizedSize: { x: 1, y: 1 } }

    const prepared = nodeForExplicitGeometryExport(node)

    expect(prepared).not.toBe(node)
    expect(prepared.fillGeometry).toEqual([])
    expect(prepared.strokeGeometry).toEqual([])
    expect(prepared.vectorNetwork).toBeNull()
    expect(node.fillGeometry).toHaveLength(1)
    expect(node.vectorNetwork).not.toBeNull()
  })

  test('detects effect payloads that the normalized scene model cannot represent', () => {
    const node = importedRectangle()
    node.source.fig.rawNodeFields.effects = [{ type: 'GLASS_BLUR' }]
    expect(hasPreservedUnsupportedEffects(node)).toBe(true)

    node.source.fig.rawNodeFields.effects = [{ type: 'DROP_SHADOW' }]
    expect(hasPreservedUnsupportedEffects(node)).toBe(false)
  })
})
