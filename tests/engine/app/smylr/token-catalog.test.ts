import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createSmylrTokensDesignPage } from '@/app/smylr-production/create-tokens-page'
import {
  tokenPreviewLight,
  type SmylrTokenDefinition
} from '@/app/smylr-production/smylr-token-catalog'

describe('Smylr token catalog', () => {
  test('clamps out-of-gamut color previews to CanvasKit channels', () => {
    const token: SmylrTokenDefinition = {
      category: 'surface',
      cssProperty: 'background-color',
      cssVariable: '--test-out-of-gamut',
      label: 'Out of gamut',
      sourceFile: 'test',
      resolvedValueLight: 'oklch(0.7 0.4 40)'
    }

    expect(tokenPreviewLight(token)).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })

  test('renders inset token previews with an inner shadow effect', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected the default page')

    createSmylrTokensDesignPage(graph, page)
    const insetPreviews = [...graph.getAllNodes()].filter(
      (node) => node.type === 'RECTANGLE' && node.name.startsWith('Inset card depth')
    )

    expect(insetPreviews).toHaveLength(2)
    for (const preview of insetPreviews) {
      expect(preview.effects).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'INNER_SHADOW' })])
      )
    }
  })
})
