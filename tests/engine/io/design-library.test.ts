import { describe, expect, test } from 'bun:test'

import {
  applyOpenPencilLibrary,
  buildOpenPencilLibrary,
  parseOpenPencilLibrary,
  reviewOpenPencilLibrary
} from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/scene-graph'

function sourceLibrary() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id, {
    name: 'Button',
    width: 120,
    height: 40
  })
  const label = graph.createNode('TEXT', component.id, {
    name: 'Label',
    text: 'Continue',
    width: 80,
    height: 20
  })
  const collection = graph.createCollection('Foundation')
  graph.createVariable('color/action', 'COLOR', collection.id, {
    r: 0.4,
    g: 0.2,
    b: 0.9,
    a: 1
  })
  return { graph, component, label }
}

describe('OpenPencil design libraries', () => {
  test('publishes real component geometry and applies reviewable updates in place', () => {
    const source = sourceLibrary()
    const first = buildOpenPencilLibrary(source.graph, {
      key: 'acme-ui',
      name: 'Acme UI',
      version: '1.0.0',
      publishedAt: '2026-07-20T00:00:00.000Z'
    })
    const parsed = parseOpenPencilLibrary(JSON.stringify(first))
    expect(parsed.components).toHaveLength(1)
    expect(parsed.components[0].node.children[0].text).toBe('Continue')

    const target = new SceneGraph()
    const firstReview = reviewOpenPencilLibrary(target, parsed)
    expect(firstReview.components).toEqual({
      added: 1,
      updated: 0,
      unchanged: 0,
      removed: 0
    })
    expect(firstReview.tokens.variables.added).toBe(1)
    applyOpenPencilLibrary(target, parsed, firstReview)

    const imported = [...target.nodes.values()].find(
      (node) => node.type === 'COMPONENT' && node.sourceLibraryKey === 'acme-ui'
    )
    if (!imported) throw new Error('Missing imported component')
    const importedId = imported.id
    const instance = target.createInstance(imported.id, target.getPages()[0].id)
    if (!instance) throw new Error('Missing instance')

    source.graph.updateNode(source.label.id, { text: 'Submit', width: 96 })
    const second = buildOpenPencilLibrary(source.graph, {
      key: 'acme-ui',
      name: 'Acme UI',
      version: '1.1.0',
      publishedAt: '2026-07-20T01:00:00.000Z'
    })
    const secondReview = reviewOpenPencilLibrary(target, second)
    expect(secondReview.components.updated).toBe(1)
    applyOpenPencilLibrary(target, second, secondReview)

    expect(
      [...target.nodes.values()].find(
        (node) => node.type === 'COMPONENT' && node.sourceLibraryKey === 'acme-ui'
      )?.id
    ).toBe(importedId)
    expect(target.getChildren(instance.id)[0]?.text).toBe('Submit')
    expect(target.getChildren(instance.id)[0]?.width).toBe(96)
  })
})
