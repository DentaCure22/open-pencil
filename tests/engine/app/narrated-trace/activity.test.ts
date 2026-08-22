import { describe, expect, test } from 'bun:test'

import type { SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import {
  changesForNarratedTraceNodeUpdate,
  NARRATED_TRACE_ACTIVITY_KINDS,
  snapshotNarratedTraceNode
} from '@/app/narrated-trace'

describe('Narrated Trace semantic activity', () => {
  test('defines the bounded v1 event taxonomy', () => {
    expect(NARRATED_TRACE_ACTIVITY_KINDS).toEqual([
      'ink',
      'screenshot',
      'selection',
      'tool',
      'shape',
      'edit',
      'note'
    ])
  })

  test('keeps geometry and style changes while excluding content and internal payloads', () => {
    const previous = {
      fills: [],
      pluginData: [],
      text: 'Private draft',
      width: 100,
      x: 10
    } satisfies Partial<SceneNode>

    const changes = changesForNarratedTraceNodeUpdate(previous, {
      fills: [
        {
          color: { a: 1, b: 0.8, g: 0.4, r: 0.2 },
          opacity: 1,
          type: 'SOLID',
          visible: true
        }
      ],
      pluginData: [{ key: 'private', pluginId: 'test', value: 'secret' }],
      text: 'Secret patient note',
      width: 240,
      x: 40
    })

    expect(changes.map((change) => change.property)).toEqual(['fills', 'width', 'x'])
    expect(JSON.stringify(changes)).not.toContain('patient note')
    expect(JSON.stringify(changes)).not.toContain('secret')
  })

  test('retains deleted-node target fields without retaining content', () => {
    const node = createDefaultNode(() => 'trace-node', 'RECTANGLE', {
      height: 80,
      name: 'Patient card',
      parentId: 'page-1',
      pluginData: [{ key: 'route', pluginId: 'test', value: '/patients' }],
      text: 'Private note',
      width: 120,
      x: 10,
      y: 20
    })

    const snapshot = snapshotNarratedTraceNode(node)

    expect(snapshot).toMatchObject({
      height: 80,
      id: 'trace-node',
      name: 'Patient card',
      parentId: 'page-1',
      pluginData: [{ key: 'route', pluginId: 'test', value: '/patients' }],
      type: 'RECTANGLE',
      width: 120,
      x: 10,
      y: 20
    })
    expect(snapshot.text).toBeUndefined()
  })
})
