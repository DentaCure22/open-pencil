import { WorkspaceDomainError } from '@/app/workspace'

import type {
  InteractiveProgramSpec,
  ProgramFormulaNode,
  ProgramFormulaOperand,
  ProgramItem,
  ProgramScenario
} from './types'

const MAX_ABSOLUTE_VALUE = 1_000_000_000_000

type FormulaEvaluation = {
  score: number
  trace: string
}

function invalid(message: string): never {
  throw new WorkspaceDomainError('validation_failed', message)
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_VALUE) {
    invalid(`${label} must be finite and no larger than ${MAX_ABSOLUTE_VALUE}`)
  }
  return value
}

function numberLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
}

function operandValue(
  operand: ProgramFormulaOperand,
  item: ProgramItem,
  scenario: ProgramScenario,
  resolveNode: (nodeId: string) => FormulaEvaluation
): FormulaEvaluation {
  if (operand.kind === 'constant') {
    return { score: finite(operand.value, 'formula constant'), trace: numberLabel(operand.value) }
  }
  if (operand.kind === 'input') {
    if (!Object.hasOwn(scenario, operand.inputId)) {
      invalid(`formula input ${operand.inputId} is unavailable`)
    }
    const value = scenario[operand.inputId]
    return {
      score: finite(value, `formula input ${operand.inputId}`),
      trace: `${operand.inputId} ${numberLabel(value)}`
    }
  }
  if (operand.kind === 'metric') {
    if (!Object.hasOwn(item.metrics, operand.metricId)) {
      invalid(`formula metric ${operand.metricId} is unavailable for ${item.id}`)
    }
    const value = item.metrics[operand.metricId]
    return {
      score: finite(value, `formula metric ${operand.metricId}`),
      trace: `${operand.metricId} ${numberLabel(value)}`
    }
  }
  return resolveNode(operand.nodeId)
}

function applyOperation(node: ProgramFormulaNode, values: FormulaEvaluation[]): FormulaEvaluation {
  const scores = values.map((value) => value.score)
  let score: number
  let symbol: string
  if (node.op === 'abs') {
    score = Math.abs(scores[0] ?? 0)
    return { score: finite(score, `formula node ${node.id}`), trace: `abs(${values[0]?.trace})` }
  }
  if (node.op === 'add') {
    score = scores.reduce((sum, value) => sum + value, 0)
    symbol = ' + '
  } else if (node.op === 'subtract') {
    score = (scores[0] ?? 0) - (scores[1] ?? 0)
    symbol = ' − '
  } else if (node.op === 'multiply') {
    score = scores.reduce((product, value) => product * value, 1)
    symbol = ' × '
  } else if (node.op === 'divide') {
    if (scores[1] === 0) invalid(`formula node ${node.id} cannot divide by zero`)
    score = (scores[0] ?? 0) / (scores[1] ?? 1)
    symbol = ' ÷ '
  } else if (node.op === 'min') {
    score = Math.min(...scores)
    symbol = ' min '
  } else {
    score = Math.max(...scores)
    symbol = ' max '
  }
  return {
    score: finite(score, `formula node ${node.id}`),
    trace: `(${values.map((value) => value.trace).join(symbol)})`
  }
}

export function evaluateFormulaGraph(
  spec: InteractiveProgramSpec,
  item: ProgramItem,
  scenario: ProgramScenario
): FormulaEvaluation {
  const model = spec.model
  if (model.kind !== 'formula-graph') invalid('formula graph model is required')
  const nodes = new Map(model.nodes.map((node) => [node.id, node]))
  const evaluated = new Map<string, FormulaEvaluation>()
  const visiting: string[] = []
  const resolveNode = (nodeId: string): FormulaEvaluation => {
    const existing = evaluated.get(nodeId)
    if (existing) return existing
    const cycleAt = visiting.indexOf(nodeId)
    if (cycleAt !== -1) {
      invalid(`formula cycle: ${[...visiting.slice(cycleAt), nodeId].join(' -> ')}`)
    }
    const node = nodes.get(nodeId)
    if (!node) invalid(`formula node ${nodeId} is unavailable`)
    visiting.push(nodeId)
    const values = node.operands.map((operand) =>
      operandValue(operand, item, scenario, resolveNode)
    )
    const result = applyOperation(node, values)
    visiting.pop()
    evaluated.set(nodeId, result)
    return result
  }
  const result = resolveNode(model.scoreNodeId)
  return { score: result.score, trace: `${result.trace} = ${numberLabel(result.score)}` }
}

export function formulaNodeDepth(nodes: ProgramFormulaNode[], scoreNodeId: string): number {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const visiting: string[] = []
  const depths = new Map<string, number>()
  const visit = (nodeId: string): number => {
    const known = depths.get(nodeId)
    if (known) return known
    const cycleAt = visiting.indexOf(nodeId)
    if (cycleAt !== -1) {
      invalid(`formula cycle: ${[...visiting.slice(cycleAt), nodeId].join(' -> ')}`)
    }
    const node = byId.get(nodeId)
    if (!node) invalid(`formula node ${nodeId} is unavailable`)
    visiting.push(nodeId)
    const dependencyDepths = node.operands
      .filter(
        (operand): operand is Extract<ProgramFormulaOperand, { kind: 'node' }> =>
          operand.kind === 'node'
      )
      .map((operand) => visit(operand.nodeId))
    visiting.pop()
    const depth = 1 + Math.max(0, ...dependencyDepths)
    depths.set(nodeId, depth)
    return depth
  }
  return visit(scoreNodeId)
}
