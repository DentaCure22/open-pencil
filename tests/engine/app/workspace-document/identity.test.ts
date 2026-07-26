import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createOpenPencilWorkspaceIdentity,
  OPENPENCIL_WORKSPACE_DOCUMENT_NAME,
  parseOpenPencilWorkspaceIdentity,
  readOpenPencilWorkspaceIdentity,
  resolveOpenPencilWorkspaceIdentity,
  stampOpenPencilWorkspaceIdentity,
  type OpenPencilWorkspaceIdentity,
  type OpenPencilWorkspaceIdentityStorage
} from '@/app/workspace-document/identity'

function deterministicIdentity(): OpenPencilWorkspaceIdentity {
  let sequence = 0
  return createOpenPencilWorkspaceIdentity(() => `stable-${++sequence}`)
}

describe('OpenPencil workspace document identity', () => {
  test('creates and reuses one durable workspace identity', async () => {
    let stored: unknown = null
    let saves = 0
    const storage: OpenPencilWorkspaceIdentityStorage = {
      load: () => Promise.resolve(stored),
      save: (identity) => {
        stored = structuredClone(identity)
        saves += 1
        return Promise.resolve()
      }
    }

    const first = await resolveOpenPencilWorkspaceIdentity(storage, deterministicIdentity)
    const second = await resolveOpenPencilWorkspaceIdentity(storage, () => {
      throw new Error('A saved workspace must be reused')
    })

    expect(first).toEqual(second)
    expect(first).toEqual({
      documentId: 'document-stable-1',
      documentName: OPENPENCIL_WORKSPACE_DOCUMENT_NAME,
      roomId: 'workspace-room-stable-2',
      schemaVersion: 1,
      workspaceId: 'workspace-stable-3'
    })
    expect(saves).toBe(1)
  })

  test('stamps one identity on the graph root without replacing other metadata', () => {
    const graph = new SceneGraph()
    const root = graph.getNode(graph.rootId)
    if (!root) throw new Error('Expected document root')
    graph.updateNode(root.id, {
      pluginData: [{ key: 'tree-v1', pluginId: 'openpencil-sidebar-workspace', value: '{}' }]
    })
    const identity = deterministicIdentity()

    expect(stampOpenPencilWorkspaceIdentity(graph, identity)).toBe(true)
    expect(stampOpenPencilWorkspaceIdentity(graph, identity)).toBe(false)
    expect(readOpenPencilWorkspaceIdentity(graph)).toEqual(identity)
    expect(graph.getNode(graph.rootId)?.pluginData).toContainEqual({
      key: 'tree-v1',
      pluginId: 'openpencil-sidebar-workspace',
      value: '{}'
    })
  })

  test('rejects malformed or renamed workspace identities', () => {
    expect(parseOpenPencilWorkspaceIdentity(null)).toBeNull()
    expect(
      parseOpenPencilWorkspaceIdentity({
        ...deterministicIdentity(),
        documentName: 'Another document'
      })
    ).toBeNull()
  })
})
