import {
  CODE_OBJECT_MODALITY_DEFINITIONS,
  type CodeObjectModality as CoreCodeObjectModality
} from '@open-pencil/core/code-object'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { BOARD_SHAPE_PERMISSIONS } from '@/app/board-permissions'
import type { EditorStore } from '@/app/editor/active-store'
import { editorViewportInsets } from '@/app/editor/viewport-insets'

import {
  createOfficeDocumentDocument,
  createOfficeSpreadsheetDocument,
  normalizeOfficeDocumentState,
  normalizeOfficeSpreadsheetState,
  normalizePdfDocumentState,
  normalizePptxDeckState,
  type OfficeDocumentDocument,
  type OfficeSpreadsheetDocument,
  type PdfDocumentDocument,
  type PptxDeckDocument
} from './artifact-documents'
import {
  normalizeSmylrFlowScreenState,
  type AgentConversationTerminalDocument,
  type ExternalLiveSurfaceDocument,
  type SmylrFlowScreenDocument,
  type SmylrProductionAppDocument
} from './connected-surfaces'
import { codeObjectDocument, codeObjectPluginData } from './document-persistence'
import { createFinancialDashboardDocument, FINANCIAL_DASHBOARD_PRESET } from './financial-dashboard'
import {
  createEarthSignalsDocument,
  createOrbitLabDocument,
  createSignalBloomDocument,
  createUserCodeObjectDocument,
  normalizeCodeStarterState,
  normalizeEarthSignalsState,
  normalizeOrbitLabState,
  normalizeSignalBloomState,
  type CodeStarterDocument,
  type EarthSignalsDocument,
  type OrbitLabDocument,
  type SignalBloomDocument,
  type UserCodeObjectDocument
} from './interactive-documents'
import {
  createOpenSourceWorkspaceDocument,
  createOpenSourceWorkspaceKitDefinition,
  normalizeOpenSourceWorkspaceState,
  type OpenSourceWorkspaceDocument
} from './open-source-workspace'
import {
  ANALYTICS_CHART_SOURCE,
  BOARD_REMOTE_SOURCE,
  INTERACTIVE_FORM_SOURCE
} from './saved-sources'

export { CODE_OBJECT_SCHEMA_VERSION } from '@open-pencil/core/code-object'
export {
  createOfficeDocumentDocument,
  createOfficeSpreadsheetDocument,
  createPdfDocumentDocument,
  createPptxDeckDocument
} from './artifact-documents'
export {
  createAgentConversationTerminalDocument,
  createExternalLiveSurfaceDocument,
  createSmylrFlowScreenDocument,
  createSmylrProductionAppDocument,
  defaultSmylrFlowScreenState
} from './connected-surfaces'
export type {
  AgentConversationTerminalDocument,
  ExternalLiveSurfaceDocument,
  ExternalLiveSurfaceState,
  SmylrFlowScreenDocument,
  SmylrFlowScreenState,
  SmylrProductionAppDocument,
  SmylrProductionAppState,
  TrustedWebAppLaunchMetadata
} from './connected-surfaces'
export type {
  OfficeDocumentDocument,
  OfficeDocumentState,
  OfficeSpreadsheetCell,
  OfficeSpreadsheetDocument,
  OfficeSpreadsheetState,
  PdfDocumentDocument,
  PdfDocumentState,
  PptxDeckDocument,
  PptxDeckState
} from './artifact-documents'
export {
  codeObjectDocument,
  codeObjectPluginData,
  isCodeObjectFrame,
  materializeCodeObjectDocument,
  setCodeObjectDocument
} from './document-persistence'
export {
  createCodeStarterDocument,
  createEarthSignalsDocument,
  createOrbitLabDocument,
  createSignalBloomDocument,
  createUserCodeObjectDocument,
  DEFAULT_CODE_OBJECT_SOURCE
} from './interactive-documents'
export type {
  CodeStarterDocument,
  CodeStarterState,
  EarthSignalsDocument,
  EarthSignalsState,
  OrbitLabDocument,
  OrbitLabState,
  SignalBloomDocument,
  SignalBloomState,
  UserCodeObjectDocument,
  UserCodeObjectProps,
  UserCodeObjectState
} from './interactive-documents'
export { createOpenSourceWorkspaceDocument } from './open-source-workspace'
export type {
  OpenSourceArchitectureEdge,
  OpenSourceArchitectureNode,
  OpenSourceKanbanColumn,
  OpenSourceKanbanTask,
  OpenSourceWorkspaceDocument,
  OpenSourceWorkspaceState
} from './open-source-workspace'

export type CodeObjectDocument =
  | AgentConversationTerminalDocument
  | CodeStarterDocument
  | UserCodeObjectDocument
  | EarthSignalsDocument
  | OrbitLabDocument
  | SignalBloomDocument
  | OpenSourceWorkspaceDocument
  | OfficeDocumentDocument
  | OfficeSpreadsheetDocument
  | PptxDeckDocument
  | PdfDocumentDocument
  | ExternalLiveSurfaceDocument
  | SmylrFlowScreenDocument
  | SmylrProductionAppDocument
export type CodeObjectState = CodeObjectDocument['state']
export type CodeObjectPresetId =
  | Exclude<
      CodeObjectDocument['component'],
      | 'code-starter'
      | 'external-live-surface'
      | 'pdf-document'
      | 'pptx-deck'
      | 'smylr-flow-screen'
      | 'smylr-production-app'
    >
  | 'analytics-chart'
  | 'board-remote'
  | 'financial-dashboard'
  | 'interactive-form'

export type CreateCodeObjectInput = {
  cornerRadius?: number
  document: CodeObjectDocument
  height: number
  name: string
  parentId?: string
  width: number
  x?: number
  y?: number
}

export type CodeObjectPreset = {
  cornerRadius: number
  description: string
  height: number
  id: CodeObjectPresetId
  label: string
  modality: CodeObjectModality
  width: number
}

export type CodeObjectModality = CoreCodeObjectModality

export type CodeObjectModalityDefinition = {
  description: string
  id: CodeObjectModality
  label: string
}

export type CodeObjectPresetGroup = {
  modality: CodeObjectModalityDefinition
  presets: readonly CodeObjectPreset[]
}

export const CODE_OBJECT_MODALITIES = CODE_OBJECT_MODALITY_DEFINITIONS

export const CODE_OBJECT_PRESETS = [
  {
    cornerRadius: 12,
    description: 'A TypeScript/TSX Code Object with persisted interactive state',
    height: 520,
    id: 'user-code',
    label: 'Code Object',
    modality: 'custom',
    width: 720
  },
  {
    cornerRadius: 12,
    description: 'A Code Object that creates and controls ordinary native board shapes',
    height: 500,
    id: 'board-remote',
    label: 'Board remote',
    modality: 'board-tool',
    width: 560
  },
  {
    cornerRadius: 0,
    description: 'A draggable three-dimensional signal globe',
    height: 760,
    id: 'earth-signals',
    label: 'Earth signals',
    modality: 'visual-experience',
    width: 760
  },
  {
    cornerRadius: 0,
    description: 'A kinetic orbital instrument with adjustable energy',
    height: 600,
    id: 'orbit-lab',
    label: 'Orbit lab',
    modality: 'visual-experience',
    width: 720
  },
  {
    cornerRadius: 0,
    description: 'A responsive color bloom you can shape and freeze',
    height: 640,
    id: 'signal-bloom',
    label: 'Signal bloom',
    modality: 'visual-experience',
    width: 640
  },
  {
    cornerRadius: 0,
    description: 'Frameless OpenArchFlow architecture and OpenSail Kanban surfaces',
    height: 620,
    id: 'open-source-workspace',
    label: 'Architecture + Kanban',
    modality: 'board-tool',
    width: 2440
  },
  {
    cornerRadius: 8,
    description: 'A focused document editor powered by the Apache-2.0 Univer runtime',
    height: 900,
    id: 'office-document',
    label: 'Document',
    modality: 'document',
    width: 760
  },
  {
    cornerRadius: 8,
    description: 'A formula-ready spreadsheet powered by the Apache-2.0 Univer runtime',
    height: 720,
    id: 'office-spreadsheet',
    label: 'Spreadsheet',
    modality: 'document',
    width: 1120
  },
  {
    cornerRadius: 12,
    description: 'A frame-owned TSX chart with persisted range controls',
    height: 520,
    id: 'analytics-chart',
    label: 'Chart',
    modality: 'data-interface',
    width: 720
  },
  FINANCIAL_DASHBOARD_PRESET,
  {
    cornerRadius: 12,
    description: 'A frame-owned TSX form with persisted fields and submission state',
    height: 520,
    id: 'interactive-form',
    label: 'Form',
    modality: 'data-interface',
    width: 620
  }
] as const satisfies readonly CodeObjectPreset[]

export function codeObjectPresetsForQuery(query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return CODE_OBJECT_PRESETS
  return CODE_OBJECT_PRESETS.filter((preset) =>
    [
      preset.label,
      preset.description,
      CODE_OBJECT_MODALITIES.find((modality) => modality.id === preset.modality)?.label ?? '',
      'code object'
    ].some((value) => value.toLowerCase().includes(normalized))
  )
}

export function codeObjectPresetGroupsForQuery(query: string): CodeObjectPresetGroup[] {
  const presets: readonly CodeObjectPreset[] = codeObjectPresetsForQuery(query)
  return CODE_OBJECT_MODALITIES.map((modality) => ({
    modality,
    presets: presets.filter((preset) => preset.modality === modality.id)
  })).filter((group) => group.presets.length > 0)
}

function documentForPreset(id: CodeObjectPresetId): CodeObjectDocument {
  if (id === 'user-code') return createUserCodeObjectDocument()
  if (id === 'board-remote') {
    return createUserCodeObjectDocument({
      boardPermissions: [...BOARD_SHAPE_PERMISSIONS],
      definitionId: 'openpencil.board-remote',
      modality: 'board-tool',
      name: 'Board remote',
      props: {},
      source: BOARD_REMOTE_SOURCE,
      state: {}
    })
  }
  if (id === 'analytics-chart') {
    return createUserCodeObjectDocument({
      definitionId: 'openpencil.analytics-chart',
      modality: 'data-interface',
      name: 'Chart',
      props: { title: 'Activation trend' },
      source: ANALYTICS_CHART_SOURCE,
      state: { range: '30d' }
    })
  }
  if (id === 'financial-dashboard') return createFinancialDashboardDocument()
  if (id === 'interactive-form') {
    return createUserCodeObjectDocument({
      definitionId: 'openpencil.interactive-form',
      modality: 'data-interface',
      name: 'Form',
      props: {},
      source: INTERACTIVE_FORM_SOURCE,
      state: { email: '', name: '', status: 'draft' }
    })
  }
  if (id === 'orbit-lab') return createOrbitLabDocument()
  if (id === 'signal-bloom') return createSignalBloomDocument()
  if (id === 'open-source-workspace') return createOpenSourceWorkspaceDocument()
  if (id === 'office-document') return createOfficeDocumentDocument()
  if (id === 'office-spreadsheet') return createOfficeSpreadsheetDocument()
  return createEarthSignalsDocument()
}

function restoreSceneNode(store: EditorStore, snapshot: SceneNode) {
  const { childIds: _childIds, id, parentId, ...overrides } = structuredClone(snapshot)
  if (store.graph.getNode(id)) return
  store.graph.createNodeWithId(id, snapshot.type, parentId, {
    ...overrides,
    childIds: []
  })
}

function createCodeObjectFrame(store: EditorStore, input: CreateCodeObjectInput) {
  const pageId = store.state.currentPageId
  const parentId =
    input.parentId &&
    store.graph.isContainer(input.parentId) &&
    store.graph.isDescendant(input.parentId, pageId)
      ? input.parentId
      : pageId
  const siblings = store.graph.getChildren(parentId)
  const x =
    input.x ??
    (siblings.length > 0 ? Math.max(...siblings.map((node) => node.x + node.width)) + 120 : 96)
  const frame = store.graph.createNode('FRAME', parentId, {
    clipsContent: true,
    cornerRadius: input.cornerRadius ?? 0,
    fills: [],
    height: input.height,
    name: input.name,
    pluginData: [],
    strokes: [],
    width: input.width,
    x,
    y: input.y ?? 88
  })
  store.graph.updateNode(frame.id, {
    pluginData: codeObjectPluginData(frame, input.document)
  })
  return store.graph.getNode(frame.id) ?? frame
}

export function createCodeObject(store: EditorStore, input: CreateCodeObjectInput) {
  const previousSelection = new Set(store.state.selectedIds)
  const frame = createCodeObjectFrame(store, input)
  const snapshot = structuredClone(store.graph.getNode(frame.id) ?? frame)

  store.undo.push({
    label: 'Create code object',
    forward: () => {
      restoreSceneNode(store, snapshot)
      store.select([snapshot.id])
      store.requestRender()
    },
    inverse: () => {
      store.graph.deleteNode(snapshot.id)
      store.select([...previousSelection])
      store.requestRender()
    }
  })
  store.select([frame.id])
  store.requestRender()
  return frame
}

export function createOpenSourceWorkspaceKit(store: EditorStore, position: Partial<Vector> = {}) {
  const kit = createOpenSourceWorkspaceKitDefinition()
  const preferred = { x: position.x ?? 96, y: position.y ?? 88 }
  const siblings = store.graph.getChildren(store.state.currentPageId)
  const overlapsSibling = siblings.some(
    (node) =>
      preferred.x < node.x + node.width + 80 &&
      preferred.x + kit.width + 80 > node.x &&
      preferred.y < node.y + node.height + 80 &&
      preferred.y + kit.height + 80 > node.y
  )
  const origin = {
    x: overlapsSibling
      ? Math.max(...siblings.map((node) => node.x + node.width), preferred.x) + 160
      : preferred.x,
    y: preferred.y
  }
  const previousSelection = [...store.state.selectedIds]
  const architecture = createCodeObjectFrame(store, {
    cornerRadius: 0,
    document: kit.architecture.document,
    height: kit.height,
    name: kit.architecture.name,
    width: kit.architecture.width,
    x: origin.x,
    y: origin.y
  })
  const kanban = createCodeObjectFrame(store, {
    cornerRadius: 0,
    document: kit.kanban.document,
    height: kit.height,
    name: kit.kanban.name,
    width: kit.kanban.width,
    x: origin.x + kit.architecture.width + kit.gap,
    y: origin.y
  })
  const frames = [architecture, kanban]
  const snapshots = frames.map((node) => structuredClone(store.graph.getNode(node.id) ?? node))
  store.undo.push({
    label: 'Add architecture and Kanban',
    forward: () => {
      snapshots.forEach((snapshot) => restoreSceneNode(store, snapshot))
      store.select(frames.map((frame) => frame.id))
      store.requestRender()
    },
    inverse: () => {
      snapshots
        .slice()
        .reverse()
        .forEach((snapshot) => store.graph.deleteNode(snapshot.id))
      store.select(previousSelection)
      store.requestRender()
    }
  })
  store.select(frames.map((frame) => frame.id))
  store.requestRender()
  return architecture
}

export function createCodeObjectFromPreset(
  store: EditorStore,
  id: CodeObjectPresetId,
  position: Partial<Vector> = {}
) {
  const preset = CODE_OBJECT_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) return null
  if (id === 'open-source-workspace') {
    return createOpenSourceWorkspaceKit(store, position)
  }
  return createCodeObject(store, {
    cornerRadius: preset.cornerRadius,
    document: documentForPreset(preset.id),
    height: preset.height,
    name: preset.label,
    width: preset.width,
    ...position
  })
}

function updatedInteractiveDocument(
  document: CodeObjectDocument,
  state: CodeObjectState
): CodeObjectDocument | null {
  if (document.component === 'earth-signals' && 'autoRotate' in state) {
    return { ...document, state: normalizeEarthSignalsState(state) }
  }
  if (document.component === 'code-starter' && 'count' in state) {
    return { ...document, state: normalizeCodeStarterState(state) }
  }
  if (document.component === 'user-code') {
    return { ...document, state: structuredClone(state) }
  }
  if (document.component === 'orbit-lab' && 'energy' in state) {
    return { ...document, state: normalizeOrbitLabState(state) }
  }
  if (document.component === 'signal-bloom' && 'hue' in state) {
    return { ...document, state: normalizeSignalBloomState(state) }
  }
  if (document.component === 'open-source-workspace' && 'piece' in state) {
    return { ...document, state: normalizeOpenSourceWorkspaceState(state) }
  }
  return null
}

function updatedArtifactDocument(
  document: CodeObjectDocument,
  state: CodeObjectState
): CodeObjectDocument | null {
  if (document.component === 'office-document' && 'seedText' in state) {
    return { ...document, state: normalizeOfficeDocumentState(state) }
  }
  if (document.component === 'office-spreadsheet' && 'seedCells' in state) {
    return { ...document, state: normalizeOfficeSpreadsheetState(state) }
  }
  if (document.component === 'pptx-deck' && 'activeSlide' in state) {
    return { ...document, state: normalizePptxDeckState(state) }
  }
  if (document.component === 'pdf-document' && 'activePage' in state) {
    return { ...document, state: normalizePdfDocumentState(state) }
  }
  if (document.component === 'smylr-flow-screen' && 'selectedTooth' in state) {
    return {
      ...document,
      state: normalizeSmylrFlowScreenState(state, document.viewState)
    }
  }
  return null
}

export function updateCodeObjectState(store: EditorStore, nodeId: string, state: CodeObjectState) {
  const node = store.graph.getNode(nodeId)
  const document = codeObjectDocument(node)
  if (!node || !document) return false

  const nextDocument =
    updatedInteractiveDocument(document, state) ?? updatedArtifactDocument(document, state)
  if (!nextDocument || JSON.stringify(nextDocument.state) === JSON.stringify(document.state)) {
    return false
  }
  store.updateNodeWithUndo(
    node.id,
    { pluginData: codeObjectPluginData(node, nextDocument) },
    'Update code object'
  )
  return true
}

export function codeObjectViewportInsets() {
  const insets = editorViewportInsets()
  return { ...insets, top: (insets.top ?? 14) + 8 }
}
