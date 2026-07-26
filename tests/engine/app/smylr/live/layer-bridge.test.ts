import { afterEach, describe, expect, test } from 'bun:test'

// The live tree remains virtual while its owner is an ordinary persisted frame.
import { SceneGraph } from '@open-pencil/scene-graph'

import { createSmylrProductionAppDocument, setCodeObjectDocument } from '@/app/code-object/model'
import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'
import {
  buildLiveLayerChildrenForSceneNode,
  displayNameForLiveNode
} from '@/app/smylr-live-inspector/layer-bridge'
import {
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'

function liveNode(
  id: string,
  label: string,
  children: SmylrLiveContainerNode[] = []
): SmylrLiveContainerNode {
  return {
    children,
    id,
    label,
    rect: { height: 100, width: 100, x: 0, y: 0 },
    tagName: 'div'
  }
}

afterEach(() => {
  liveInspectorActiveFrameId.value = null
  liveInspectorDocument.value = null
  liveInspectorInteractionMode.value = 'frame'
})

describe('Smylr production Code Object Layers', () => {
  test('uses React and semantic container identities for readable rows', () => {
    const node = liveNode('button', 'button')
    node.attrs = { 'data-slot': 'primary-action' }
    node.source = { componentName: 'SavePatientButton' }

    expect(displayNameForLiveNode(node)).toBe('SavePatientButton')
    node.attrs['data-smylr-container-label'] = 'Patient Save Action'
    expect(displayNameForLiveNode(node)).toBe('Patient Save Action')
    delete node.attrs['data-smylr-container-label']
    delete node.source
    expect(displayNameForLiveNode(node)).toBe('primary-action')
  })

  test('projects the full live tree only under its production Code Object frame', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Treatment Plan / Current',
      pluginData: [
        {
          key: 'kind',
          pluginId: 'smylr-production',
          value: 'smylr-code-object-frame'
        }
      ]
    })
    setCodeObjectDocument(
      graph,
      frame.id,
      createSmylrProductionAppDocument({
        label: frame.name,
        route: '/treatment-plan'
      })
    )
    const grandchild = liveNode('grandchild', 'Grandchild')
    const child = liveNode('child', 'Child', [grandchild])
    const root = liveNode('root', 'Treatment Plan', [child])
    liveInspectorActiveFrameId.value = frame.id
    liveInspectorDocument.value = {
      capturedAt: new Date(0).toISOString(),
      route: '/treatment-plan',
      selectedId: 'root',
      title: 'Treatment Plan',
      tree: root
    }

    expect(buildLiveLayerChildrenForSceneNode(frame)).toBeUndefined()

    liveInspectorInteractionMode.value = 'select'
    const rows = buildLiveLayerChildrenForSceneNode(frame)

    expect(rows?.[0]?.id).toBe('live:root')
    expect(rows?.[0]?.children?.[0]?.id).toBe('live:child')
    expect(rows?.[0]?.children?.[0]?.children?.[0]?.id).toBe('live:grandchild')
  })
})
