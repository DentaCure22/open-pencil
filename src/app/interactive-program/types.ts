import type {
  DecisionReceipt,
  EvidenceCollectionReceipt,
  EvidenceManifest,
  EvidenceManifestItem,
  IntentRecord,
  SurfaceRun
} from '@/app/workspace'

export type ProgramInput = {
  defaultValue: number
  description: string
  id: string
  label: string
  max: number
  min: number
  step: number
  unit?: string
}

export type ProgramItem = {
  evidenceItemIds: string[]
  id: string
  label: string
  metrics: Record<string, number>
  note: string
}

export type ProgramFormulaOperand =
  | { kind: 'constant'; value: number }
  | { inputId: string; kind: 'input' }
  | { kind: 'metric'; metricId: string }
  | { kind: 'node'; nodeId: string }

export type ProgramFormulaNode = {
  id: string
  operands: ProgramFormulaOperand[]
  op: 'abs' | 'add' | 'divide' | 'max' | 'min' | 'multiply' | 'subtract'
}

export type ProgramFormulaSelection =
  | { count: number; kind: 'top-n' }
  | { comparator: 'gte' | 'lte'; kind: 'threshold'; value: number }

export type InteractiveProgramModel =
  | {
      kind: 'weighted-priority'
    }
  | {
      capacityInputId: string
      effortMetricId: string
      kind: 'capacity-planner'
      valueMetricId: string
    }
  | {
      kind: 'formula-graph'
      nodes: ProgramFormulaNode[]
      order: 'ascending' | 'descending'
      scoreNodeId: string
      selection: ProgramFormulaSelection
    }

export type InteractiveProgramDefinition = {
  inputs: ProgramInput[]
  items: Array<Omit<ProgramItem, 'evidenceItemIds'>>
  model: InteractiveProgramModel
  subtitle: string
}

export type InteractiveProgramSpec = {
  capturedAt: string
  collectionReceipt?: EvidenceCollectionReceipt
  evidence: EvidenceManifestItem[]
  formChoice?: SurfaceRun['formChoice']
  id: string
  inputs: ProgramInput[]
  intent: {
    constraints: string[]
    desiredOutcome: string
    statement: string
  }
  items: ProgramItem[]
  model: InteractiveProgramModel
  subtitle: string
  title: string
}

export type ProgramScenario = Record<string, number>

export type ProgramResult = {
  evidenceItemIds: string[]
  explanation: string
  itemId: string
  label: string
  rank: number
  score: number
  selected: boolean
}

export type InteractiveProgramRenderState = {
  artifactRevision: number
  evidence: EvidenceManifest
  intent: IntentRecord
  receipt?: DecisionReceipt
  results: ProgramResult[]
  scenario: ProgramScenario
  spec: InteractiveProgramSpec
  surface: SurfaceRun
  workspaceRevision: number
}

export type InteractiveProgramEventRequest = {
  action: 'adjust' | 'approve'
  actorId?: string
  eventId: string
  expected: {
    artifactRevision: number
    surfaceRevision: number
    workspaceRevision: number
  }
  inputId?: string
  note?: string
  surfaceRunId: string
  value?: number
}

export type InteractiveProgramEventResult = {
  error?: string
  eventId: string
  receiptId?: string
  state?: InteractiveProgramRenderState
  status: 'applied' | 'rejected' | 'replayed'
}

export type InteractiveProgramCreationResult = {
  boardId: string
  created: boolean
  formRationale: string
  surfaceRunId: string
}
