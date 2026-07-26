import { afterEach, describe, expect, test } from 'bun:test'

import {
  MERMAID_DIAGRAM_REVISION,
  MERMAID_PARSER,
  type MermaidDiagram
} from '@open-pencil/core/diagram'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import {
  createAutomationMermaidHandler,
  createAutomationMermaidSourceHandler
} from '@/app/automation/bridge/mermaid-handler'
import { resetAutomationMutationQueuesForTests } from '@/app/automation/bridge/mutation-queue'
import { isAutomationClientActive } from '@/app/automation/bridge/server'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { syncAutomationToolState } from '@/app/automation/bridge/tool-handlers'
import { handleTraceQuery } from '@/app/automation/bridge/trace-handler'
import { createEditorStore } from '@/app/editor/session'
import { resolveSidebarWorkspace } from '@/app/sidebar-workspace/tree'

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'window')
})

function installWindowFixture() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: 800, innerWidth: 1200 }
  })
}

function mermaidFixture(source: string): Promise<MermaidDiagram> {
  return Promise.resolve({
    appearance: 'light',
    elements: [
      {
        backgroundColor: '#ffffff',
        height: 60,
        id: 'flow-node',
        strokeColor: '#1b1b1f',
        type: 'rectangle',
        width: 160,
        x: 0,
        y: 0
      }
    ],
    files: {},
    parser: MERMAID_PARSER,
    revision: MERMAID_DIAGRAM_REVISION,
    source
  })
}

function automationTarget(store: ReturnType<typeof createEditorStore>): AutomationTarget {
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  return {
    documentId: 'tab-test',
    documentName: 'Automation test',
    pageId,
    pageName: page?.name ?? 'Page 1',
    store
  }
}

describe('OpenPencil automation bridge state synchronization', () => {
  test('does not route automation to an unfocused hidden page', () => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        hasFocus: () => false,
        visibilityState: 'hidden'
      }
    })

    expect(isAutomationClientActive()).toBe(false)
  })

  test('commits FigmaAPI page and selection changes to the live editor store', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const figma = makeFigmaFromStore(store)
    const page = figma.createPage()
    page.name = 'Diagram Studio'
    figma.currentPage = page
    const frame = figma.createFrame()
    frame.name = 'Flow Examples'
    frame.resize(1800, 1100)
    figma.currentPage.appendChild(frame)
    figma.currentPage.selection = [frame]

    await syncAutomationToolState(store, figma, 'select_nodes', { selected: [frame.id] })

    expect(store.state.currentPageId).toBe(page.id)
    expect([...store.state.selectedIds]).toEqual([frame.id])
  })

  test('commits viewport zoom-to-fit bounds to the live editor viewport', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const frame = store.graph.createNode('FRAME', pageId, {
      height: 1100,
      name: 'Flow Examples',
      width: 1800,
      x: 1950,
      y: 0
    })
    const figma = makeFigmaFromStore(store)

    await syncAutomationToolState(store, figma, 'viewport_zoom_to_fit', {
      bounds: { height: frame.height, width: frame.width, x: frame.x, y: frame.y }
    })

    expect(store.state.zoom).toBeLessThan(1)
    expect(store.state.panX).toBeLessThan(0)
    expect(store.state.panY).toBeGreaterThan(0)
  })
})

describe('OpenPencil Mermaid automation', () => {
  test('creates beside the exact singleton anchor with attributable readback and one-step Undo', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 100, 80)
    store.select([anchorId])
    const insert = createAutomationMermaidHandler(mermaidFixture)

    const created = (await insert(target, {
      anchor_id: anchorId,
      mutation: {
        expectedRevision: store.state.sceneVersion,
        requestId: 'request-grounded',
        taskId: 'task-grounded',
        traceId: 'trace-grounded'
      },
      source: 'flowchart LR\n Intent --> Artifact',
      zoom_to_selection: false
    })) as {
      result: {
        mutation_receipt: {
          requestId: string
          status: string
          taskId: string
          traceId: string
        }
        owner_id: string
        position: Vector
        readback: {
          owner_id: string
          reconciliation: { status: string }
          source: string
        }
      }
    }

    expect(created.result).toMatchObject({
      mutation_receipt: {
        requestId: 'request-grounded',
        status: 'applied',
        taskId: 'task-grounded',
        traceId: 'trace-grounded'
      },
      position: { x: 236, y: 60 },
      readback: {
        owner_id: created.result.owner_id,
        reconciliation: { status: 'current' },
        source: 'flowchart LR\n Intent --> Artifact'
      }
    })
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([
      anchorId,
      created.result.owner_id
    ])
    expect(store.undo.undo()).toBe('Insert Mermaid diagram')
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([anchorId])
  })

  test('rejects stale Board revision without creating a Mermaid owner', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const insert = createAutomationMermaidHandler(mermaidFixture)
    const existingId = store.createShape('RECTANGLE', 20, 20, 80, 60)

    const rejected = (await insert(target, {
      mutation: {
        expectedRevision: store.state.sceneVersion - 1,
        requestId: 'request-stale'
      },
      source: 'flowchart LR\n Stale --> Rejected',
      x: 48,
      y: 72,
      zoom_to_selection: false
    })) as {
      result: {
        applied: boolean
        mutation_receipt: { reason: string; requestId: string; status: string }
      }
    }

    expect(rejected.result).toEqual({
      applied: false,
      mutation_receipt: expect.objectContaining({
        reason: 'stale_board_revision',
        requestId: 'request-stale',
        status: 'rejected'
      })
    })
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([existingId])
  })

  test('rejects when the pinned selection changes before creation executes', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 100, 80)
    const otherId = store.createShape('RECTANGLE', 260, 60, 100, 80)
    store.select([anchorId])
    let releaseParse: (() => void) | undefined
    const insert = createAutomationMermaidHandler(
      (source) =>
        new Promise((resolve) => {
          releaseParse = () => {
            void mermaidFixture(source).then(resolve)
          }
        })
    )

    const pending = insert(target, {
      anchor_id: anchorId,
      source: 'flowchart LR\n Anchor --> Flow',
      zoom_to_selection: false
    })
    store.select([otherId])
    releaseParse?.()

    await expect(pending).rejects.toThrow('must remain the singleton selection')
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([anchorId, otherId])
  })

  test('creates a Mermaid owner on an empty current board with paired coordinates', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const insert = createAutomationMermaidHandler(mermaidFixture)

    const created = (await insert(target, {
      source: 'flowchart LR\n Empty --> Board',
      x: 48,
      y: 72,
      zoom_to_selection: false
    })) as {
      result: { operation: string; owner_id: string; position: Vector }
    }

    expect(created.result).toMatchObject({
      operation: 'created',
      position: { x: 48, y: 72 }
    })
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([created.result.owner_id])
  })

  test('reuses the default Mermaid project across named boards', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const insert = createAutomationMermaidHandler(mermaidFixture)

    await insert(target, {
      board_name: 'Product Map',
      source: 'flowchart LR\n A --> B',
      x: 0,
      y: 0
    })
    await insert(target, {
      board_name: 'Technical Flow',
      source: 'flowchart LR\n C --> D',
      x: 0,
      y: 0
    })

    const workspace = resolveSidebarWorkspace(store.graph).workspace
    const projects = workspace.pages.filter((page) => page.name === 'Mermaid diagrams')
    expect(projects).toHaveLength(1)
    expect(workspace.boards.filter((board) => board.parentPageId === projects[0]?.id)).toHaveLength(
      2
    )
  })

  test('rejects an ownerless insert on a populated board with actionable owner IDs', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const insert = createAutomationMermaidHandler(mermaidFixture)
    const created = (await insert(target, {
      board_name: 'Product Map',
      project_name: 'Maps & Flows',
      source: 'flowchart LR\n Calendar --> Patients',
      x: 120,
      y: 240
    })) as { result: { owner_id: string } }
    const ownerId = created.result.owner_id
    const pageId = target.pageId

    let thrown: unknown
    try {
      await insert(target, {
        board_name: 'Product Map',
        project_name: 'Maps & Flows',
        source: 'flowchart LR\n Patients --> Dental',
        x: 420,
        y: 240
      })
    } catch (error) {
      thrown = error
    }

    if (!(thrown instanceof Error)) throw new Error('Expected duplicate-owner insertion to fail.')
    expect(thrown.message).toContain(ownerId)
    expect(thrown.message).toContain('owner_id')
    expect(thrown.message).toContain('allow_additional_owner: true')
    expect(store.graph.getNode(pageId)?.childIds).toEqual([ownerId])
  })

  test('allows an intentional second Mermaid owner with explicit opt-in', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const insert = createAutomationMermaidHandler(mermaidFixture)
    const first = (await insert(target, {
      board_name: 'Product Map',
      project_name: 'Maps & Flows',
      source: 'flowchart LR\n Calendar --> Patients',
      x: 120,
      y: 240
    })) as { result: { owner_id: string } }

    const second = (await insert(target, {
      allow_additional_owner: true,
      board_name: 'Product Map',
      project_name: 'Maps & Flows',
      source: 'flowchart LR\n Patients --> Dental',
      x: 420,
      y: 240
    })) as {
      result: { operation: string; owner_id: string; position: Vector }
    }

    expect(second.result).toMatchObject({
      operation: 'created',
      position: { x: 420, y: 240 }
    })
    expect(second.result.owner_id).not.toBe(first.result.owner_id)
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([
      first.result.owner_id,
      second.result.owner_id
    ])
  })

  test('updates one Mermaid owner and reports live source reconciliation', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const insert = createAutomationMermaidHandler(mermaidFixture)
    const readSource = createAutomationMermaidSourceHandler()
    const created = (await insert(target, {
      board_name: 'Technical Flow — Save Finding',
      project_name: 'Maps & Flows',
      source: 'flowchart LR\n UI --> Service',
      x: 120,
      y: 240
    })) as {
      result: { node_ids: string[]; operation: string; owner_id: string }
    }
    const ownerId = created.result.owner_id

    const updated = (await insert(target, {
      board_name: 'Technical Flow — Save Finding',
      owner_id: ownerId,
      project_name: 'Maps & Flows',
      source: 'flowchart LR\n UI --> Service --> Store'
    })) as {
      result: { node_ids: string[]; operation: string; owner_id: string; position: Vector }
    }

    expect(updated.result).toMatchObject({
      operation: 'updated',
      owner_id: ownerId,
      position: { x: 120, y: 240 }
    })
    const page = store.graph.getNode(target.pageId)
    expect(page?.childIds).toEqual([ownerId])

    const current = (await readSource(target, { owner_id: ownerId })) as {
      result: {
        editable_layers: number
        reconciliation: { status: string }
        source: string
      }
    }
    expect(current.result).toMatchObject({
      editable_layers: updated.result.node_ids.length,
      reconciliation: { status: 'current' },
      source: 'flowchart LR\n UI --> Service --> Store'
    })
    const attachedPageChildIds = [...(page?.childIds ?? [])]
    store.graph.updateNode(target.pageId, {
      childIds: attachedPageChildIds.filter((id) => id !== ownerId)
    })
    await expect(readSource(target, { owner_id: ownerId })).rejects.toThrow(
      `Mermaid owner "${ownerId}" was not found`
    )
    store.graph.updateNode(target.pageId, { childIds: attachedPageChildIds })

    expect(store.undo.undo()).toBe('Update Mermaid diagram')
    expect(
      (
        (await readSource(target, { owner_id: ownerId })) as {
          result: { source: string }
        }
      ).result.source
    ).toBe('flowchart LR\n UI --> Service')
    expect(store.undo.redo()).toBe('Update Mermaid diagram')
    expect(
      (
        (await readSource(target, { owner_id: ownerId })) as {
          result: { source: string }
        }
      ).result.source
    ).toBe('flowchart LR\n UI --> Service --> Store')

    const childId = updated.result.node_ids[0]
    if (!childId) throw new Error('Expected native Mermaid child')
    const child = store.graph.getNode(childId)
    if (!child) throw new Error('Expected native Mermaid node')
    store.graph.updateNode(childId, { width: child.width + 16 })
    const changed = (await readSource(target, { owner_id: ownerId })) as {
      result: { reconciliation: { status: string } }
    }
    expect(changed.result.reconciliation.status).toBe('unsupported')

    await expect(
      insert(target, {
        board_name: 'Technical Flow — Save Finding',
        owner_id: ownerId,
        project_name: 'Maps & Flows',
        source: 'flowchart LR\n UI --> Replacement'
      })
    ).rejects.toThrow('source reconciliation is "unsupported"')
    expect(
      (
        (await readSource(target, { owner_id: ownerId })) as {
          result: { source: string }
        }
      ).result.source
    ).toBe('flowchart LR\n UI --> Service --> Store')
  })
})

describe('OpenPencil Trace automation', () => {
  test('adapts the existing Trace query to the standard bridge envelope', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)

    const response = await handleTraceQuery(target, { query: 'recovery flow' }, async () => ({
      matches: [],
      scanned: { indexCandidates: 0, sessions: 0 },
      status: 'empty'
    }))

    expect(response).toEqual({
      ok: true,
      result: {
        matches: [],
        scanned: { indexCandidates: 0, sessions: 0 },
        status: 'empty'
      }
    })
  })
})
