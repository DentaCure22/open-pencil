import { describe, expect, test } from 'bun:test'

import {
  applyTokenSnapshot,
  exportVariablesToDtcg,
  parseDtcgTokens,
  reviewTokenSnapshot
} from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/scene-graph'

function graphWithTokens() {
  const graph = new SceneGraph()
  const collection = graph.createCollection('Foundation')
  collection.modes[0].name = 'Light'
  const darkModeId = 'mode:dark'
  graph.addMode(collection.id, darkModeId, 'Dark')
  const surface = graph.createVariable('color/surface', 'COLOR', collection.id, {
    r: 1,
    g: 1,
    b: 1,
    a: 1
  })
  surface.description = 'Primary surface color'
  surface.valuesByMode[darkModeId] = { r: 0.1, g: 0.12, b: 0.15, a: 1 }
  const alias = graph.createVariable('color/card', 'COLOR', collection.id)
  alias.valuesByMode[collection.defaultModeId] = { aliasId: surface.id }
  alias.valuesByMode[darkModeId] = { aliasId: surface.id }
  const enabled = graph.createVariable('feature/enabled', 'BOOLEAN', collection.id, true)
  enabled.valuesByMode[darkModeId] = false
  graph.setActiveMode(collection.id, darkModeId)
  return { graph, collection, surface, alias }
}

describe('DTCG design tokens', () => {
  test('exports standards-shaped tokens and round-trips OpenPencil modes and aliases', () => {
    const { graph, collection, surface, alias } = graphWithTokens()
    const document = exportVariablesToDtcg(graph)

    expect(document.$schema).toContain('2025.10')
    expect(document.Foundation).toBeDefined()
    expect(JSON.stringify(document)).toContain('colorSpace')
    expect(JSON.stringify(document)).toContain('{Foundation.color.surface}')

    const result = parseDtcgTokens(JSON.stringify(document))
    expect(result.warnings).toEqual([])
    expect(result.snapshot.collections).toEqual([collection])
    expect(result.snapshot.variables.find((variable) => variable.id === surface.id)).toEqual(
      surface
    )
    expect(
      result.snapshot.variables.find((variable) => variable.id === alias.id)?.valuesByMode[
        collection.defaultModeId
      ]
    ).toEqual({ aliasId: surface.id })
  })

  test('imports external DTCG groups, aliases, colors, numbers, and dimensions', () => {
    const result = parseDtcgTokens({
      $schema: 'https://www.designtokens.org/schemas/2025.10/format.json',
      Core: {
        color: {
          brand: {
            $type: 'color',
            $value: {
              colorSpace: 'srgb',
              components: [0.2, 0.4, 0.8],
              alpha: 0.9
            }
          },
          action: { $type: 'color', $value: '{Core.color.brand}' }
        },
        spacing: {
          sm: { $type: 'dimension', $value: { value: 8, unit: 'px' } }
        },
        opacity: { $type: 'number', $value: 0.6 }
      }
    })

    expect(result.snapshot.collections.map((collection) => collection.name)).toEqual(['Core'])
    expect(result.snapshot.variables.map((variable) => variable.name)).toEqual([
      'color/brand',
      'color/action',
      'spacing/sm',
      'opacity'
    ])
    const brand = result.snapshot.variables[0]
    const action = result.snapshot.variables[1]
    expect(action.type).toBe('COLOR')
    expect(Object.values(action.valuesByMode)[0]).toEqual({ aliasId: brand.id })
    expect(result.warnings).toEqual([
      'Core.spacing.sm: imported the px dimension as a unitless number'
    ])
  })

  test('reviews changes and preserves matching local IDs and bindings when applying', () => {
    const { graph, collection, surface } = graphWithTokens()
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
      boundVariables: { fills: surface.id }
    })
    const incoming = parseDtcgTokens(JSON.stringify(exportVariablesToDtcg(graph))).snapshot
    const incomingSurface = incoming.variables.find((variable) => variable.name === 'color/surface')
    if (!incomingSurface) throw new Error('Missing surface fixture')
    incomingSurface.description = 'Updated description'
    incoming.variables = incoming.variables.filter(
      (variable) => variable.name !== 'feature/enabled'
    )
    incoming.collections[0].variableIds = incoming.collections[0].variableIds.filter((id) =>
      incoming.variables.some((variable) => variable.id === id)
    )

    const review = reviewTokenSnapshot(graph, incoming)
    expect(review.variables).toEqual({ added: 0, updated: 1, unchanged: 1, removed: 1 })

    applyTokenSnapshot(graph, incoming)
    expect(graph.getVariablesForCollection(collection.id).map((variable) => variable.name)).toEqual(
      ['color/surface', 'color/card']
    )
    expect(graph.variables.get(surface.id)?.description).toBe('Updated description')
    expect(graph.getNode(node.id)?.boundVariables.fills).toBe(surface.id)
  })
})
