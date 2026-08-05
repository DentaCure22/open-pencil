import { describe, expect, test } from 'bun:test'

import {
  clearObjectGraphPortPresentation,
  invalidateObjectGraphPortPresentation,
  publishObjectGraphPortPresentation,
  readObjectGraphPortPresentation,
  subscribeObjectGraphPortInvalidation,
  subscribeObjectGraphPortPresentation
} from '@/app/object-graph/port-presentation'

describe('Object Graph runtime port presentation', () => {
  test('publishes transient semantic anchors independently from persisted ports', () => {
    const nodeId = 'runtime-port-presentation:test'
    let changes = 0
    let invalidations = 0
    const stopChanges = subscribeObjectGraphPortPresentation((changedNodeId) => {
      if (changedNodeId === nodeId) changes += 1
    })
    const stopInvalidations = subscribeObjectGraphPortInvalidation((changedNodeId) => {
      if (changedNodeId === nodeId) invalidations += 1
    })

    const anchors = { 'field/id/output': { x: 240, y: 76 } }
    expect(publishObjectGraphPortPresentation(nodeId, anchors)).toBe(true)
    anchors['field/id/output'].y = 104
    expect(readObjectGraphPortPresentation(nodeId)).toEqual({
      'field/id/output': { x: 240, y: 76 }
    })
    expect(
      publishObjectGraphPortPresentation(nodeId, { 'field/id/output': { x: 240, y: 76 } })
    ).toBe(false)
    invalidateObjectGraphPortPresentation(nodeId)
    expect(clearObjectGraphPortPresentation(nodeId)).toBe(true)
    expect(readObjectGraphPortPresentation(nodeId)).toBeUndefined()
    expect({ changes, invalidations }).toEqual({ changes: 2, invalidations: 1 })

    stopChanges()
    stopInvalidations()
  })
})
