import {
  CODE_OBJECT_SCHEMA_VERSION,
  createSmylrTrustedWebAppDocument,
  type CodeObjectDocument as CoreCodeObjectDocument,
  type CodeObjectViewportPresetId
} from '@open-pencil/core/code-object'

import {
  type ExternalLiveSurfacePreview,
  type ExternalLiveSurfaceSource
} from '@/app/external-live-surface/contracts'

import type { CodeObjectBoardPermission } from './contracts'
import { EXTERNAL_LIVE_SURFACE_SOURCE, SMYLR_FLOW_SCREEN_SOURCE } from './saved-sources'

export type SmylrFlowScreenState = {
  condition: 'Caries' | 'Fracture' | 'Watch'
  detailsOpen: boolean
  saveStatus: 'draft' | 'saved'
  selectedTooth: number
}

export type SmylrProductionAppState = {
  view: 'live'
}

export type ExternalLiveSurfaceState = {
  view: 'live'
}

export type TrustedWebAppLaunchMetadata = {
  launcherId: string
  startScript: string
}

export type ExternalLiveSurfaceDocument = CoreCodeObjectDocument<
  'external-live-surface',
  ExternalLiveSurfaceState,
  CodeObjectBoardPermission
> & {
  captureSource: ExternalLiveSurfaceSource
  preview: ExternalLiveSurfacePreview
}

export type AgentConversationTerminalDocument = CoreCodeObjectDocument<
  'agent-conversation-terminal',
  Record<string, never>,
  CodeObjectBoardPermission
> & {
  workerConversationId: string
}

export type SmylrFlowScreenDocument = CoreCodeObjectDocument<
  'smylr-flow-screen',
  SmylrFlowScreenState,
  CodeObjectBoardPermission
> & {
  flowId: string
  label: string
  route: string
  screenId: string
  viewState: string
}

export type SmylrProductionAppDocument = CoreCodeObjectDocument<
  'smylr-production-app',
  SmylrProductionAppState,
  CodeObjectBoardPermission
> & {
  label: string
  launch: TrustedWebAppLaunchMetadata
  route: string
  viewport?: {
    preset: CodeObjectViewportPresetId
  }
}

const AGENT_SURFACE_SOURCE = `export default function AgentSurface() { return null }`

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function createAgentConversationTerminalDocument(input: {
  name: string
  workerConversationId: string
}): AgentConversationTerminalDocument {
  return {
    boardPermissions: [],
    component: 'agent-conversation-terminal',
    definitionId: `agent.conversation.${input.workerConversationId}`,
    modality: 'agent',
    name: input.name,
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: AGENT_SURFACE_SOURCE,
    state: {},
    surface: { background: 'surface', overflow: 'scroll' },
    workerConversationId: input.workerConversationId
  }
}

export function createExternalLiveSurfaceDocument(input: {
  name: string
  preview: ExternalLiveSurfacePreview
  source: ExternalLiveSurfaceSource
}): ExternalLiveSurfaceDocument {
  return {
    boardPermissions: [],
    captureSource: structuredClone(input.source),
    component: 'external-live-surface',
    definitionId: `openpencil.external-live-surface.${input.source.selectionId}`,
    modality: 'live-app',
    name: input.name,
    preview: structuredClone(input.preview),
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: EXTERNAL_LIVE_SURFACE_SOURCE,
    state: { view: 'live' },
    surface: { background: 'surface', overflow: 'clip' }
  }
}

export function defaultSmylrFlowScreenState(viewState: string): SmylrFlowScreenState {
  return {
    condition: 'Caries',
    detailsOpen: viewState === 'conditional-details',
    saveStatus: viewState === 'saved-undo' ? 'saved' : 'draft',
    selectedTooth: 14
  }
}

export function createSmylrFlowScreenDocument(input: {
  flowId: string
  label: string
  route: string
  screenId: string
  viewState: string
}): SmylrFlowScreenDocument {
  return {
    boardPermissions: [],
    component: 'smylr-flow-screen',
    definitionId: `smylr.${input.flowId}.${input.screenId}`,
    flowId: input.flowId,
    label: input.label,
    modality: 'live-app',
    name: input.label,
    props: {
      flowId: input.flowId,
      route: input.route,
      screenId: input.screenId,
      viewState: input.viewState
    },
    route: input.route,
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    screenId: input.screenId,
    source: SMYLR_FLOW_SCREEN_SOURCE,
    state: defaultSmylrFlowScreenState(input.viewState),
    viewState: input.viewState
  }
}

export const createSmylrProductionAppDocument =
  createSmylrTrustedWebAppDocument<CodeObjectBoardPermission>

export function normalizeSmylrProductionAppState(): SmylrProductionAppState {
  return { view: 'live' }
}

export function normalizeSmylrFlowScreenState(
  state: Record<string, unknown>,
  viewState: string
): SmylrFlowScreenState {
  const condition = state.condition
  const saveStatus = state.saveStatus
  let normalizedSaveStatus: SmylrFlowScreenState['saveStatus'] = 'draft'
  if (saveStatus === 'draft' || saveStatus === 'saved') normalizedSaveStatus = saveStatus
  else if (viewState === 'saved-undo') normalizedSaveStatus = 'saved'
  return {
    condition:
      condition === 'Caries' || condition === 'Fracture' || condition === 'Watch'
        ? condition
        : 'Caries',
    detailsOpen:
      typeof state.detailsOpen === 'boolean'
        ? state.detailsOpen
        : viewState === 'conditional-details',
    saveStatus: normalizedSaveStatus,
    selectedTooth: Math.round(clamp(finiteNumber(state.selectedTooth, 14), 1, 32))
  }
}
