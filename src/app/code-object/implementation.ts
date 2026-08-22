import {
  CODE_OBJECT_SCHEMA_VERSION,
  createSmylrTrustedWebAppDocument,
  createUserCodeObjectDocument as createPersistedUserCodeObjectDocument,
  isCodeObjectViewportPresetId,
  isKnownCodeObjectComponent,
  normalizeCodeObjectSurface,
  parseCodeObjectDocument,
  resolveCodeObjectUiBlock,
  serializeCodeObjectPluginData,
  type CodeObjectDocument,
  type CodeObjectSurface,
  type CodeObjectViewportPresetId
} from '@open-pencil/core/code-object'
import { randomHex } from '@open-pencil/core/random'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { BOARD_SHAPE_PERMISSIONS } from '@/app/board-permissions'
import type { EditorStore } from '@/app/editor/active-store'
import { editorViewportInsets } from '@/app/editor/viewport-insets'

import type { CodeObjectBoardPermission } from './contracts'
import {
  ANALYTICS_CHART_SOURCE,
  BOARD_REMOTE_SOURCE,
  CODE_STARTER_SOURCE,
  EARTH_SIGNALS_SOURCE,
  FINANCIAL_DASHBOARD_SOURCE,
  INTERACTIVE_FORM_SOURCE,
  OFFICE_DOCUMENT_SOURCE,
  OFFICE_SPREADSHEET_SOURCE,
  OPEN_SOURCE_WORKSPACE_SOURCE,
  ORBIT_LAB_SOURCE,
  PDF_DOCUMENT_SOURCE,
  PPTX_DECK_SOURCE,
  SIGNAL_BLOOM_SOURCE,
  SMYLR_FLOW_SCREEN_SOURCE
} from './saved-sources'

export { CODE_OBJECT_SCHEMA_VERSION } from '@open-pencil/core/code-object'
/** @deprecated Read compatibility only. New code uses CODE_OBJECT_SCHEMA_VERSION. */
export const REACT_SHAPE_SCHEMA_VERSION = CODE_OBJECT_SCHEMA_VERSION

export type EarthSignalsState = {
  autoRotate: boolean
  latitude: number
  longitude: number
}

export type OrbitLabState = {
  energy: number
  paused: boolean
  tilt: number
}

export type SignalBloomState = {
  frozen: boolean
  hue: number
  spread: number
}

export type CodeStarterState = {
  count: number
  title: string
}

export type UserCodeObjectProps = Record<string, unknown>
export type UserCodeObjectState = Record<string, unknown>

export type OpenSourceArchitectureNode = {
  id: string
  kind: 'api' | 'cache' | 'database' | 'deploy' | 'frontend' | 'worker'
  label: string
  status: 'ready' | 'running' | 'warning'
  subtitle: string
  x: number
  y: number
}

export type OpenSourceArchitectureEdge = {
  id: string
  kind: 'cache' | 'database' | 'deploy' | 'http'
  label: string
  source: string
  target: string
}

export type OpenSourceKanbanTask = {
  id: string
  priority: 'high' | 'low' | 'medium'
  reference: string
  tags: string[]
  title: string
}

export type OpenSourceKanbanColumn = {
  id: string
  tasks: OpenSourceKanbanTask[]
  title: string
  tone: 'done' | 'progress' | 'review' | 'todo'
}

export type OpenSourceWorkspaceState =
  | {
      edges: OpenSourceArchitectureEdge[]
      nodes: OpenSourceArchitectureNode[]
      piece: 'architecture'
    }
  | {
      columns: OpenSourceKanbanColumn[]
      piece: 'kanban'
    }

export type PptxDeckState = {
  activeSlide: number
  view: 'deck'
}

export type PdfDocumentState = {
  activePage: number
  view: 'pdf'
}

export type OfficeDocumentState = {
  revision: number
  seedText: string
  snapshot: Record<string, unknown> | null
  view: 'document'
}

export type OfficeSpreadsheetCell = boolean | number | string

export type OfficeSpreadsheetState = {
  revision: number
  seedCells: OfficeSpreadsheetCell[][]
  snapshot: Record<string, unknown> | null
  view: 'spreadsheet'
}

export type SmylrFlowScreenState = {
  condition: 'Caries' | 'Fracture' | 'Watch'
  detailsOpen: boolean
  saveStatus: 'draft' | 'saved'
  selectedTooth: number
}

export type SmylrProductionAppState = {
  view: 'live'
}

export type TrustedWebAppLaunchMetadata = {
  launcherId: string
  startScript: string
}

type OpenPencilCodeDocument<
  Component extends string,
  State extends Record<string, unknown>
> = CodeObjectDocument<Component, State, CodeObjectBoardPermission>

export type EarthSignalsDocument = OpenPencilCodeDocument<'earth-signals', EarthSignalsState>
export type OrbitLabDocument = OpenPencilCodeDocument<'orbit-lab', OrbitLabState>
export type SignalBloomDocument = OpenPencilCodeDocument<'signal-bloom', SignalBloomState>
export type CodeStarterDocument = OpenPencilCodeDocument<'code-starter', CodeStarterState>
export type UserCodeObjectDocument = OpenPencilCodeDocument<'user-code', UserCodeObjectState>
export type OpenSourceWorkspaceDocument = OpenPencilCodeDocument<
  'open-source-workspace',
  OpenSourceWorkspaceState
>
export type OfficeDocumentDocument = OpenPencilCodeDocument<'office-document', OfficeDocumentState>
export type OfficeSpreadsheetDocument = OpenPencilCodeDocument<
  'office-spreadsheet',
  OfficeSpreadsheetState
>
export type PptxDeckDocument = OpenPencilCodeDocument<'pptx-deck', PptxDeckState>
export type PdfDocumentDocument = OpenPencilCodeDocument<'pdf-document', PdfDocumentState>
export type AgentConversationTerminalDocument = OpenPencilCodeDocument<
  'agent-conversation-terminal',
  Record<string, never>
> & {
  workerConversationId: string
}

export type SmylrFlowScreenDocument = OpenPencilCodeDocument<
  'smylr-flow-screen',
  SmylrFlowScreenState
> & {
  flowId: string
  label: string
  route: string
  screenId: string
  viewState: string
}

export type SmylrProductionAppDocument = OpenPencilCodeDocument<
  'smylr-production-app',
  SmylrProductionAppState
> & {
  label: string
  launch: TrustedWebAppLaunchMetadata
  route: string
  viewport?: {
    preset: CodeObjectViewportPresetId
  }
}

export type ReactShapeDocument =
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
  | SmylrFlowScreenDocument
  | SmylrProductionAppDocument
export type ReactShapeState = ReactShapeDocument['state']
export type ReactShapePresetId =
  | Exclude<
      ReactShapeDocument['component'],
      'code-starter' | 'pdf-document' | 'pptx-deck' | 'smylr-flow-screen' | 'smylr-production-app'
    >
  | 'analytics-chart'
  | 'board-remote'
  | 'financial-dashboard'
  | 'interactive-form'

export type CreateReactShapeInput = {
  cornerRadius?: number
  document: ReactShapeDocument
  height: number
  name: string
  parentId?: string
  width: number
  x?: number
  y?: number
}

const AGENT_SURFACE_SOURCE = `export default function AgentSurface() { return null }`

export function createAgentConversationTerminalDocument(input: {
  name: string
  workerConversationId: string
}): AgentConversationTerminalDocument {
  return {
    boardPermissions: [],
    component: 'agent-conversation-terminal',
    definitionId: `agent.conversation.${input.workerConversationId}`,
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

export type ReactShapePreset = {
  cornerRadius: number
  description: string
  height: number
  id: ReactShapePresetId
  label: string
  width: number
}

const DEFAULT_EARTH_SIGNALS_STATE: EarthSignalsState = {
  autoRotate: true,
  latitude: 12,
  longitude: -32
}

const DEFAULT_ORBIT_LAB_STATE: OrbitLabState = {
  energy: 1.12,
  paused: false,
  tilt: -14
}

const DEFAULT_SIGNAL_BLOOM_STATE: SignalBloomState = {
  frozen: false,
  hue: 268,
  spread: 1
}

const DEFAULT_CODE_STARTER_STATE: CodeStarterState = {
  count: 0,
  title: 'A living object on the board'
}

export const DEFAULT_CODE_OBJECT_SOURCE = `import { useMemo } from 'react'

type CodeObjectProps = {
  interactionEnabled: boolean
  props: { title?: string }
  setState: (next: { count: number }) => void
  state: { count: number }
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
      <div style={{ borderRadius: 14, background: '#ffffff14', padding: 16 }}>
      <div style={{ color: '#a8a8b3', fontSize: 12 }}>{label}</div>
      <div style={{ color: 'white', fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

export default function CodeObject({
  interactionEnabled,
  props,
  setState,
  state
}: CodeObjectProps) {
  const doubled = useMemo(() => state.count * 2, [state.count])
  const nextCount = state.count + 1
  const actionStyle = {
    border: 0,
    borderRadius: 12,
    padding: '10px 16px',
    background: interactionEnabled ? '#c4b5fd' : '#6b647d',
    color: '#18181f',
    cursor: interactionEnabled ? 'pointer' : 'default',
    fontWeight: 700
  }
  return (
    <main
      style={{
        boxSizing: 'border-box',
        minHeight: '100%',
        padding: 28,
        color: 'white',
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        background: 'linear-gradient(145deg, #18181f, #29223f)'
      }}
    >
      <p style={{ margin: 0, color: '#c4b5fd', fontSize: 12, fontWeight: 700 }}>
        OPENPENCIL CODE OBJECT
      </p>
      <h1 style={{ margin: '10px 0 20px', fontSize: 30 }}>
        {props.title ?? 'One TSX object'}
      </h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Metric label="Count" value={state.count} />
        <Metric label="Doubled" value={doubled} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
        <button
          disabled={!interactionEnabled}
          onClick={() => setState({ count: nextCount })}
          style={actionStyle}
        >
          {interactionEnabled ? 'Increment' : 'Enter to interact'}
        </button>
      </div>
    </main>
  )
}`

const DEFAULT_OFFICE_DOCUMENT_STATE: OfficeDocumentState = {
  revision: 0,
  seedText: `Product direction

Make every source feel native to the board.

Documents should read like documents, spreadsheets should calculate like spreadsheets, and presentations should move like presentations. The board owns placement and composition; the Office surface owns focused editing.

Principles
• One source, one durable object
• Direct editing without an iframe boundary
• Quiet in Design mode, capable in Interaction mode
• Original source preserved`,
  snapshot: null,
  view: 'document'
}

const DEFAULT_OFFICE_SPREADSHEET_STATE: OfficeSpreadsheetState = {
  revision: 0,
  seedCells: [
    ['Channel', 'Q1', 'Q2', 'Change', 'Owner'],
    ['Product', 84, 112, '=C2-B2', 'Maya'],
    ['Growth', 68, 91, '=C3-B3', 'Noah'],
    ['Research', 51, 76, '=C4-B4', 'Ari'],
    ['Platform', 73, 89, '=C5-B5', 'June'],
    ['Total', '=SUM(B2:B5)', '=SUM(C2:C5)', '=C6-B6', '']
  ],
  snapshot: null,
  view: 'spreadsheet'
}

export const OPEN_SOURCE_WORKSPACE_KIT = {
  nodes: [
    {
      id: 'web',
      kind: 'frontend',
      label: 'Web application',
      status: 'running',
      subtitle: 'Next.js · :3000',
      x: 60,
      y: 92
    },
    {
      id: 'gateway',
      kind: 'api',
      label: 'API gateway',
      status: 'running',
      subtitle: 'Edge routes · HTTPS',
      x: 340,
      y: 92
    },
    {
      id: 'orchestrator',
      kind: 'worker',
      label: 'Agent orchestrator',
      status: 'ready',
      subtitle: 'FastAPI · :8000',
      x: 620,
      y: 92
    },
    {
      id: 'postgres',
      kind: 'database',
      label: 'Postgres',
      status: 'ready',
      subtitle: 'Primary data store',
      x: 340,
      y: 330
    },
    {
      id: 'redis',
      kind: 'cache',
      label: 'Redis',
      status: 'ready',
      subtitle: 'Queues and cache',
      x: 620,
      y: 330
    },
    {
      id: 'worker',
      kind: 'worker',
      label: 'Background worker',
      status: 'warning',
      subtitle: '3 active jobs',
      x: 900,
      y: 210
    },
    {
      id: 'deploy',
      kind: 'deploy',
      label: 'Cloud deployment',
      status: 'running',
      subtitle: 'Production · us-east',
      x: 900,
      y: 450
    }
  ],
  edges: [
    {
      id: 'web-gateway',
      kind: 'http',
      label: 'HTTPS',
      source: 'web',
      target: 'gateway'
    },
    {
      id: 'gateway-orchestrator',
      kind: 'http',
      label: 'API',
      source: 'gateway',
      target: 'orchestrator'
    },
    {
      id: 'orchestrator-postgres',
      kind: 'database',
      label: 'DATABASE_URL',
      source: 'orchestrator',
      target: 'postgres'
    },
    {
      id: 'orchestrator-redis',
      kind: 'cache',
      label: 'REDIS_URL',
      source: 'orchestrator',
      target: 'redis'
    },
    {
      id: 'redis-worker',
      kind: 'cache',
      label: 'jobs',
      source: 'redis',
      target: 'worker'
    },
    {
      id: 'worker-deploy',
      kind: 'deploy',
      label: 'release',
      source: 'worker',
      target: 'deploy'
    }
  ],
  columns: [
    {
      id: 'todo',
      title: 'Backlog',
      tone: 'todo',
      tasks: [
        {
          id: 'task-1',
          priority: 'high',
          reference: 'TSK-1042',
          tags: ['architecture', 'agent'],
          title: 'Map approval gates into the runtime graph'
        },
        {
          id: 'task-2',
          priority: 'medium',
          reference: 'TSK-1048',
          tags: ['design'],
          title: 'Tighten empty states for deployment targets'
        }
      ]
    },
    {
      id: 'progress',
      title: 'In progress',
      tone: 'progress',
      tasks: [
        {
          id: 'task-3',
          priority: 'high',
          reference: 'TSK-1037',
          tags: ['kanban', 'sync'],
          title: 'Keep task changes visible to running agents'
        },
        {
          id: 'task-4',
          priority: 'low',
          reference: 'TSK-1045',
          tags: ['api'],
          title: 'Add project health summaries'
        }
      ]
    },
    {
      id: 'review',
      title: 'Review',
      tone: 'review',
      tasks: [
        {
          id: 'task-5',
          priority: 'medium',
          reference: 'TSK-1029',
          tags: ['permissions'],
          title: 'Review scoped connector permissions'
        }
      ]
    },
    {
      id: 'done',
      title: 'Done',
      tone: 'done',
      tasks: [
        {
          id: 'task-6',
          priority: 'low',
          reference: 'TSK-1018',
          tags: ['infra'],
          title: 'Persist container positions in project config'
        }
      ]
    }
  ]
} satisfies {
  columns: OpenSourceKanbanColumn[]
  edges: OpenSourceArchitectureEdge[]
  nodes: OpenSourceArchitectureNode[]
}

const DEFAULT_OPEN_SOURCE_WORKSPACE_STATE: OpenSourceWorkspaceState = {
  edges: structuredClone(OPEN_SOURCE_WORKSPACE_KIT.edges),
  nodes: structuredClone(OPEN_SOURCE_WORKSPACE_KIT.nodes),
  piece: 'architecture'
}

const FINANCIAL_DASHBOARD_UI_BLOCK = resolveCodeObjectUiBlock({
  block: 'financial-dashboard'
})

export const REACT_SHAPE_PRESETS = [
  {
    cornerRadius: 12,
    description: 'A TypeScript/TSX Code Object with persisted interactive state',
    height: 520,
    id: 'user-code',
    label: 'Code Object',
    width: 720
  },
  {
    cornerRadius: 12,
    description: 'A Code Object that creates and controls ordinary native board shapes',
    height: 500,
    id: 'board-remote',
    label: 'Board remote',
    width: 560
  },
  {
    cornerRadius: 0,
    description: 'A draggable three-dimensional signal globe',
    height: 760,
    id: 'earth-signals',
    label: 'Earth signals',
    width: 760
  },
  {
    cornerRadius: 0,
    description: 'A kinetic orbital instrument with adjustable energy',
    height: 600,
    id: 'orbit-lab',
    label: 'Orbit lab',
    width: 720
  },
  {
    cornerRadius: 0,
    description: 'A responsive color bloom you can shape and freeze',
    height: 640,
    id: 'signal-bloom',
    label: 'Signal bloom',
    width: 640
  },
  {
    cornerRadius: 0,
    description: 'Frameless OpenArchFlow architecture and OpenSail Kanban surfaces',
    height: 620,
    id: 'open-source-workspace',
    label: 'Architecture + Kanban',
    width: 2440
  },
  {
    cornerRadius: 8,
    description: 'A focused document editor powered by the Apache-2.0 Univer runtime',
    height: 900,
    id: 'office-document',
    label: 'Document',
    width: 760
  },
  {
    cornerRadius: 8,
    description: 'A formula-ready spreadsheet powered by the Apache-2.0 Univer runtime',
    height: 720,
    id: 'office-spreadsheet',
    label: 'Spreadsheet',
    width: 1120
  },
  {
    cornerRadius: 12,
    description: 'A frame-owned TSX chart with persisted range controls',
    height: 520,
    id: 'analytics-chart',
    label: 'Chart',
    width: 720
  },
  {
    cornerRadius: 0,
    description: FINANCIAL_DASHBOARD_UI_BLOCK.definition.description,
    height: FINANCIAL_DASHBOARD_UI_BLOCK.height,
    id: 'financial-dashboard',
    label: FINANCIAL_DASHBOARD_UI_BLOCK.definition.label,
    width: FINANCIAL_DASHBOARD_UI_BLOCK.width
  },
  {
    cornerRadius: 12,
    description: 'A frame-owned TSX form with persisted fields and submission state',
    height: 520,
    id: 'interactive-form',
    label: 'Form',
    width: 620
  }
] as const satisfies readonly ReactShapePreset[]

export function reactShapePresetsForQuery(query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return REACT_SHAPE_PRESETS
  return REACT_SHAPE_PRESETS.filter((preset) =>
    [preset.label, preset.description, 'code object'].some((value) =>
      value.toLowerCase().includes(normalized)
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizeLongitude(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180
}

function normalizeHue(value: number) {
  return ((Math.round(value) % 360) + 360) % 360
}

export function createEarthSignalsDocument(): EarthSignalsDocument {
  return {
    boardPermissions: [],
    component: 'earth-signals',
    definitionId: 'openpencil.earth-signals',
    name: 'Earth signals',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: EARTH_SIGNALS_SOURCE,
    state: { ...DEFAULT_EARTH_SIGNALS_STATE }
  }
}

export function createCodeStarterDocument(): CodeStarterDocument {
  return {
    boardPermissions: [],
    component: 'code-starter',
    definitionId: 'openpencil.code-starter',
    name: 'Code starter',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: CODE_STARTER_SOURCE,
    state: { ...DEFAULT_CODE_STARTER_STATE }
  }
}

export function createUserCodeObjectDocument(
  input: {
    boardPermissions?: CodeObjectBoardPermission[]
    definitionId?: string
    name?: string
    props?: UserCodeObjectProps
    source?: string
    state?: UserCodeObjectState
    surface?: CodeObjectSurface
  } = {}
): UserCodeObjectDocument {
  return createPersistedUserCodeObjectDocument({
    boardPermissions: input.boardPermissions,
    definitionId: input.definitionId?.trim() || `code-${randomHex(8)}`,
    name: input.name?.trim() || 'Code Object',
    props: input.props ?? { title: 'One TSX object' },
    source: input.source?.trim() || DEFAULT_CODE_OBJECT_SOURCE,
    state: input.state ?? { count: 0 },
    surface: input.surface
  })
}

export function createOrbitLabDocument(): OrbitLabDocument {
  return {
    boardPermissions: [],
    component: 'orbit-lab',
    definitionId: 'openpencil.orbit-lab',
    name: 'Orbit lab',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: ORBIT_LAB_SOURCE,
    state: { ...DEFAULT_ORBIT_LAB_STATE }
  }
}

export function createSignalBloomDocument(): SignalBloomDocument {
  return {
    boardPermissions: [],
    component: 'signal-bloom',
    definitionId: 'openpencil.signal-bloom',
    name: 'Signal bloom',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: SIGNAL_BLOOM_SOURCE,
    state: { ...DEFAULT_SIGNAL_BLOOM_STATE }
  }
}

export function createOpenSourceWorkspaceDocument(
  state: OpenSourceWorkspaceState = DEFAULT_OPEN_SOURCE_WORKSPACE_STATE
): OpenSourceWorkspaceDocument {
  return {
    boardPermissions: [],
    component: 'open-source-workspace',
    definitionId: 'openpencil.open-source-workspace',
    name: 'Architecture + Kanban',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: OPEN_SOURCE_WORKSPACE_SOURCE,
    state: structuredClone(state)
  }
}

export function createOfficeDocumentDocument(): OfficeDocumentDocument {
  return {
    boardPermissions: [],
    component: 'office-document',
    definitionId: 'openpencil.document',
    name: 'Document',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: OFFICE_DOCUMENT_SOURCE,
    state: structuredClone(DEFAULT_OFFICE_DOCUMENT_STATE)
  }
}

export function createOfficeSpreadsheetDocument(): OfficeSpreadsheetDocument {
  return {
    boardPermissions: [],
    component: 'office-spreadsheet',
    definitionId: 'openpencil.spreadsheet',
    name: 'Spreadsheet',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: OFFICE_SPREADSHEET_SOURCE,
    state: structuredClone(DEFAULT_OFFICE_SPREADSHEET_STATE)
  }
}

export function createPptxDeckDocument(): PptxDeckDocument {
  return {
    boardPermissions: [],
    component: 'pptx-deck',
    definitionId: 'openpencil.pptx-deck',
    name: 'Presentation',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: PPTX_DECK_SOURCE,
    state: { activeSlide: 0, view: 'deck' }
  }
}

export function createPdfDocumentDocument(): PdfDocumentDocument {
  return {
    boardPermissions: [],
    component: 'pdf-document',
    definitionId: 'openpencil.pdf-document',
    name: 'PDF',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: PDF_DOCUMENT_SOURCE,
    state: { activePage: 1, view: 'pdf' }
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

export function createSmylrProductionAppDocument(input: {
  label: string
  route: string
  viewportPreset?: CodeObjectViewportPresetId
}): SmylrProductionAppDocument {
  return createSmylrTrustedWebAppDocument<CodeObjectBoardPermission>(input)
}

function normalizeSmylrProductionAppState(): SmylrProductionAppState {
  return { view: 'live' }
}

function documentForPreset(id: ReactShapePresetId): ReactShapeDocument {
  if (id === 'user-code') return createUserCodeObjectDocument()
  if (id === 'board-remote') {
    return createUserCodeObjectDocument({
      boardPermissions: [...BOARD_SHAPE_PERMISSIONS],
      definitionId: 'openpencil.board-remote',
      name: 'Board remote',
      props: {},
      source: BOARD_REMOTE_SOURCE,
      state: {}
    })
  }
  if (id === 'analytics-chart') {
    return createUserCodeObjectDocument({
      definitionId: 'openpencil.analytics-chart',
      name: 'Chart',
      props: { title: 'Activation trend' },
      source: ANALYTICS_CHART_SOURCE,
      state: { range: '30d' }
    })
  }
  if (id === 'financial-dashboard') {
    const block = resolveCodeObjectUiBlock({
      block: 'financial-dashboard',
      config: {
        accountingMethod: 'Accrual',
        actions: [
          {
            label: 'Review customer mix',
            prompt: 'Show sales by customer for August 2026 and explain concentration risk.'
          }
        ],
        companyName: 'Demo Company',
        comparisonPeriod: 'Compared with July 2026',
        goingWell: [
          {
            description: 'Gross margin improved while revenue also grew.',
            severity: 'Medium',
            text: 'Product revenue increased 11% and gross margin reached 42%.',
            title: 'Revenue quality improved',
            tone: 'success'
          },
          {
            text: 'Operating cash stayed positive for the third consecutive month.',
            title: 'Cash generation is consistent',
            tone: 'success'
          }
        ],
        keyNumbers: [
          {
            label: 'Revenue',
            reportLabel: 'P&L',
            series: [58, 62, 61, 69, 73, 78, 84],
            trend: 'positive',
            value: '$84K',
            whatChanged: 'Up 9% from July'
          },
          {
            label: 'Net income',
            reportLabel: 'P&L',
            series: [8, 10, 9, 12, 13, 15, 17],
            trend: 'positive',
            value: '$17K',
            whatChanged: 'Margin expanded to 20%'
          },
          {
            label: 'Cash balance',
            reportLabel: 'Balance sheet',
            series: [96, 91, 102, 108, 106, 117, 121],
            trend: 'positive',
            value: '$121K',
            whatChanged: 'Up $15K this month'
          },
          {
            label: 'Overdue invoices',
            reportLabel: 'A/R',
            series: [18, 16, 15, 19, 21, 24, 27],
            trend: 'negative',
            value: '$27K',
            whatChanged: '32% of open receivables'
          }
        ],
        needsAttention: [
          {
            action: {
              label: 'Draft reminders',
              prompt: 'Draft friendly reminders for invoices more than 30 days overdue.'
            },
            description: 'Two customers account for 71% of the overdue balance.',
            severity: 'High',
            text: '$27K is overdue, up $6K since last month.',
            title: 'Receivables are aging',
            tone: 'danger'
          },
          {
            severity: 'Cleanup',
            text: 'Five uncategorized expenses are reducing report confidence.',
            title: 'Books need light cleanup',
            tone: 'warning'
          }
        ],
        overallRead: 'mixed',
        overallReadText:
          'Revenue, margin, and cash are healthy. Overdue receivables are the clearest near-term risk.',
        period: 'August 2026',
        table: {
          columns: [
            { key: 'driver', label: 'Cash driver' },
            { align: 'right', key: 'current', label: 'August' },
            { align: 'right', key: 'change', label: 'Change' }
          ],
          rows: [
            { change: '+$7K', current: '$84K', driver: 'Customer receipts' },
            { change: '-$3K', current: '$31K', driver: 'Payroll' },
            {
              change: '-$2K',
              current: '$12K',
              driver: 'Software and services'
            }
          ],
          title: 'Cash drivers'
        },
        title: 'Business health'
      }
    })
    return createUserCodeObjectDocument({
      definitionId: 'openpencil.financial-dashboard',
      name: block.definition.label,
      props: {
        block: block.block,
        config: block.config
      },
      source: FINANCIAL_DASHBOARD_SOURCE,
      state: block.initialState,
      surface: block.surface
    })
  }
  if (id === 'interactive-form') {
    return createUserCodeObjectDocument({
      definitionId: 'openpencil.interactive-form',
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

function recordString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeCodeObjectBoardPermissions(value: unknown): CodeObjectBoardPermission[] {
  if (!Array.isArray(value)) return []
  const permissions = BOARD_SHAPE_PERMISSIONS.filter((permission) => value.includes(permission))
  return permissions.length === 1 && permissions[0] === 'shape.create'
    ? [...BOARD_SHAPE_PERMISSIONS]
    : permissions
}

function materializeFrameOwnedFields<T extends ReactShapeDocument>(
  parsed: Record<string, unknown>,
  fallback: T
): T {
  const viewportPreset = isRecord(parsed.viewport)
    ? parsed.viewport.preset
    : fallback.viewport?.preset
  const surface = parsed.surface ?? fallback.surface
  return {
    ...fallback,
    boardPermissions: normalizeCodeObjectBoardPermissions(
      parsed.boardPermissions ?? fallback.boardPermissions
    ),
    definitionId: (recordString(parsed, 'definitionId') ?? fallback.definitionId).slice(0, 160),
    name: (recordString(parsed, 'name') ?? fallback.name).slice(0, 120),
    props: isRecord(parsed.props) ? structuredClone(parsed.props) : structuredClone(fallback.props),
    source: (recordString(parsed, 'source') ?? fallback.source).slice(0, 500_000),
    ...(surface === undefined ? {} : { surface: normalizeCodeObjectSurface(surface) }),
    ...(isCodeObjectViewportPresetId(viewportPreset)
      ? { viewport: { preset: viewportPreset } }
      : {})
  }
}

function normalizeEarthSignalsState(state: Record<string, unknown>): EarthSignalsState {
  return {
    autoRotate: state.autoRotate !== false,
    latitude: clamp(finiteNumber(state.latitude, DEFAULT_EARTH_SIGNALS_STATE.latitude), -70, 70),
    longitude: normalizeLongitude(
      finiteNumber(state.longitude, DEFAULT_EARTH_SIGNALS_STATE.longitude)
    )
  }
}

function normalizeOrbitLabState(state: Record<string, unknown>): OrbitLabState {
  return {
    energy: clamp(finiteNumber(state.energy, DEFAULT_ORBIT_LAB_STATE.energy), 0.35, 2.4),
    paused: state.paused === true,
    tilt: clamp(finiteNumber(state.tilt, DEFAULT_ORBIT_LAB_STATE.tilt), -36, 36)
  }
}

function normalizeSignalBloomState(state: Record<string, unknown>): SignalBloomState {
  return {
    frozen: state.frozen === true,
    hue: normalizeHue(finiteNumber(state.hue, DEFAULT_SIGNAL_BLOOM_STATE.hue)),
    spread: clamp(finiteNumber(state.spread, DEFAULT_SIGNAL_BLOOM_STATE.spread), 0.55, 1.45)
  }
}

function normalizeCodeStarterState(state: Record<string, unknown>): CodeStarterState {
  return {
    count: Math.max(0, Math.round(finiteNumber(state.count, DEFAULT_CODE_STARTER_STATE.count))),
    title: stringValue(state.title, DEFAULT_CODE_STARTER_STATE.title, 120)
  }
}

function stringValue(value: unknown, fallback: string, maximum = 80) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : fallback
}

function normalizeOpenSourceWorkspaceState(
  state: Record<string, unknown>
): OpenSourceWorkspaceState {
  const nodeKinds = new Set<OpenSourceArchitectureNode['kind']>([
    'api',
    'cache',
    'database',
    'deploy',
    'frontend',
    'worker'
  ])
  const nodeStatuses = new Set<OpenSourceArchitectureNode['status']>([
    'ready',
    'running',
    'warning'
  ])
  const priorities = new Set<OpenSourceKanbanTask['priority']>(['high', 'low', 'medium'])
  const tones = new Set<OpenSourceKanbanColumn['tone']>(['done', 'progress', 'review', 'todo'])
  if (state.piece === 'kanban' && Array.isArray(state.columns)) {
    const columns = state.columns.slice(0, 8).flatMap((value, columnIndex) => {
      if (!isRecord(value)) return []
      const fallback =
        OPEN_SOURCE_WORKSPACE_KIT.columns[columnIndex % OPEN_SOURCE_WORKSPACE_KIT.columns.length]
      const tasks = Array.isArray(value.tasks)
        ? value.tasks.slice(0, 40).flatMap((taskValue, taskIndex) => {
            if (!isRecord(taskValue)) return []
            const taskFallback =
              fallback.tasks[taskIndex % Math.max(fallback.tasks.length, 1)] ??
              OPEN_SOURCE_WORKSPACE_KIT.columns[0].tasks[0]
            return [
              {
                id: stringValue(taskValue.id, `task-${columnIndex}-${taskIndex}`, 48),
                priority: priorities.has(taskValue.priority as OpenSourceKanbanTask['priority'])
                  ? (taskValue.priority as OpenSourceKanbanTask['priority'])
                  : taskFallback.priority,
                reference: stringValue(taskValue.reference, taskFallback.reference, 24),
                tags: Array.isArray(taskValue.tags)
                  ? taskValue.tags
                      .filter((tag): tag is string => typeof tag === 'string')
                      .slice(0, 5)
                      .map((tag) => tag.trim().slice(0, 24))
                      .filter(Boolean)
                  : taskFallback.tags,
                title: stringValue(taskValue.title, taskFallback.title, 140)
              }
            ]
          })
        : structuredClone(fallback.tasks)
      return [
        {
          id: stringValue(value.id, fallback.id, 48),
          tasks,
          title: stringValue(value.title, fallback.title, 48),
          tone: tones.has(value.tone as OpenSourceKanbanColumn['tone'])
            ? (value.tone as OpenSourceKanbanColumn['tone'])
            : fallback.tone
        }
      ]
    })
    return {
      columns: columns.length > 0 ? columns : structuredClone(OPEN_SOURCE_WORKSPACE_KIT.columns),
      piece: 'kanban'
    }
  }

  const nodes = Array.isArray(state.nodes)
    ? state.nodes.slice(0, 48).flatMap((value, index) => {
        if (!isRecord(value)) return []
        const fallback =
          OPEN_SOURCE_WORKSPACE_KIT.nodes[index % OPEN_SOURCE_WORKSPACE_KIT.nodes.length]
        return [
          {
            id: stringValue(value.id, fallback.id, 48),
            kind: nodeKinds.has(value.kind as OpenSourceArchitectureNode['kind'])
              ? (value.kind as OpenSourceArchitectureNode['kind'])
              : fallback.kind,
            label: stringValue(value.label, fallback.label),
            status: nodeStatuses.has(value.status as OpenSourceArchitectureNode['status'])
              ? (value.status as OpenSourceArchitectureNode['status'])
              : fallback.status,
            subtitle: stringValue(value.subtitle, fallback.subtitle, 120),
            x: clamp(finiteNumber(value.x, fallback.x), -2000, 4000),
            y: clamp(finiteNumber(value.y, fallback.y), -2000, 4000)
          }
        ]
      })
    : structuredClone(OPEN_SOURCE_WORKSPACE_KIT.nodes)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(state.edges)
    ? state.edges.slice(0, 96).flatMap((value, index) => {
        if (!isRecord(value)) return []
        const fallback =
          OPEN_SOURCE_WORKSPACE_KIT.edges[index % OPEN_SOURCE_WORKSPACE_KIT.edges.length]
        const source = stringValue(value.source, fallback.source, 48)
        const target = stringValue(value.target, fallback.target, 48)
        if (!nodeIds.has(source) || !nodeIds.has(target)) return []
        return [
          {
            id: stringValue(value.id, fallback.id, 48),
            kind:
              value.kind === 'cache' ||
              value.kind === 'database' ||
              value.kind === 'deploy' ||
              value.kind === 'http'
                ? value.kind
                : fallback.kind,
            label: stringValue(value.label, fallback.label, 48),
            source,
            target
          }
        ]
      })
    : structuredClone(OPEN_SOURCE_WORKSPACE_KIT.edges)
  return {
    edges,
    nodes: nodes.length > 0 ? nodes : structuredClone(OPEN_SOURCE_WORKSPACE_KIT.nodes),
    piece: 'architecture'
  }
}

function normalizePptxDeckState(state: Record<string, unknown>): PptxDeckState {
  return {
    activeSlide: Math.max(0, Math.round(finiteNumber(state.activeSlide, 0))),
    view: 'deck'
  }
}

function normalizePdfDocumentState(state: Record<string, unknown>): PdfDocumentState {
  return {
    activePage: Math.max(1, Math.round(finiteNumber(state.activePage, 1))),
    view: 'pdf'
  }
}

function officeSnapshot(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? structuredClone(value) : null
}

function officeSpreadsheetCell(value: unknown): OfficeSpreadsheetCell | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value.slice(0, 2_000)
  return null
}

function normalizeOfficeDocumentState(state: Record<string, unknown>): OfficeDocumentState {
  return {
    revision: Math.max(0, Math.round(finiteNumber(state.revision, 0))),
    seedText:
      typeof state.seedText === 'string'
        ? state.seedText.slice(0, 100_000)
        : DEFAULT_OFFICE_DOCUMENT_STATE.seedText,
    snapshot: officeSnapshot(state.snapshot),
    view: 'document'
  }
}

function normalizeOfficeSpreadsheetState(state: Record<string, unknown>): OfficeSpreadsheetState {
  const seedCells = Array.isArray(state.seedCells)
    ? state.seedCells.slice(0, 2_000).map((row) =>
        Array.isArray(row)
          ? row
              .slice(0, 200)
              .map(officeSpreadsheetCell)
              .map((cell) => cell ?? '')
          : []
      )
    : structuredClone(DEFAULT_OFFICE_SPREADSHEET_STATE.seedCells)
  return {
    revision: Math.max(0, Math.round(finiteNumber(state.revision, 0))),
    seedCells: seedCells.length > 0 ? seedCells : [[]],
    snapshot: officeSnapshot(state.snapshot),
    view: 'spreadsheet'
  }
}

function normalizeSmylrFlowScreenState(
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

function agentReactShapeDocument(parsed: Record<string, unknown>): ReactShapeDocument | null {
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

function trustedSurfaceDocument(parsed: Record<string, unknown>): ReactShapeDocument | null {
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

function standardReactShapeDocument(
  parsed: Record<string, unknown>,
  state: Record<string, unknown>
): ReactShapeDocument | null {
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
): ReactShapeDocument | null {
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

export function reactShapeDocument(node: SceneNode | null | undefined): ReactShapeDocument | null {
  const parsed = parseCodeObjectDocument(node)
  if (!parsed) return null
  const agent = agentReactShapeDocument(parsed)
  if (agent) return agent
  const trustedSurface = trustedSurfaceDocument(parsed)
  if (trustedSurface) return trustedSurface
  const standard = standardReactShapeDocument(parsed, parsed.state)
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

export function isReactShapeFrame(node: SceneNode | null | undefined): node is SceneNode {
  return reactShapeDocument(node) !== null
}

export const reactShapePluginData = serializeCodeObjectPluginData

export function setReactShapeDocument(
  graph: SceneGraph,
  nodeId: string,
  document: ReactShapeDocument
) {
  const node = graph.getNode(nodeId)
  if (node?.type !== 'FRAME') return false
  const nextPluginData = reactShapePluginData(node, document)
  if (JSON.stringify(nextPluginData) === JSON.stringify(node.pluginData)) return false
  graph.updateNode(node.id, { pluginData: nextPluginData })
  return true
}

export function materializeReactShapeDocument(
  store: EditorStore,
  nodeId: string
): ReactShapeDocument | null {
  const node = store.graph.getNode(nodeId)
  const document = reactShapeDocument(node)
  if (!node || !document) return null
  const pluginData = reactShapePluginData(node, document)
  if (JSON.stringify(pluginData) === JSON.stringify(node.pluginData)) return document
  store.updateNodeWithUndo(
    node.id,
    { name: document.name, pluginData },
    'Migrate Code Object source'
  )
  return document
}

function restoreSceneNode(store: EditorStore, snapshot: SceneNode) {
  const { childIds: _childIds, id, parentId, ...overrides } = structuredClone(snapshot)
  if (store.graph.getNode(id)) return
  store.graph.createNodeWithId(id, snapshot.type, parentId, {
    ...overrides,
    childIds: []
  })
}

function createReactShapeFrame(store: EditorStore, input: CreateReactShapeInput) {
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
    pluginData: reactShapePluginData(frame, input.document)
  })
  return store.graph.getNode(frame.id) ?? frame
}

export function createReactShape(store: EditorStore, input: CreateReactShapeInput) {
  const previousSelection = new Set(store.state.selectedIds)
  const frame = createReactShapeFrame(store, input)
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

const OPEN_SOURCE_KIT = {
  architectureWidth: 1180,
  gap: 80,
  height: 620,
  kanbanWidth: 1180,
  width: 2440
} as const

function openSourceArchitectureState(): OpenSourceWorkspaceState {
  return {
    edges: structuredClone(OPEN_SOURCE_WORKSPACE_KIT.edges),
    nodes: structuredClone(OPEN_SOURCE_WORKSPACE_KIT.nodes),
    piece: 'architecture'
  }
}

function openSourceKanbanState(): OpenSourceWorkspaceState {
  return {
    columns: structuredClone(OPEN_SOURCE_WORKSPACE_KIT.columns),
    piece: 'kanban'
  }
}

export function createOpenSourceWorkspaceKit(store: EditorStore, position: Partial<Vector> = {}) {
  const preferred = { x: position.x ?? 96, y: position.y ?? 88 }
  const siblings = store.graph.getChildren(store.state.currentPageId)
  const overlapsSibling = siblings.some(
    (node) =>
      preferred.x < node.x + node.width + 80 &&
      preferred.x + OPEN_SOURCE_KIT.width + 80 > node.x &&
      preferred.y < node.y + node.height + 80 &&
      preferred.y + OPEN_SOURCE_KIT.height + 80 > node.y
  )
  const origin = {
    x: overlapsSibling
      ? Math.max(...siblings.map((node) => node.x + node.width), preferred.x) + 160
      : preferred.x,
    y: preferred.y
  }
  const previousSelection = [...store.state.selectedIds]
  const architecture = createReactShapeFrame(store, {
    cornerRadius: 0,
    document: createOpenSourceWorkspaceDocument(openSourceArchitectureState()),
    height: OPEN_SOURCE_KIT.height,
    name: 'Architecture flow',
    width: OPEN_SOURCE_KIT.architectureWidth,
    x: origin.x,
    y: origin.y
  })
  const kanban = createReactShapeFrame(store, {
    cornerRadius: 0,
    document: createOpenSourceWorkspaceDocument(openSourceKanbanState()),
    height: OPEN_SOURCE_KIT.height,
    name: 'Kanban board',
    width: OPEN_SOURCE_KIT.kanbanWidth,
    x: origin.x + OPEN_SOURCE_KIT.architectureWidth + OPEN_SOURCE_KIT.gap,
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

export function createReactShapeFromPreset(
  store: EditorStore,
  id: ReactShapePresetId,
  position: Partial<Vector> = {}
) {
  const preset = REACT_SHAPE_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) return null
  if (id === 'open-source-workspace') {
    return createOpenSourceWorkspaceKit(store, position)
  }
  return createReactShape(store, {
    cornerRadius: preset.cornerRadius,
    document: documentForPreset(preset.id),
    height: preset.height,
    name: preset.label,
    width: preset.width,
    ...position
  })
}

function updatedInteractiveDocument(
  document: ReactShapeDocument,
  state: ReactShapeState
): ReactShapeDocument | null {
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
  document: ReactShapeDocument,
  state: ReactShapeState
): ReactShapeDocument | null {
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

export function updateReactShapeState(store: EditorStore, nodeId: string, state: ReactShapeState) {
  const node = store.graph.getNode(nodeId)
  const document = reactShapeDocument(node)
  if (!node || !document) return false

  const nextDocument =
    updatedInteractiveDocument(document, state) ?? updatedArtifactDocument(document, state)
  if (!nextDocument || JSON.stringify(nextDocument.state) === JSON.stringify(document.state)) {
    return false
  }
  store.updateNodeWithUndo(
    node.id,
    { pluginData: reactShapePluginData(node, nextDocument) },
    'Update code object'
  )
  return true
}

export function reactShapeViewportInsets() {
  const insets = editorViewportInsets()
  return { ...insets, top: (insets.top ?? 14) + 8 }
}
