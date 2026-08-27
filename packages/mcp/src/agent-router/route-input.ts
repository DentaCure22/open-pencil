import type { AgentTodoBrief } from './contracts'
import { normalizeTodoCodeObjectBrief } from './todo-document'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function requiredText(value: unknown, field: string, maximum: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new TypeError(`${field} is required.`)
  if (text.length > maximum) throw new TypeError(`${field} is too long.`)
  return text
}

export function optionalText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined) return undefined
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length > maximum) throw new TypeError(`${field} is too long.`)
  return text || undefined
}

function optionalTextList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 24) {
    throw new TypeError(`${field} must contain at most 24 items.`)
  }
  return value.map((item, index) => requiredText(item, `${field}[${String(index)}]`, 1_000))
}

export function todoBrief(value: unknown): AgentTodoBrief {
  if (!isRecord(value)) throw new TypeError('Todo brief is required.')
  const references = value.references
  if (references !== undefined && (!Array.isArray(references) || references.length > 24)) {
    throw new TypeError('Todo references must contain at most 24 items.')
  }
  const brief: AgentTodoBrief = {
    ...(optionalTextList(value.acceptance, 'acceptance')
      ? { acceptance: optionalTextList(value.acceptance, 'acceptance') }
      : {}),
    ...(optionalTextList(value.constraints, 'constraints')
      ? { constraints: optionalTextList(value.constraints, 'constraints') }
      : {}),
    ...(optionalText(value.context, 'context', 4_000)
      ? { context: optionalText(value.context, 'context', 4_000) }
      : {}),
    ...(optionalText(value.desiredOutcome, 'desiredOutcome', 2_000)
      ? { desiredOutcome: optionalText(value.desiredOutcome, 'desiredOutcome', 2_000) }
      : {}),
    ...(optionalText(value.documentHtml, 'documentHtml', 200_000)
      ? { documentHtml: optionalText(value.documentHtml, 'documentHtml', 200_000) }
      : {}),
    goal: requiredText(value.goal, 'Todo goal', 2_000),
    ...(optionalTextList(value.knownFacts, 'knownFacts')
      ? { knownFacts: optionalTextList(value.knownFacts, 'knownFacts') }
      : {}),
    ...(optionalTextList(value.openQuestions, 'openQuestions')
      ? { openQuestions: optionalTextList(value.openQuestions, 'openQuestions') }
      : {}),
    ...(Array.isArray(references)
      ? {
          references: references.map((reference, index) => {
            if (!isRecord(reference)) {
              throw new TypeError(`references[${String(index)}] is invalid.`)
            }
            const kind = requiredText(reference.kind, 'Reference kind', 40)
            if (
              !['board_object', 'chat', 'file', 'image', 'trace_evidence', 'url'].includes(kind)
            ) {
              throw new TypeError(`references[${String(index)}] has an invalid kind.`)
            }
            return {
              id: requiredText(reference.id, 'Reference ID', 1_000),
              kind: kind as NonNullable<AgentTodoBrief['references']>[number]['kind'],
              label: requiredText(reference.label, 'Reference label', 240),
              ...(optionalText(reference.note, 'Reference note', 1_000)
                ? { note: optionalText(reference.note, 'Reference note', 1_000) }
                : {})
            }
          })
        }
      : {}),
    ...(optionalText(value.suggestedNextStep, 'suggestedNextStep', 2_000)
      ? { suggestedNextStep: optionalText(value.suggestedNextStep, 'suggestedNextStep', 2_000) }
      : {}),
    ...(optionalText(value.title, 'title', 240)
      ? { title: optionalText(value.title, 'title', 240) }
      : {})
  }
  return normalizeTodoCodeObjectBrief(brief)
}
