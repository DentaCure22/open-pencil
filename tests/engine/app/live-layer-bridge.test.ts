import { afterEach, describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'
import { buildLiveLayerChildrenForSceneNode } from '@/app/smylr-live-inspector/layer-bridge'
import {
  liveInspectorActiveFrameId,
  liveInspectorDocument
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
})

describe('Smylr live layer bridge', () => {
  test('keeps the live root container and every descendant', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const liveFrame = graph.createNode('FRAME', page.id, {
      name: 'Live Smylr App / Treatment Plan',
      pluginData: [
        {
          key: 'kind',
          pluginId: 'smylr-production',
          value: 'live-app-frame'
        }
      ]
    })
    const grandchild = liveNode('grandchild', 'Grandchild')
    const child = liveNode('child', 'Child', [grandchild])
    const root = liveNode('root', 'Treatment Plan', [child])
    liveInspectorActiveFrameId.value = liveFrame.id
    liveInspectorDocument.value = {
      capturedAt: new Date(0).toISOString(),
      route: '/treatment-plan',
      selectedId: '',
      title: 'Treatment Plan',
      tree: root
    }

    const rows = buildLiveLayerChildrenForSceneNode(liveFrame)

    expect(rows?.[0]?.id).toBe('live:root')
    expect(rows?.[0]?.children?.[0]?.id).toBe('live:child')
    expect(rows?.[0]?.children?.[0]?.children?.[0]?.id).toBe('live:grandchild')
  })
})
