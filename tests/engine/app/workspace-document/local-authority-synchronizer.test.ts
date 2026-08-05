import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createEditorStore } from '@/app/editor/session'
import {
  applySmylrProductionDocument,
  serializeSmylrProductionDocumentForAuthority
} from '@/app/smylr-production/document-state'
import { createLocalWorkspaceAuthorityHeadSynchronizer } from '@/app/workspace-document/local-authority/synchronizer'

import {
  LocalWorkspaceAuthorityStore,
  LocalWorkspaceAuthorityStoreError
} from '#mcp/local-workspace-authority/store'

function serializedAuthorityDocument(store: ReturnType<typeof createEditorStore>) {
  const document = serializeSmylrProductionDocumentForAuthority(store)
  if (!document) throw new Error('Expected a serializable authority document')
  return document
}

function createMarker(store: ReturnType<typeof createEditorStore>, name: string): string {
  const page = store.graph.getPages()[0]
  if (!page) throw new Error('Expected an authority fixture page')
  return store.graph.createNode('RECTANGLE', page.id, { name }).id
}

function markAsAuthorityDocument(store: ReturnType<typeof createEditorStore>): void {
  const page = store.graph.getPages()[0]
  if (!page) throw new Error('Expected an authority fixture page')
  store.graph.updateNode(page.id, {
    pluginData: [
      { key: 'kind', pluginId: 'smylr-production', value: 'smylr-production-page' },
      { key: 'pageId', pluginId: 'smylr-production', value: 'fixture-first' }
    ]
  })
}

function synchronizerFixture() {
  const events: string[] = []
  let sceneVersion = 1
  let restoreResult = true
  const synchronizer = createLocalWorkspaceAuthorityHeadSynchronizer({
    canResumeWriting: () => true,
    canSynchronize: () => true,
    canWrite: () => true,
    currentSceneVersion: () => sceneVersion,
    persist: async () => {
      events.push('persist')
      return true
    },
    restore: async () => {
      events.push('restore')
      sceneVersion += 1
      return restoreResult
    },
    setWritable: (writable) => events.push(`writable:${writable}`),
    startTracking: () => events.push('tracking:start'),
    stopTracking: () => events.push('tracking:stop')
  })
  synchronizer.acknowledge(sceneVersion)
  return {
    events,
    synchronizer,
    setRestoreResult: (value: boolean) => {
      restoreResult = value
    },
    touch: () => {
      sceneVersion += 1
    }
  }
}

describe('local workspace authority head synchronizer', () => {
  test('restores the central head and resumes a writable client', async () => {
    const fixture = synchronizerFixture()

    await expect(fixture.synchronizer.synchronize()).resolves.toBe(true)
    expect(fixture.events).toEqual(['tracking:stop', 'restore', 'writable:true', 'tracking:start'])
  })

  test('preserves dirty local work before restoring a newer head', async () => {
    const fixture = synchronizerFixture()
    fixture.touch()

    await expect(fixture.synchronizer.synchronize()).resolves.toBe(true)
    expect(fixture.events).toEqual([
      'persist',
      'tracking:stop',
      'restore',
      'writable:true',
      'tracking:start'
    ])
  })

  test('keeps a newer authority head when a stale browser seeds and attempts to save', async () => {
    const events: string[] = []
    const newerObjectId = 'agent-created-at-revision-12'
    const staleObjectId = 'stale-browser-seed'
    const authority = {
      contentHash: 'authority-head-12',
      objectIds: [newerObjectId],
      revision: 12
    }
    let browser = {
      baseContentHash: 'authority-head-11',
      baseRevision: 11,
      objectIds: [staleObjectId],
      sceneVersion: 2
    }
    let writable = true
    const synchronizer = createLocalWorkspaceAuthorityHeadSynchronizer({
      canResumeWriting: () => true,
      canSynchronize: () => true,
      canWrite: () => writable,
      currentSceneVersion: () => browser.sceneVersion,
      persist: async () => {
        events.push(`save:${browser.baseRevision}->${authority.revision}`)
        if (
          browser.baseRevision !== authority.revision ||
          browser.baseContentHash !== authority.contentHash
        ) {
          events.push('save:rejected-stale-base')
          return false
        }
        authority.revision += 1
        authority.contentHash = `authority-head-${authority.revision}`
        authority.objectIds = [...browser.objectIds]
        return true
      },
      restore: async () => {
        events.push(`restore:${authority.revision}`)
        browser = {
          baseContentHash: authority.contentHash,
          baseRevision: authority.revision,
          objectIds: [...authority.objectIds],
          sceneVersion: browser.sceneVersion + 1
        }
        return true
      },
      setWritable: (value) => {
        writable = value
        events.push(`writable:${value}`)
      },
      startTracking: () => events.push('tracking:start'),
      stopTracking: () => events.push('tracking:stop')
    })
    synchronizer.acknowledge(1)

    await expect(synchronizer.synchronize()).resolves.toBe(true)

    expect(events).toEqual([
      'save:11->12',
      'save:rejected-stale-base',
      'tracking:stop',
      'restore:12',
      'writable:true',
      'tracking:start'
    ])
    expect(authority).toEqual({
      contentHash: 'authority-head-12',
      objectIds: [newerObjectId],
      revision: 12
    })
    expect(browser).toMatchObject({
      baseContentHash: 'authority-head-12',
      baseRevision: 12,
      objectIds: [newerObjectId]
    })
    expect(browser.objectIds).not.toContain(staleObjectId)
  })

  test('rejects a real stale browser seed/save and hydrates the newer authority graph', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-stale-browser-'))
    try {
      const workspaceId = 'workspace-stale-browser'
      const store = new LocalWorkspaceAuthorityStore({
        preferredWorkspaceId: workspaceId,
        root
      })
      const browser = createEditorStore()
      browser.setViewportSize(1200, 800)
      markAsAuthorityDocument(browser)
      const initialized = await store.initialize({
        document: serializedAuthorityDocument(browser),
        requestId: 'seed-browser-baseline',
        sourceWorkspaceId: workspaceId
      })
      const browserBase = {
        contentHash: initialized.contentHash,
        revision: initialized.appliedRevision
      }
      const acknowledgedSceneVersion = browser.state.sceneVersion

      const agent = createEditorStore()
      agent.setViewportSize(1200, 800)
      await expect(
        applySmylrProductionDocument(agent, serializedAuthorityDocument(browser))
      ).resolves.toBe(true)
      const agentMarkerId = createMarker(agent, 'Agent object at newer authority head')
      const agentReceipt = await store.commit({
        document: serializedAuthorityDocument(agent),
        expectedContentHash: browserBase.contentHash,
        expectedRevision: browserBase.revision,
        requestId: 'agent-commit-newer-head',
        workspaceId
      })
      const staleMarkerId = createMarker(browser, 'Stale browser local object')
      expect(browser.state.sceneVersion).toBeGreaterThan(acknowledgedSceneVersion)

      const events: string[] = []
      let writable = true
      let restoredBase = browserBase
      const synchronizer = createLocalWorkspaceAuthorityHeadSynchronizer({
        canResumeWriting: () => true,
        canSynchronize: () => true,
        canWrite: () => writable,
        currentSceneVersion: () => browser.state.sceneVersion,
        persist: async () => {
          const staleDocument = serializedAuthorityDocument(browser)
          try {
            await store.initialize({
              document: staleDocument,
              requestId: 'stale-browser-reseed',
              sourceWorkspaceId: workspaceId
            })
          } catch (error) {
            events.push(
              error instanceof LocalWorkspaceAuthorityStoreError
                ? `seed:${error.code}`
                : 'seed:error'
            )
          }
          try {
            await store.commit({
              document: staleDocument,
              expectedContentHash: browserBase.contentHash,
              expectedRevision: browserBase.revision,
              requestId: 'stale-browser-save',
              workspaceId
            })
          } catch (error) {
            events.push(
              error instanceof LocalWorkspaceAuthorityStoreError
                ? `save:${error.code}`
                : 'save:error'
            )
            return false
          }
          return true
        },
        restore: async () => {
          const head = await store.head()
          if (!head) return false
          events.push(`restore:${head.revision}`)
          const restored = await applySmylrProductionDocument(browser, head.document)
          if (restored) {
            restoredBase = { contentHash: head.contentHash, revision: head.revision }
          }
          return restored
        },
        setWritable: (value) => {
          writable = value
          events.push(`writable:${value}`)
        },
        startTracking: () => events.push('tracking:start'),
        stopTracking: () => events.push('tracking:stop')
      })
      synchronizer.acknowledge(acknowledgedSceneVersion)

      await expect(synchronizer.synchronize()).resolves.toBe(true)

      expect(events).toEqual([
        'seed:already_initialized',
        'save:stale_revision',
        'tracking:stop',
        `restore:${agentReceipt.appliedRevision}`,
        'writable:true',
        'tracking:start'
      ])
      const preservedHead = await store.head()
      expect(preservedHead).toMatchObject({
        contentHash: agentReceipt.contentHash,
        revision: agentReceipt.appliedRevision
      })
      expect(browser.graph.getNode(agentMarkerId)?.name).toBe(
        'Agent object at newer authority head'
      )
      expect(browser.graph.getNode(staleMarkerId)).toBeUndefined()

      const postHydrationMarkerId = createMarker(browser, 'Browser edit after hydration')
      const postHydrationReceipt = await store.commit({
        document: serializedAuthorityDocument(browser),
        expectedContentHash: restoredBase.contentHash,
        expectedRevision: restoredBase.revision,
        requestId: 'browser-save-after-hydration',
        workspaceId
      })
      const finalHead = await store.head()
      if (!finalHead) throw new Error('Expected the final authority head')
      const finalBrowser = createEditorStore()
      finalBrowser.setViewportSize(1200, 800)
      await expect(applySmylrProductionDocument(finalBrowser, finalHead.document)).resolves.toBe(
        true
      )
      expect(postHydrationReceipt).toMatchObject({
        appliedRevision: agentReceipt.appliedRevision + 1,
        baseRevision: agentReceipt.appliedRevision
      })
      expect(finalBrowser.graph.getNode(agentMarkerId)?.name).toBe(
        'Agent object at newer authority head'
      )
      expect(finalBrowser.graph.getNode(postHydrationMarkerId)?.name).toBe(
        'Browser edit after hydration'
      )
      expect(finalBrowser.graph.getNode(staleMarkerId)).toBeUndefined()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('skips duplicate preservation and stays read-only when restore fails', async () => {
    const fixture = synchronizerFixture()
    fixture.touch()
    fixture.setRestoreResult(false)

    await expect(fixture.synchronizer.synchronize(true)).resolves.toBe(false)
    expect(fixture.events).toEqual(['tracking:stop', 'restore', 'writable:false'])
  })
})
