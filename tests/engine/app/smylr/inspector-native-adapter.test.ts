import { describe, expect, test } from 'bun:test'

import { smylrLiveContainerToSceneGraph } from '@/app/smylr-live-container/to-scene-graph'
import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode
} from '@/app/smylr-live-container/types'
import {
  cloneLiveInspectorValue,
  createLiveInspectorStylePatch,
  draftAdjustedLiveInspectorDocument,
  findLiveInspectorProxyNode,
  seedLiveInspectorSemanticVariables
} from '@/app/smylr-live-inspector/native-adapter'

function liveNode(id: string, children: SmylrLiveContainerNode[] = []): SmylrLiveContainerNode {
  return {
    children,
    computedStyle: {
      'box-sizing': 'border-box',
      height: '40px',
      translate: '1px 2px',
      width: '80px'
    },
    id,
    label: id,
    rect: { height: 40, width: 80, x: 0, y: 0 }
  }
}

function liveDocument(tree = liveNode('root', [liveNode('target')])): SmylrLiveContainerDocument {
  return {
    capturedAt: '2026-08-25T00:00:00.000Z',
    route: '/adapter-test',
    selectedId: 'target',
    title: 'Adapter test',
    tree
  }
}

describe('Smylr live-inspector native adapter', () => {
  test('rebuilds one draft-adjusted document without mutating its captured source', () => {
    const document = liveDocument()
    const sourceTarget = document.tree.children?.[0]
    if (!sourceTarget) throw new Error('Missing test target')

    const adjusted = draftAdjustedLiveInspectorDocument(document, sourceTarget, {
      height: 'calc(2rem + 8px)',
      width: '6rem'
    })
    const adjustedTarget = adjusted.tree.children?.[0]

    expect(adjustedTarget?.rect).toMatchObject({ height: 40, width: 96 })
    expect(adjustedTarget?.computedStyle).toMatchObject({
      height: 'calc(2rem + 8px)',
      width: '6rem'
    })
    expect(sourceTarget.rect).toMatchObject({ height: 40, width: 80 })
    expect(sourceTarget.computedStyle?.width).toBe('80px')
  })

  test('seeds semantic variables and binds matching token provenance', () => {
    const document = liveDocument()
    const target = document.tree.children?.[0]
    if (!target) throw new Error('Missing test target')
    target.tokenProvenance = [
      {
        cssProperty: 'background-color',
        cssVariable: '--surface-card',
        evidence: 'inline-declaration'
      }
    ]
    const catalog = [
      {
        category: 'surface' as const,
        cssProperty: 'background-color',
        cssVariable: '--surface-card' as const,
        label: 'Card',
        resolvedValue: 'rgb(24 32 48 / 50%)',
        sourceFile: 'tokens.css'
      }
    ]
    const graph = smylrLiveContainerToSceneGraph(document)
    const proxy = findLiveInspectorProxyNode(graph, target.id)
    if (!proxy) throw new Error('Missing proxy node')

    const tokenByVariableId = seedLiveInspectorSemanticVariables({
      catalog,
      graph,
      node: target,
      proxy
    })

    expect(tokenByVariableId.size).toBe(1)
    expect(proxy.boundVariables['fills/0/color']).toBeDefined()
  })

  test('translates geometry edits back into live CSS patches', () => {
    const document = liveDocument()
    const target = document.tree.children?.[0]
    if (!target) throw new Error('Missing test target')
    const graph = smylrLiveContainerToSceneGraph(document)
    const proxy = findLiveInspectorProxyNode(graph, target.id)
    if (!proxy) throw new Error('Missing proxy node')
    const baseline = cloneLiveInspectorValue(proxy)
    const current = cloneLiveInspectorValue(proxy)
    current.x += 8
    current.width += 12

    const styles = createLiveInspectorStylePatch({
      baseline,
      current,
      sourceStyles: target.computedStyle,
      tokenByVariableId: new Map()
    })

    expect(styles.translate).toBe('9px 2px')
    expect(styles.width).toBe(`${current.width}px`)
  })
})
