import {
  CODE_OBJECT_BOARD_PERMISSIONS,
  isCodeObjectAgentPresetId,
  isCodeObjectModality,
  isCodeObjectViewportPresetId,
  isKnownCodeObjectComponent,
  normalizeCodeObjectAppearance,
  normalizeCodeObjectSurface,
  parseCodeObjectDocument,
  serializeCodeObjectPluginData
} from '@open-pencil/core/code-object'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { BOARD_SHAPE_PERMISSIONS } from '@/app/board-permissions'
import type { EditorStore } from '@/app/editor/active-store'
import {
  parseExternalLiveSurfacePreview,
  parseExternalLiveSurfaceSource
} from '@/app/external-live-surface/contracts'

import {
  createOfficeDocumentDocument,
  createOfficeSpreadsheetDocument,
  createPdfDocumentDocument,
  createPptxDeckDocument,
  normalizeOfficeDocumentState,
  normalizeOfficeSpreadsheetState,
  normalizePdfDocumentState,
  normalizePptxDeckState
} from './artifact-documents'
import {
  createAgentConversationTerminalDocument,
  createExternalLiveSurfaceDocument,
  createSmylrFlowScreenDocument,
  createSmylrProductionAppDocument,
  normalizeSmylrFlowScreenState,
  normalizeSmylrProductionAppState,
  type ExternalLiveSurfaceDocument
} from './connected-surfaces'
import type { CodeObjectBoardPermission } from './contracts'
import type { CodeObjectDocument } from './implementation'
import {
  createCodeStarterDocument,
  createEarthSignalsDocument,
  createOrbitLabDocument,
  createSignalBloomDocument,
  createUserCodeObjectDocument,
  DEFAULT_CODE_OBJECT_SOURCE,
  normalizeCodeStarterState,
  normalizeEarthSignalsState,
  normalizeOrbitLabState,
  normalizeSignalBloomState
} from './interactive-documents'
import {
  createOpenSourceWorkspaceDocument,
  normalizeOpenSourceWorkspaceState
} from './open-source-workspace'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function recordString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeCodeObjectBoardPermissions(value: unknown): CodeObjectBoardPermission[] {
  if (!Array.isArray(value)) return []
  const permissions = CODE_OBJECT_BOARD_PERMISSIONS.filter((permission) =>
    value.includes(permission)
  )
  return permissions.length === 1 && permissions[0] === 'shape.create'
    ? [...BOARD_SHAPE_PERMISSIONS]
    : [...permissions]
}

function materializeFrameOwnedFields<T extends CodeObjectDocument>(
  parsed: Record<string, unknown>,
  fallback: T
): T {
  const viewportPreset = isRecord(parsed.viewport)
    ? parsed.viewport.preset
    : fallback.viewport?.preset
  const appearance = parsed.appearance ?? fallback.appearance
  const modality = isCodeObjectModality(parsed.modality) ? parsed.modality : fallback.modality
  const presetId = isCodeObjectAgentPresetId(parsed.presetId) ? parsed.presetId : fallback.presetId
  const surface = parsed.surface ?? fallback.surface
  return {
    ...fallback,
    ...(appearance === undefined ? {} : { appearance: normalizeCodeObjectAppearance(appearance) }),
    boardPermissions: normalizeCodeObjectBoardPermissions(
      parsed.boardPermissions ?? fallback.boardPermissions
    ),
    definitionId: (recordString(parsed, 'definitionId') ?? fallback.definitionId).slice(0, 160),
    ...(modality ? { modality } : {}),
    name: (recordString(parsed, 'name') ?? fallback.name).slice(0, 120),
    ...(presetId ? { presetId } : {}),
    props: isRecord(parsed.props) ? structuredClone(parsed.props) : structuredClone(fallback.props),
    source: (recordString(parsed, 'source') ?? fallback.source).slice(0, 500_000),
    ...(surface === undefined ? {} : { surface: normalizeCodeObjectSurface(surface) }),
    ...(isCodeObjectViewportPresetId(viewportPreset)
      ? { viewport: { preset: viewportPreset } }
      : {})
  }
}

function agentCodeObjectDocument(parsed: Record<string, unknown>): CodeObjectDocument | null {
  if (parsed.component === 'agent-conversation-terminal') {
    const workerConversationId = recordString(parsed, 'workerConversationId')
    if (!workerConversationId) return null
    const document = materializeFrameOwnedFields(
      parsed,
      createAgentConversationTerminalDocument({
        name: recordString(parsed, 'name') ?? 'Task conversation',
        workerConversationId
      })
    )
    return {
      ...document,
      surface: {
        background: document.surface?.background ?? 'surface',
        overflow: 'scroll'
      }
    }
  }
  return null
}

function trustedSurfaceDocument(parsed: Record<string, unknown>): CodeObjectDocument | null {
  if (parsed.component !== 'smylr-production-app') return null
  const label = recordString(parsed, 'label')
  const route = recordString(parsed, 'route')
  if (!label || !route) return null
  const viewportPreset = isRecord(parsed.viewport) ? parsed.viewport.preset : undefined
  return materializeFrameOwnedFields(parsed, {
    ...createSmylrProductionAppDocument({
      label,
      route,
      ...(isCodeObjectViewportPresetId(viewportPreset) ? { viewportPreset } : {})
    }),
    state: normalizeSmylrProductionAppState()
  })
}

function externalLiveSurfaceDocument(
  parsed: Record<string, unknown>
): ExternalLiveSurfaceDocument | null {
  if (parsed.component !== 'external-live-surface') return null
  const captureSource = parseExternalLiveSurfaceSource(parsed.captureSource)
  const preview = parseExternalLiveSurfacePreview(parsed.preview)
  if (!captureSource || !preview) return null
  return materializeFrameOwnedFields(
    parsed,
    createExternalLiveSurfaceDocument({
      name: recordString(parsed, 'name') ?? captureSource.element.accessibleName,
      preview,
      source: captureSource
    })
  )
}

function standardCodeObjectDocument(
  parsed: Record<string, unknown>,
  state: Record<string, unknown>
): CodeObjectDocument | null {
  if (parsed.component === 'user-code') {
    return materializeFrameOwnedFields(
      parsed,
      createUserCodeObjectDocument({
        definitionId: recordString(parsed, 'definitionId') ?? 'openpencil.code-object',
        name: recordString(parsed, 'name') ?? 'Code Object',
        props: isRecord(parsed.props) ? parsed.props : {},
        source: recordString(parsed, 'source') ?? DEFAULT_CODE_OBJECT_SOURCE,
        state
      })
    )
  }
  if (parsed.component === 'code-starter') {
    return materializeFrameOwnedFields(parsed, {
      ...createCodeStarterDocument(),
      state: normalizeCodeStarterState(state)
    })
  }
  if (parsed.component === 'earth-signals') {
    return materializeFrameOwnedFields(parsed, {
      ...createEarthSignalsDocument(),
      state: normalizeEarthSignalsState(state)
    })
  }
  if (parsed.component === 'orbit-lab') {
    return materializeFrameOwnedFields(parsed, {
      ...createOrbitLabDocument(),
      state: normalizeOrbitLabState(state)
    })
  }
  if (parsed.component === 'signal-bloom') {
    return materializeFrameOwnedFields(parsed, {
      ...createSignalBloomDocument(),
      state: normalizeSignalBloomState(state)
    })
  }
  if (parsed.component === 'open-source-workspace') {
    return materializeFrameOwnedFields(
      parsed,
      createOpenSourceWorkspaceDocument(normalizeOpenSourceWorkspaceState(state))
    )
  }
  if (parsed.component === 'office-document') {
    return materializeFrameOwnedFields(parsed, {
      ...createOfficeDocumentDocument(),
      state: normalizeOfficeDocumentState(state)
    })
  }
  if (parsed.component === 'office-spreadsheet') {
    return materializeFrameOwnedFields(parsed, {
      ...createOfficeSpreadsheetDocument(),
      state: normalizeOfficeSpreadsheetState(state)
    })
  }
  if (parsed.component === 'pptx-deck') {
    return materializeFrameOwnedFields(parsed, {
      ...createPptxDeckDocument(),
      state: normalizePptxDeckState(state)
    })
  }
  if (parsed.component === 'pdf-document') {
    return materializeFrameOwnedFields(parsed, {
      ...createPdfDocumentDocument(),
      state: normalizePdfDocumentState(state)
    })
  }
  return null
}

/**
 * A custom component name alongside TSX source means the author intended `user-code`
 * and misplaced their identity in `component`. Recover it instead of rendering a blank
 * frame; materialization then persists the corrected document. Known trusted components
 * with missing required fields stay null — running their source would mask real damage.
 */
function userCodeRecoveryDocument(
  parsed: NonNullable<ReturnType<typeof parseCodeObjectDocument>>
): CodeObjectDocument | null {
  if (isKnownCodeObjectComponent(parsed.component)) return null
  const source = recordString(parsed, 'source')
  if (!source) return null
  return materializeFrameOwnedFields(
    parsed,
    createUserCodeObjectDocument({
      definitionId: recordString(parsed, 'definitionId') ?? parsed.component,
      name: recordString(parsed, 'name') ?? 'Code Object',
      props: isRecord(parsed.props) ? parsed.props : {},
      source,
      state: parsed.state
    })
  )
}

export function codeObjectDocument(node: SceneNode | null | undefined): CodeObjectDocument | null {
  const parsed = parseCodeObjectDocument(node)
  if (!parsed) return null
  const agent = agentCodeObjectDocument(parsed)
  if (agent) return agent
  const trustedSurface = trustedSurfaceDocument(parsed)
  if (trustedSurface) return trustedSurface
  const externalSurface = externalLiveSurfaceDocument(parsed)
  if (externalSurface) return externalSurface
  const standard = standardCodeObjectDocument(parsed, parsed.state)
  if (standard) return standard
  if (parsed.component !== 'smylr-flow-screen') return userCodeRecoveryDocument(parsed)
  const flowId = recordString(parsed, 'flowId')
  const label = recordString(parsed, 'label')
  const route = recordString(parsed, 'route')
  const screenId = recordString(parsed, 'screenId')
  const viewState = recordString(parsed, 'viewState')
  if (!flowId || !label || !route || !screenId || !viewState) return null
  return materializeFrameOwnedFields(parsed, {
    ...createSmylrFlowScreenDocument({
      flowId,
      label,
      route,
      screenId,
      viewState
    }),
    state: normalizeSmylrFlowScreenState(parsed.state, viewState)
  })
}

export function isCodeObjectFrame(node: SceneNode | null | undefined): node is SceneNode {
  return codeObjectDocument(node) !== null
}

export const codeObjectPluginData = serializeCodeObjectPluginData

export function setCodeObjectDocument(
  graph: SceneGraph,
  nodeId: string,
  document: CodeObjectDocument
) {
  const node = graph.getNode(nodeId)
  if (node?.type !== 'FRAME') return false
  const nextPluginData = codeObjectPluginData(node, document)
  if (JSON.stringify(nextPluginData) === JSON.stringify(node.pluginData)) return false
  graph.updateNode(node.id, { pluginData: nextPluginData })
  return true
}

export function materializeCodeObjectDocument(
  store: EditorStore,
  nodeId: string
): CodeObjectDocument | null {
  const node = store.graph.getNode(nodeId)
  const document = codeObjectDocument(node)
  if (!node || !document) return null
  const pluginData = codeObjectPluginData(node, document)
  if (JSON.stringify(pluginData) === JSON.stringify(node.pluginData)) return document
  store.updateNodeWithUndo(
    node.id,
    { name: document.name, pluginData },
    'Migrate Code Object source'
  )
  return document
}
