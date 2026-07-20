import { WorkspaceDomainError } from '@/app/workspace'

import { formulaNodeDepth } from './formula'
import type {
  InteractiveProgramDefinition,
  InteractiveProgramModel,
  InteractiveProgramSpec,
  ProgramFormulaNode,
  ProgramFormulaOperand
} from './types'

const LIMITS = {
  description: 500,
  evidence: 50,
  id: 80,
  inputs: 12,
  items: 50,
  nodes: 64,
  operands: 8,
  specBytes: 128 * 1024,
  text: 160
} as const
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/
const MAX_ABSOLUTE_VALUE = 1_000_000_000_000

function invalid(message: string): never {
  throw new WorkspaceDomainError('validation_failed', message)
}

export function validateInteractiveProgramDefinition(value: InteractiveProgramDefinition): void {
  validateInteractiveProgramSpec({
    capturedAt: '2026-01-01T00:00:00.000Z',
    evidence: [
      {
        access: 'allowed',
        facts: { source: 'Captured model definition' },
        freshness: 'current',
        id: 'captured-program-definition',
        permissionScopes: ['captured-content:read'],
        retrievedAt: '2026-01-01T00:00:00.000Z',
        sourceRef: 'captured://interactive-program/definition',
        summary: 'The user-authored interactive model definition.',
        title: 'Captured model definition',
        truthScope: 'captured'
      }
    ],
    id: 'interactive-program-definition-preview',
    inputs: value.inputs,
    intent: {
      constraints: [],
      desiredOutcome: 'Preview a valid bounded interactive model.',
      statement: 'Validate the user-authored interactive program definition.'
    },
    items: value.items.map((item) => ({
      ...item,
      evidenceItemIds: ['captured-program-definition']
    })),
    model: value.model,
    subtitle: value.subtitle || 'A bounded user-authored interactive model.',
    title: 'Interactive program definition preview'
  })
}

function validId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || value.length > LIMITS.id) {
    invalid(`${label} must be a stable 1-${LIMITS.id} character id`)
  }
}

function validText(
  value: unknown,
  label: string,
  maxLength: number = LIMITS.text
): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    invalid(`${label} must be 1-${maxLength} characters`)
  }
}

function validNumber(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_ABSOLUTE_VALUE
  ) {
    invalid(`${label} must be finite and no larger than ${MAX_ABSOLUTE_VALUE}`)
  }
}

function unique(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) invalid(`${label} ids must be unique`)
}

function referencedMetricIds(model: InteractiveProgramModel): string[] {
  if (model.kind === 'weighted-priority') return []
  if (model.kind === 'capacity-planner') return [model.effortMetricId, model.valueMetricId]
  return model.nodes.flatMap((node) =>
    node.operands.flatMap((operand) => (operand.kind === 'metric' ? [operand.metricId] : []))
  )
}

function validateOperand(
  operand: ProgramFormulaOperand,
  inputIds: Set<string>,
  nodeIds: Set<string>
) {
  if (operand.kind === 'constant') {
    validNumber(operand.value, 'formula constant')
  } else if (operand.kind === 'input') {
    validId(operand.inputId, 'formula input reference')
    if (!inputIds.has(operand.inputId)) invalid(`formula input ${operand.inputId} is unavailable`)
  } else if (operand.kind === 'metric') {
    validId(operand.metricId, 'formula metric reference')
  } else {
    validId(operand.nodeId, 'formula node reference')
    if (!nodeIds.has(operand.nodeId)) invalid(`formula node ${operand.nodeId} is unavailable`)
  }
}

function requiredArity(op: ProgramFormulaNode['op']): number | null {
  if (op === 'abs') return 1
  if (op === 'divide' || op === 'subtract') return 2
  return null
}

function validateFormulaModel(
  model: Extract<InteractiveProgramModel, { kind: 'formula-graph' }>,
  inputIds: Set<string>
) {
  if (model.nodes.length === 0 || model.nodes.length > LIMITS.nodes) {
    invalid(`formula graph requires 1-${LIMITS.nodes} nodes`)
  }
  const nodeIds = model.nodes.map((node) => node.id)
  nodeIds.forEach((id) => validId(id, 'formula node id'))
  unique(nodeIds, 'formula node')
  const nodeIdSet = new Set(nodeIds)
  model.nodes.forEach((node) => {
    const supported = ['abs', 'add', 'divide', 'max', 'min', 'multiply', 'subtract'].includes(
      node.op
    )
    if (!supported) invalid(`formula operation ${String(node.op)} is unsupported`)
    const exact = requiredArity(node.op)
    if (
      (exact !== null && node.operands.length !== exact) ||
      (exact === null && (node.operands.length < 2 || node.operands.length > LIMITS.operands))
    ) {
      invalid(`formula node ${node.id} has invalid arity`)
    }
    node.operands.forEach((operand) => validateOperand(operand, inputIds, nodeIdSet))
  })
  validId(model.scoreNodeId, 'formula score node')
  if (!nodeIdSet.has(model.scoreNodeId)) invalid(`formula node ${model.scoreNodeId} is unavailable`)
  if (Math.max(...model.nodes.map((node) => formulaNodeDepth(model.nodes, node.id))) > 16) {
    invalid('formula graph dependency depth cannot exceed 16')
  }
  if (!['ascending', 'descending'].includes(model.order)) {
    invalid('formula graph rank order is invalid')
  }
  if (model.selection.kind === 'top-n') {
    if (!Number.isInteger(model.selection.count) || model.selection.count < 1) {
      invalid('formula top-n selection count must be a positive integer')
    }
  } else {
    if (!['gte', 'lte'].includes(model.selection.comparator)) {
      invalid('formula threshold comparator is invalid')
    }
    validNumber(model.selection.value, 'formula threshold')
  }
}

function validateSpecArrays(spec: InteractiveProgramSpec) {
  if (
    !Array.isArray(spec.inputs) ||
    spec.inputs.length === 0 ||
    spec.inputs.length > LIMITS.inputs
  ) {
    invalid(`interactive program requires 1-${LIMITS.inputs} inputs`)
  }
  if (!Array.isArray(spec.items) || spec.items.length < 2 || spec.items.length > LIMITS.items) {
    invalid(`interactive program requires 2-${LIMITS.items} items`)
  }
  if (
    !Array.isArray(spec.evidence) ||
    spec.evidence.length === 0 ||
    spec.evidence.length > LIMITS.evidence
  ) {
    invalid(`interactive program requires 1-${LIMITS.evidence} evidence items`)
  }
}

function validateInputs(spec: InteractiveProgramSpec): string[] {
  const inputIds = spec.inputs.map((input) => input.id)
  inputIds.forEach((id) => validId(id, 'program input id'))
  unique(inputIds, 'program input')
  spec.inputs.forEach((input) => {
    validText(input.label, `program input ${input.id} label`)
    validText(input.description, `program input ${input.id} description`, LIMITS.description)
    validNumber(input.min, `program input ${input.id} minimum`)
    validNumber(input.max, `program input ${input.id} maximum`)
    validNumber(input.step, `program input ${input.id} step`)
    validNumber(input.defaultValue, `program input ${input.id} default`)
    if (input.min >= input.max || input.step <= 0) {
      invalid(`program input ${input.id} range is invalid`)
    }
    if (input.defaultValue < input.min || input.defaultValue > input.max) {
      invalid(`program input ${input.id} default is outside its range`)
    }
    const stepOffset = (input.defaultValue - input.min) / input.step
    if (Math.abs(stepOffset - Math.round(stepOffset)) > 1e-8) {
      invalid(`program input ${input.id} default is not aligned to its step`)
    }
  })
  return inputIds
}

function validateModel(model: InteractiveProgramModel, inputIds: string[]) {
  if (model.kind === 'formula-graph') validateFormulaModel(model, new Set(inputIds))
  else if (model.kind === 'capacity-planner') {
    validId(model.capacityInputId, 'capacity input reference')
    validId(model.effortMetricId, 'capacity effort metric reference')
    validId(model.valueMetricId, 'capacity value metric reference')
    if (!inputIds.includes(model.capacityInputId)) {
      invalid('capacity program must reference one declared capacity input')
    }
  }
}

function validateItems(spec: InteractiveProgramSpec, inputIds: string[], evidenceIds: string[]) {
  const itemIds = spec.items.map((item) => item.id)
  itemIds.forEach((id) => validId(id, 'program item id'))
  unique(itemIds, 'program item')
  const evidenceIdSet = new Set(evidenceIds)
  const requiredMetrics =
    spec.model.kind === 'weighted-priority' ? inputIds : referencedMetricIds(spec.model)
  spec.items.forEach((item) => {
    validText(item.label, `program item ${item.id} label`)
    validText(item.note, `program item ${item.id} note`, LIMITS.description)
    if (!Array.isArray(item.evidenceItemIds) || item.evidenceItemIds.length === 0) {
      invalid(`program item ${item.id} must cite evidence or a captured assumption`)
    }
    if (item.evidenceItemIds.some((id) => !evidenceIdSet.has(id))) {
      invalid(`program item ${item.id} cites evidence outside the exact manifest`)
    }
    requiredMetrics.forEach((metricId) => {
      if (!Object.hasOwn(item.metrics, metricId)) {
        invalid(`program metric ${metricId} is missing for ${item.id}`)
      }
      validNumber(item.metrics[metricId], `program metric ${metricId} for ${item.id}`)
    })
  })
}

export function validateInteractiveProgramSpec(
  value: unknown
): asserts value is InteractiveProgramSpec {
  if (!value || typeof value !== 'object') invalid('interactive program spec is invalid')
  const spec = value as InteractiveProgramSpec
  if (JSON.stringify(spec).length > LIMITS.specBytes)
    invalid('interactive program spec is too large')
  validId(spec.id, 'program id')
  validText(spec.title, 'program title')
  validText(spec.subtitle, 'program subtitle', LIMITS.description)
  const rawIntent = Object.hasOwn(value, 'intent')
    ? (value as { intent?: unknown }).intent
    : undefined
  if (!rawIntent || typeof rawIntent !== 'object') invalid('program intent is required')
  const intent = rawIntent as { desiredOutcome?: unknown; statement?: unknown }
  validText(intent.statement, 'program intent', LIMITS.description)
  validText(intent.desiredOutcome, 'program desired outcome', LIMITS.description)
  validateSpecArrays(spec)
  const inputIds = validateInputs(spec)
  const evidenceIds = spec.evidence.map((item) => item.id)
  evidenceIds.forEach((id) => validId(id, 'program evidence id'))
  unique(evidenceIds, 'program evidence')
  const rawModel: unknown = (value as { model?: unknown }).model
  if (!rawModel || typeof rawModel !== 'object') invalid('program model is required')
  const rawKind = Object.hasOwn(rawModel, 'kind') ? (rawModel as { kind: unknown }).kind : undefined
  if (!['capacity-planner', 'formula-graph', 'weighted-priority'].includes(String(rawKind))) {
    invalid(`program model ${String(rawKind)} is unsupported`)
  }
  validateModel(spec.model, inputIds)
  validateItems(spec, inputIds, evidenceIds)
  if (spec.model.kind === 'formula-graph' && spec.model.selection.kind === 'top-n') {
    if (spec.model.selection.count > spec.items.length) {
      invalid('formula top-n selection count cannot exceed item count')
    }
  }
}
