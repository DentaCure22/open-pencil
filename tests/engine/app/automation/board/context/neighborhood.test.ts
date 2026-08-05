import { describe, expect, test } from 'bun:test'

import type { Rect, SceneNode } from '@open-pencil/scene-graph'

import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import {
  BOARD_CONTEXT_STRING_SCAN_CODE_UNIT_LIMIT,
  BOARD_CONTEXT_BYTE_LIMIT,
  BOARD_NEIGHBORHOOD_BYTE_LIMIT,
  BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT,
  boardNeighborhoodSnapshot,
  jsonUtf8ByteLength,
  pageOwnedAncestorId,
  utf8ByteLength
} from '@/app/automation/bridge/board-tools/neighborhood'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

const RUNTIME_ID = 'runtime:board-context-neighborhood-test'

function automationTarget(store: ReturnType<typeof createEditorStore>): AutomationTarget {
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  return {
    contentDocumentId: 'content-document:board-context-neighborhood',
    documentId: 'board-context-neighborhood-document',
    documentName: 'Board context neighborhood document',
    pageId,
    pageName: page?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:board-context-neighborhood'
  }
}

type NeighborhoodNode = {
  child_count: number
  child_ids_omitted: number
  distance_from_focus: number
  id: string
  name: string
  name_omitted_bytes: number | null
  name_omitted_code_units: number
  name_scan_truncated: boolean
  name_truncated: boolean
  text_preview?: string
  text_preview_omitted_bytes?: number | null
  text_preview_omitted_code_units?: number
  text_preview_scan_truncated?: boolean
  text_truncated?: boolean
}

type PayloadOmitted = {
  child_ids: number
  name_bytes: number | null
  name_code_units: number
  nodes: number
  text_bytes: number | null
  text_code_units: number
  unscanned_page_root_children?: number
}

type Neighborhood = {
  basis: 'selection' | 'viewport'
  byte_limit: number
  focus_bounds: Rect
  limit: number
  nodes: NeighborhoodNode[]
  omitted: PayloadOmitted
  page_owned_candidate_count: number
  page_owned_candidate_count_exact: boolean
  page_root_scan: {
    child_count: number
    limit: number
    sampled: number
    selected_owner_supplements: number
    strategy: string
    unscanned: number
  }
  payload_bytes: number
  policy: string
  returned: number
  string_limits: { name_bytes: number; scan_code_units: number; text_preview_bytes: number }
  truncated: boolean
}

type SelectionSummary = {
  byte_limit: number
  count: number
  limit: number
  omitted: PayloadOmitted
  payload_bytes: number
  returned: number
  truncated: boolean
}

type ContextResult = {
  context_payload: {
    byte_limit: number
    omitted: {
      neighborhood_nodes: number
      neighborhood_unscanned_page_root_children: number
      selection_nodes: number
      target_string_bytes: number | null
      target_string_code_units: number
    }
    payload_bytes: number
    truncated: boolean
  }
  context_token: string
  neighborhood: Neighborhood
  selection: Array<NeighborhoodNode & { missing?: boolean }>
  selection_summary: SelectionSummary
}

function contextResult(value: unknown): ContextResult {
  return value as ContextResult
}

function expectHardPayloadBounds(context: ContextResult) {
  expect(context.neighborhood.payload_bytes).toBe(jsonUtf8ByteLength(context.neighborhood))
  expect(context.neighborhood.payload_bytes).toBeLessThanOrEqual(BOARD_NEIGHBORHOOD_BYTE_LIMIT)
  expect(context.context_payload.payload_bytes).toBe(jsonUtf8ByteLength(context))
  expect(context.context_payload.payload_bytes).toBeLessThanOrEqual(BOARD_CONTEXT_BYTE_LIMIT)
  expect(context.selection_summary.payload_bytes).toBe(
    jsonUtf8ByteLength({
      selection: context.selection,
      selection_summary: context.selection_summary
    })
  )
}

describe('OpenPencil Board context neighborhood', () => {
  test('returns the selected owner and nearest page-owned objects within hard byte bounds', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    const ownerId = store.createShape('FRAME', 100, 100, 300, 200)
    store.updateNodeWithUndo(ownerId, { name: 'Selected owner' }, 'Name owner')
    const selectedChildId = store.createShape('TEXT', 20, 20, 80, 30, ownerId)
    store.updateNodeWithUndo(
      selectedChildId,
      { name: 'Nested selection', text: 'Nested selected text' },
      'Name selected child'
    )
    const boundedTextId = store.createShape('TEXT', 420, 100, 120, 40)
    store.updateNodeWithUndo(
      boundedTextId,
      { name: '界'.repeat(200), text: '😀'.repeat(200) },
      'Create bounded context fixture'
    )
    for (let index = 0; index < 13; index++) {
      store.createShape('RECTANGLE', 600 + index * 100, 100, 80, 60)
    }
    const hiddenId = store.createShape('RECTANGLE', 410, 100, 80, 60)
    store.updateNodeWithUndo(hiddenId, { visible: false }, 'Hide context fixture')
    store.select([selectedChildId])

    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))
    const repeated = contextResult(await handlers.context(target))

    expect(context.neighborhood).toMatchObject({
      basis: 'selection',
      byte_limit: BOARD_NEIGHBORHOOD_BYTE_LIMIT,
      focus_bounds: { height: 30, width: 80, x: 120, y: 120 },
      limit: 12,
      page_owned_candidate_count: 15,
      page_owned_candidate_count_exact: true,
      page_root_scan: {
        child_count: 16,
        limit: BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT,
        sampled: 16,
        selected_owner_supplements: 0,
        strategy: 'evenly-spaced-plus-selected/v1',
        unscanned: 0
      },
      policy: 'bounded-nearest-page-owned/v2',
      returned: 12,
      string_limits: {
        name_bytes: 256,
        scan_code_units: BOARD_CONTEXT_STRING_SCAN_CODE_UNIT_LIMIT,
        text_preview_bytes: 512
      },
      truncated: true
    })
    expect(context.neighborhood.nodes[0]).toMatchObject({
      child_count: 1,
      child_ids_omitted: 1,
      distance_from_focus: 0,
      id: ownerId,
      name: 'Selected owner',
      name_scan_truncated: false,
      name_truncated: false
    })
    expect(context.neighborhood.nodes[1]).toMatchObject({
      child_count: 0,
      id: boundedTextId,
      name: '界'.repeat(85),
      name_omitted_bytes: 345,
      name_omitted_code_units: 115,
      name_scan_truncated: false,
      name_truncated: true,
      text_preview: '😀'.repeat(128),
      text_preview_omitted_bytes: 288,
      text_preview_omitted_code_units: 144,
      text_preview_scan_truncated: false,
      text_truncated: true
    })
    expect(context.neighborhood.nodes.map(({ id }) => id)).not.toContain(selectedChildId)
    expect(context.neighborhood.nodes.map(({ id }) => id)).not.toContain(hiddenId)
    expect(context.neighborhood.nodes.map(({ id }) => id)).toEqual(
      repeated.neighborhood.nodes.map(({ id }) => id)
    )
    expect(context.neighborhood.nodes[0]).not.toHaveProperty('child_ids')
    expect(context.neighborhood.nodes[0]).not.toHaveProperty('pluginData')
    expect(context.neighborhood.nodes[0]).not.toHaveProperty('source')
    expectHardPayloadBounds(context)

    const selectionRead = (await handlers.read(target, {
      context_token: context.context_token,
      scope: 'selection'
    })) as { neighborhood: Neighborhood; nodes: Array<{ id: string }> }
    expect(selectionRead.nodes).toEqual([expect.objectContaining({ id: selectedChildId })])
    expect(selectionRead.neighborhood).toEqual(context.neighborhood)
  })

  test('keeps huge selection text, child IDs, CJK, and emoji inside the total context budget', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    const selectedIds: string[] = []
    for (let index = 0; index < 25; index++) {
      const id = store.createShape('TEXT', index * 140, 100, 120, 40)
      store.graph.updateNode(id, {
        childIds: Array.from(
          { length: 1_000 },
          (_, childIndex) => `synthetic-child:${index}:${childIndex}`
        ),
        name: `对象${index}`.repeat(400),
        text: `😀界${index}`.repeat(2_000)
      })
      selectedIds.push(id)
    }
    store.select(selectedIds)

    const context = contextResult(await createAutomationBoardHandlers(RUNTIME_ID).context(target))

    expect(context.selection_summary.byte_limit).toBe(8_192)
    expect(context.selection_summary.count).toBe(25)
    expect(context.selection_summary.limit).toBe(25)
    expect(context.selection_summary.truncated).toBe(true)
    expect(context.selection_summary.returned).toBeLessThan(25)
    expect(Number.isFinite(context.selection_summary.payload_bytes)).toBe(true)
    expect(Number.isFinite(context.selection_summary.omitted.child_ids)).toBe(true)
    expect(Number.isFinite(context.selection_summary.omitted.name_bytes)).toBe(true)
    expect(Number.isFinite(context.selection_summary.omitted.name_code_units)).toBe(true)
    expect(Number.isFinite(context.selection_summary.omitted.nodes)).toBe(true)
    expect(context.selection_summary.omitted.text_bytes).toBeNull()
    expect(Number.isFinite(context.selection_summary.omitted.text_code_units)).toBe(true)
    expect(context.selection_summary.omitted.child_ids).toBeGreaterThan(0)
    expect(context.neighborhood.returned).toBeLessThanOrEqual(12)
    expect(context.neighborhood.truncated).toBe(true)
    for (const node of [...context.selection, ...context.neighborhood.nodes]) {
      expect(node).not.toHaveProperty('child_ids')
      expect(utf8ByteLength(node.name)).toBeLessThanOrEqual(256)
      if (node.text_preview !== undefined) {
        expect(utf8ByteLength(node.text_preview)).toBeLessThanOrEqual(512)
        expect(node.text_preview.endsWith('\ud83d')).toBe(false)
        expect(node.text_preview_omitted_bytes).toBeNull()
        expect(node.text_preview_scan_truncated).toBe(true)
      }
    }
    expectHardPayloadBounds(context)
  })

  test('bounds preview scanning and reports unknown UTF-8 omissions without guessing', async () => {
    const store = createEditorStore()
    const target = {
      ...automationTarget(store),
      documentName: '界'.repeat(100_000),
      pageName: '😀'.repeat(100_000)
    }
    const selectedId = store.createShape('TEXT', 100, 100, 120, 40)
    store.updateNodeWithUndo(
      selectedId,
      { name: '界'.repeat(100_000), text: '😀'.repeat(100_000) },
      'Create oversized string fixture'
    )
    store.select([selectedId])

    const context = contextResult(await createAutomationBoardHandlers(RUNTIME_ID).context(target))
    const selected = context.selection[0]

    expect(selected?.name_omitted_bytes).toBeNull()
    expect(selected?.name_omitted_code_units).toBeGreaterThan(0)
    expect(selected?.name_scan_truncated).toBe(true)
    expect(selected?.text_preview_omitted_bytes).toBeNull()
    expect(selected?.text_preview_omitted_code_units).toBeGreaterThan(0)
    expect(selected?.text_preview_scan_truncated).toBe(true)
    expect(context.selection_summary.omitted.name_bytes).toBeNull()
    expect(context.selection_summary.omitted.name_code_units).toBeGreaterThan(0)
    expect(context.selection_summary.omitted.text_bytes).toBeNull()
    expect(context.selection_summary.omitted.text_code_units).toBeGreaterThan(0)
    expect(context.context_payload.omitted.target_string_bytes).toBeNull()
    expect(context.context_payload.omitted.target_string_code_units).toBeGreaterThan(0)
    expect(context.context_payload.truncated).toBe(true)
    expectHardPayloadBounds(context)
  })

  test('uses the current viewport when the Board has no selection', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    const visibleId = store.createShape('RECTANGLE', 100, 100, 80, 60)
    const offscreenId = store.createShape('RECTANGLE', 1_200, 100, 80, 60)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)

    const context = contextResult(await handlers.context(target))

    expect(context.neighborhood).toMatchObject({
      basis: 'viewport',
      focus_bounds: { height: 600, width: 800, x: 0, y: 0 },
      page_owned_candidate_count: 2,
      page_owned_candidate_count_exact: true,
      returned: 2,
      truncated: false
    })
    expect(context.neighborhood.nodes.map(({ id }) => id)).toEqual([visibleId, offscreenId])
    expect(context.neighborhood.nodes[0]?.distance_from_focus).toBe(0)
    expect(context.neighborhood.nodes[1]?.distance_from_focus).toBe(400)
    expectHardPayloadBounds(context)
  })

  test('caps page-root candidate work and supplements a selected owner outside the sample', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    const rootIds: string[] = []
    for (let index = 0; index < BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT + 9; index++) {
      rootIds.push(store.createShape('RECTANGLE', index * 20, 100, 12, 12))
    }
    const sampledIndexes = new Set(
      Array.from({ length: BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT }, (_, index) =>
        Math.floor((index * (rootIds.length - 1)) / (BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT - 1))
      )
    )
    const selectedIndex = rootIds.findIndex((_, index) => !sampledIndexes.has(index))
    const selectedId = rootIds[selectedIndex]
    expect(selectedId).toBeDefined()
    if (!selectedId) throw new Error('Expected one unsampled page-root fixture.')
    store.select([selectedId])
    const rootIdSet = new Set(rootIds)
    const inspectedRootIds = new Set<string>()
    const originalGetNode = store.graph.getNode.bind(store.graph)
    store.graph.getNode = (id: string) => {
      if (rootIdSet.has(id)) inspectedRootIds.add(id)
      return originalGetNode(id)
    }

    const readNeighborhood = () => {
      try {
        return boardNeighborhoodSnapshot(target, [selectedId])
      } finally {
        store.graph.getNode = originalGetNode
      }
    }
    const neighborhood = readNeighborhood()
    const context = contextResult(await createAutomationBoardHandlers(RUNTIME_ID).context(target))

    expect(neighborhood.page_root_scan).toEqual({
      child_count: rootIds.length,
      limit: BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT,
      sampled: BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT,
      selected_owner_supplements: 1,
      strategy: 'evenly-spaced-plus-selected/v1',
      unscanned: 8
    })
    expect(neighborhood.page_owned_candidate_count).toBe(
      BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT + 1
    )
    expect(neighborhood.page_owned_candidate_count_exact).toBe(false)
    expect(inspectedRootIds.size).toBeLessThanOrEqual(BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT + 1)
    expect(neighborhood.nodes[0]?.id).toBe(selectedId)
    expect(neighborhood.omitted.unscanned_page_root_children).toBe(8)
    expect(context.context_payload.omitted.neighborhood_unscanned_page_root_children).toBe(8)
    expect(context.neighborhood.truncated).toBe(true)
    expectHardPayloadBounds(context)
  })

  test('bounds deep and cyclic page-owner ancestry walks', () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    let parentId = store.createShape('FRAME', 0, 0, 100, 100)
    for (let depth = 0; depth < 64; depth++) {
      parentId = store.createShape('FRAME', 0, 0, 100, 100, parentId)
    }
    expect(pageOwnedAncestorId(target, parentId)).toBeNull()

    const cycleParentId = store.createShape('FRAME', 200, 0, 100, 100)
    const cycleChildId = store.createShape('FRAME', 0, 0, 80, 80, cycleParentId)
    const cycleParent = store.graph.getNode(cycleParentId)
    const cycleChild = store.graph.getNode(cycleChildId)
    expect(cycleParent).toBeDefined()
    expect(cycleChild).toBeDefined()
    const cycleNodes = new Map<string, SceneNode>([
      [cycleParentId, { ...cycleParent, parentId: cycleChildId } as SceneNode],
      [cycleChildId, { ...cycleChild, parentId: cycleParentId } as SceneNode]
    ])
    const originalGetNode = store.graph.getNode.bind(store.graph)
    store.graph.getNode = (id: string) => cycleNodes.get(id) ?? originalGetNode(id)
    try {
      expect(pageOwnedAncestorId(target, cycleChildId)).toBeNull()
    } finally {
      store.graph.getNode = originalGetNode
    }
  })
})
