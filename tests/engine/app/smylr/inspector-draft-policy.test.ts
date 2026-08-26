import { describe, expect, test } from 'bun:test'

import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode,
  SmylrLiveContainerSource
} from '@/app/smylr-live-container/types'
import {
  copyLiveInspectorPatchDraft,
  remapLiveInspectorDrafts
} from '@/app/smylr-live-inspector/draft-policy'
import type { LiveInspectorPatchDraft } from '@/app/smylr-live-inspector/patch'

const source: SmylrLiveContainerSource = {
  componentName: 'PatientCard',
  filePath: 'src/PatientCard.tsx',
  lineNumber: 12,
  sourceKind: 'component'
}

function node(
  id: string,
  label: string,
  nodeSource?: SmylrLiveContainerSource
): SmylrLiveContainerNode {
  return {
    children: [],
    id,
    label,
    rect: { height: 40, width: 80, x: 0, y: 0 },
    source: nodeSource
  }
}

function documentWith(children: SmylrLiveContainerNode[]): SmylrLiveContainerDocument {
  return {
    capturedAt: new Date(0).toISOString(),
    route: '/dental-chart',
    title: 'Dental Chart',
    tree: { ...node('root', 'Root'), children }
  }
}

function draft(nodeId = 'old-card'): LiveInspectorPatchDraft {
  return {
    add: ['rounded'],
    nodeId,
    note: 'Patient',
    remove: [],
    source,
    styles: { color: 'red' }
  }
}

describe('Smylr live-inspector draft policy', () => {
  test('copies mutable draft values at the session boundary', () => {
    const original = draft()
    const copy = copyLiveInspectorPatchDraft(original)

    original.add.push('shadow')
    original.styles!.color = 'blue'

    expect(copy.add).toEqual(['rounded'])
    expect(copy.styles).toEqual({ color: 'red' })
  })

  test('remaps a stale runtime id through one stable source identity', () => {
    const [remapped] = remapLiveInspectorDrafts(
      [draft()],
      documentWith([node('new-card', 'Patient', source)])
    )

    expect(remapped?.nodeId).toBe('new-card')
    expect(remapped?.source).toEqual(source)
  })

  test('drops a stale draft when its fallback identity is ambiguous', () => {
    expect(
      remapLiveInspectorDrafts(
        [draft()],
        documentWith([node('card-a', 'Patient', source), node('card-b', 'Patient', source)])
      )
    ).toEqual([])
  })
})
