import { WorkspaceDomainError } from '@/app/workspace'

import { evaluateFormulaGraph } from './formula'
import type { InteractiveProgramSpec, ProgramResult, ProgramScenario } from './types'

export function defaultProgramScenario(spec: InteractiveProgramSpec): ProgramScenario {
  return Object.fromEntries(spec.inputs.map((input) => [input.id, input.defaultValue]))
}

function boundedScenario(spec: InteractiveProgramSpec, scenario: ProgramScenario): ProgramScenario {
  return Object.fromEntries(
    spec.inputs.map((input) => {
      const value = scenario[input.id] ?? input.defaultValue
      if (!Number.isFinite(value)) {
        throw new WorkspaceDomainError('validation_failed', `program input ${input.id} is invalid`)
      }
      if (value < input.min || value > input.max) {
        throw new WorkspaceDomainError(
          'validation_failed',
          `program input ${input.id} is outside its declared range`
        )
      }
      return [input.id, value]
    })
  )
}

function weightedResults(spec: InteractiveProgramSpec, scenario: ProgramScenario): ProgramResult[] {
  return spec.items
    .map((item) => ({
      evidenceItemIds: item.evidenceItemIds,
      explanation: spec.inputs
        .map((input) => `${input.label} ${item.metrics[input.id]} × ${scenario[input.id]}`)
        .join(' · '),
      itemId: item.id,
      label: item.label,
      score: spec.inputs.reduce(
        (sum, input) => sum + item.metrics[input.id] * scenario[input.id],
        0
      ),
      selected: false
    }))
    .sort((left, right) => right.score - left.score || left.itemId.localeCompare(right.itemId))
    .map((result, index) => ({ ...result, rank: index + 1, selected: index === 0 }))
}

function capacityResults(spec: InteractiveProgramSpec, scenario: ProgramScenario): ProgramResult[] {
  const model = spec.model
  if (model.kind !== 'capacity-planner') return []
  const capacity = scenario[model.capacityInputId]
  let used = 0
  return spec.items
    .map((item) => {
      const effort = item.metrics[model.effortMetricId]
      const value = item.metrics[model.valueMetricId]
      if (effort <= 0) {
        throw new WorkspaceDomainError(
          'validation_failed',
          `capacity effort must be greater than zero for ${item.id}`
        )
      }
      return { effort, item, score: value / effort, value }
    })
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
    .map((candidate, index) => {
      const selected = used + candidate.effort <= capacity
      if (selected) used += candidate.effort
      return {
        evidenceItemIds: candidate.item.evidenceItemIds,
        explanation: `${candidate.value} value / ${candidate.effort} effort · ${selected ? `${used}/${capacity} capacity used` : 'does not fit remaining capacity'}`,
        itemId: candidate.item.id,
        label: candidate.item.label,
        rank: index + 1,
        score: candidate.score,
        selected
      }
    })
}

function formulaResults(spec: InteractiveProgramSpec, scenario: ProgramScenario): ProgramResult[] {
  const model = spec.model
  if (model.kind !== 'formula-graph') return []
  const ranked = spec.items
    .map((item) => {
      const evaluated = evaluateFormulaGraph(spec, item, scenario)
      return {
        evidenceItemIds: item.evidenceItemIds,
        explanation: evaluated.trace,
        itemId: item.id,
        label: item.label,
        score: evaluated.score,
        selected: false
      }
    })
    .sort((left, right) => {
      const difference =
        model.order === 'descending' ? right.score - left.score : left.score - right.score
      return difference || left.itemId.localeCompare(right.itemId)
    })
  return ranked.map((result, index) => {
    let selected: boolean
    if (model.selection.kind === 'top-n') selected = index < model.selection.count
    else if (model.selection.comparator === 'gte') selected = result.score >= model.selection.value
    else selected = result.score <= model.selection.value
    return { ...result, rank: index + 1, selected }
  })
}

export function evaluateInteractiveProgram(
  spec: InteractiveProgramSpec,
  scenario: ProgramScenario
): { results: ProgramResult[]; scenario: ProgramScenario } {
  const bounded = boundedScenario(spec, scenario)
  let results: ProgramResult[]
  switch (spec.model.kind) {
    case 'weighted-priority':
      results = weightedResults(spec, bounded)
      break
    case 'capacity-planner':
      results = capacityResults(spec, bounded)
      break
    case 'formula-graph':
      results = formulaResults(spec, bounded)
      break
    default: {
      const exhaustive: never = spec.model
      throw new WorkspaceDomainError(
        'validation_failed',
        `unsupported interactive program model ${String(exhaustive)}`
      )
    }
  }
  return { results, scenario: bounded }
}
