import { describe, expect, test } from 'bun:test'

import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode
} from '@/app/smylr-live-container/types'
import {
  isSmylrOpenPencilInspectorMessage,
  SMYLR_OPENPENCIL_INSPECTOR_MESSAGE
} from '@/app/smylr-live-inspector/protocol'

function liveNode(id: string, children: SmylrLiveContainerNode[] = []): SmylrLiveContainerNode {
  return {
    children,
    id,
    label: id,
    rect: { height: 100, width: 100, x: 0, y: 0 }
  }
}

function liveDocument(tree = liveNode('root', [liveNode('patient')])): SmylrLiveContainerDocument {
  return {
    capturedAt: new Date(0).toISOString(),
    route: '/dental-chart',
    selectedId: 'patient',
    title: 'Dental Chart',
    tree
  }
}

describe('Smylr live-inspector protocol', () => {
  test('accepts one bounded selected-tree packet through the protocol interface', () => {
    const document = liveDocument()

    expect(
      isSmylrOpenPencilInspectorMessage({
        action: 'select',
        document,
        kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
        selectedId: document.selectedId,
        selectedRect: { height: 100, width: 100, x: 0, y: 0 }
      })
    ).toBe(true)
  })

  test('rejects undeclared fields and selection that is absent from the tree', () => {
    const document = liveDocument()

    expect(
      isSmylrOpenPencilInspectorMessage({
        action: 'tree',
        document,
        kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
        secret: 'must not cross the seam'
      })
    ).toBe(false)
    expect(
      isSmylrOpenPencilInspectorMessage({
        action: 'select',
        document,
        kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
        selectedId: 'missing',
        selectedRect: { height: 100, width: 100, x: 0, y: 0 }
      })
    ).toBe(false)
  })

  test('rejects duplicate identities and trees beyond the protocol depth limit', () => {
    expect(
      isSmylrOpenPencilInspectorMessage({
        action: 'tree',
        document: liveDocument(liveNode('root', [liveNode('patient'), liveNode('patient')])),
        kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE
      })
    ).toBe(false)

    let tree = liveNode('patient')
    for (let depth = 0; depth < 66; depth += 1) tree = liveNode(`node-${String(depth)}`, [tree])
    expect(
      isSmylrOpenPencilInspectorMessage({
        action: 'tree',
        document: liveDocument(tree),
        kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE
      })
    ).toBe(false)
  })
})
