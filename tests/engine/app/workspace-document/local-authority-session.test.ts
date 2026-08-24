import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import {
  applySmylrProductionDocument,
  serializeSmylrProductionDocumentForAuthority
} from '@/app/smylr-production/document-state'
import {
  createLocalWorkspaceAuthorityGraphBase,
  createLocalWorkspaceDocumentAuthority,
  createSerializedLocalWorkspaceAuthorityOperations,
  createSerializedLocalWorkspacePersist
} from '@/app/workspace-document/local-authority/session'

function createAuthorityDocumentFixture() {
  const source = createEditorStore()
  source.setViewportSize(1200, 800)
  const firstPage = source.graph.getPages()[0]
  if (!firstPage) throw new Error('Authority fixture page missing')
  source.graph.updateNode(firstPage.id, {
    pluginData: [
      { key: 'kind', pluginId: 'smylr-production', value: 'smylr-production-page' },
      { key: 'pageId', pluginId: 'smylr-production', value: 'fixture-first' }
    ]
  })
  const selectedPageId = source.addPage('Reload target')
  const markerId = source.graph.createNode('RECTANGLE', selectedPageId, {
    name: 'Authority reload marker'
  }).id
  const document = serializeSmylrProductionDocumentForAuthority(source)
  if (!document) throw new Error('Authority fixture document missing')
  expect(document.mermaidPresent).toBe(false)
  return { document, markerId, selectedPageId }
}

const authorityOptions = {
  canWrite: () => true,
  isCloudActive: () => false,
  onBlocked: () => undefined,
  onLocalHeadCommitted: () => undefined
}

describe('local workspace authority graph base', () => {
  test('fails closed until the graph has an authority content hash', () => {
    const graphBase = createLocalWorkspaceAuthorityGraphBase()

    expect(graphBase.hasDiverged('authority-head')).toBe(true)
    expect(graphBase.hasDiverged(null)).toBe(true)
  })

  test('detects a refreshed authority hash even when a stale graph borrows its revision', () => {
    const graphBase = createLocalWorkspaceAuthorityGraphBase()
    graphBase.advance('restored-hash')

    expect(graphBase.hasDiverged('restored-hash')).toBe(false)
    expect(graphBase.hasDiverged('newer-head-hash')).toBe(true)
  })

  test('advances after a successful authority operation and clears for browser restore', () => {
    const graphBase = createLocalWorkspaceAuthorityGraphBase()
    graphBase.advance('restored-hash')
    graphBase.advance('committed-hash')

    expect(graphBase.hasDiverged('committed-hash')).toBe(false)
    graphBase.clear()
    expect(graphBase.hasDiverged('committed-hash')).toBe(true)
  })
})

describe('local workspace authority save path', () => {
  test('does not wait for the browser cache after an authority commit', async () => {
    const session = await Bun.file('src/app/workspace-document/local-authority/session.ts').text()
    expect(session).toContain('options.onLocalHeadCommitted()')
    expect(session).toContain('void saveSmylrProductionDocument(store)')
    expect(session).toContain('[Local workspace authority] Browser cache save failed:')
  })
})

describe('local workspace authority persistence queue', () => {
  test('serializes overlapping saves so each begins after the previous commit', async () => {
    const events: string[] = []
    let releaseFirst = () => undefined
    const firstCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const persist = createSerializedLocalWorkspacePersist(async (snapshot: string) => {
      events.push(`start:${snapshot}`)
      if (snapshot === 'first') await firstCommit
      events.push(`finish:${snapshot}`)
      return true
    })

    const first = persist('first')
    const second = persist('second')
    await Promise.resolve()
    expect(events).toEqual(['start:first'])

    releaseFirst()
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(events).toEqual(['start:first', 'finish:first', 'start:second', 'finish:second'])
  })

  test('continues the queue after one save rejects', async () => {
    const events: string[] = []
    const persist = createSerializedLocalWorkspacePersist(async (snapshot: string) => {
      events.push(snapshot)
      if (snapshot === 'rejected') throw new Error('simulated authority rejection')
      return true
    })

    const rejected = persist('rejected')
    const next = persist('next')

    await expect(rejected).rejects.toThrow('simulated authority rejection')
    await expect(next).resolves.toBe(true)
    expect(events).toEqual(['rejected', 'next'])
  })

  test('orders an old instance save before the new instance restore and head check', async () => {
    const events: string[] = []
    let authorityRevision = 82
    let latestStatusRevision = 82
    let releaseOldSave = () => undefined
    const oldSaveCommit = new Promise<void>((resolve) => {
      releaseOldSave = resolve
    })
    const serializeOperation = createSerializedLocalWorkspaceAuthorityOperations()
    const persistOldInstance = createSerializedLocalWorkspacePersist(async () => {
      events.push('old-save:start')
      await oldSaveCommit
      authorityRevision = 83
      latestStatusRevision = 83
      events.push('old-save:finish')
      return true
    }, serializeOperation)

    const oldSave = persistOldInstance('pagehide')
    await Promise.resolve()
    const restoredRevision = serializeOperation(async () => {
      events.push('new-restore')
      latestStatusRevision = authorityRevision
      return authorityRevision
    })
    const hasNewerHead = serializeOperation(async () => {
      events.push('new-head-check')
      const previous = latestStatusRevision
      latestStatusRevision = authorityRevision
      return latestStatusRevision > previous
    })

    expect(events).toEqual(['old-save:start'])
    releaseOldSave()
    await expect(oldSave).resolves.toBe(true)
    await expect(restoredRevision).resolves.toBe(83)
    await expect(hasNewerHead).resolves.toBe(false)
    expect(events).toEqual(['old-save:start', 'old-save:finish', 'new-restore', 'new-head-check'])
  })
})

describe('local workspace authority reload hydration', () => {
  test('hydrates the saved head and restores the exact tab-scoped Board view', async () => {
    const fixture = createAuthorityDocumentFixture()
    const restored = createEditorStore()
    restored.setViewportSize(1200, 800)
    let browserFallbackCalls = 0
    const authority = createLocalWorkspaceDocumentAuthority(authorityOptions, {
      applyDocument: applySmylrProductionDocument,
      readHead: async () => ({
        authorityId: 'authority-reload-test',
        contentHash: 'saved-head-hash',
        document: fixture.document,
        identity: {
          documentId: 'document-reload-test',
          documentName: 'OpenPencil Workspace',
          roomId: 'room-reload-test',
          schemaVersion: 1,
          workspaceId: 'workspace-reload-test'
        },
        revision: 7,
        updatedAt: '2026-07-30T00:00:00.000Z',
        version: 1
      })
    })

    await expect(
      authority.restore(
        restored,
        async () => {
          browserFallbackCalls += 1
          return false
        },
        {
          pageId: fixture.selectedPageId,
          viewport: { panX: 42, panY: -19, zoom: 1.25 }
        }
      )
    ).resolves.toBe(true)

    expect(browserFallbackCalls).toBe(0)
    expect(restored.state.documentName).toBe('OpenPencil Workspace')
    expect(restored.state.currentPageId).toBe(fixture.selectedPageId)
    expect(restored.graph.getNode(fixture.markerId)?.name).toBe('Authority reload marker')
    expect({
      panX: restored.state.panX,
      panY: restored.state.panY,
      zoom: restored.state.zoom
    }).toEqual({ panX: 42, panY: -19, zoom: 1.25 })
  })
})
