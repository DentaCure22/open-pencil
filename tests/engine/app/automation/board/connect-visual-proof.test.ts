import { afterEach, expect, test } from 'bun:test'

import { waitForConnectionVisualProof } from '@/app/automation/bridge/board-tools/connect-visual-proof'
import { createEditorStore } from '@/app/editor/session'
import { connectObjects } from '@/app/object-graph'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
})

test('rejects invisible or geometrically unrelated connector DOM', async () => {
  const store = createEditorStore()
  const sourceId = store.createShape('RECTANGLE', 40, 60, 120, 80)
  const targetId = store.createShape('RECTANGLE', 360, 60, 120, 80)
  const connection = connectObjects(store, {
    kind: 'visual',
    label: 'Flow',
    sourceNodeId: sourceId,
    targetNodeId: targetId
  })
  if (!connection) throw new Error('Connection was not created')
  const path = Object.assign(Object.create(null) as SVGPathElement, {
    getAttribute: (name: string) => (name === 'd' ? 'M 160 100 C 230 100 290 100 360 100' : null),
    getTotalLength: () => 200,
    isConnected: true,
    tagName: 'path'
  })
  const edge = Object.assign(Object.create(null) as SVGGElement, {
    getAttribute: (name: string) => (name === 'data-id' ? connection.id : null),
    isConnected: true,
    querySelector: (selector: string) => (selector === '.react-flow__edge-path' ? path : null),
    tagName: 'g'
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: {},
      defaultView: {
        getComputedStyle: () => ({
          display: 'block',
          fill: 'rgba(0, 0, 0, 0)',
          fillOpacity: '1',
          opacity: '0.0',
          stroke: 'rgba(0, 0, 0, 0)',
          strokeOpacity: '1',
          strokeWidth: '2px',
          visibility: 'visible'
        })
      },
      querySelectorAll: (selector: string) =>
        selector === '.react-flow__edge[data-id]' ? [edge] : []
    }
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(performance.now())
      return 1
    }
  })

  const proof = await waitForConnectionVisualProof(
    store.graph,
    store.state.currentPageId,
    connection
  )

  expect(proof.status).toBe('missing')
  expect(proof.reasons).toEqual(['path_geometry_mismatch', 'path_not_visible'])
})
