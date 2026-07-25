import type { SceneNode } from '@open-pencil/scene-graph'

import {
  enqueueAutomationMutation,
  type AutomationMutationMetadata
} from '@/app/automation/bridge/mutation-queue'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { isUnknownRecord } from '@/app/automation/bridge/target'
import {
  codeObjectDocument,
  codeObjectPluginData,
  codeObjectViewportInsets,
  createCodeObject,
  createUserCodeObjectDocument
} from '@/app/code-object/model'
import {
  isSmylrProductionDocumentGraph,
  saveSmylrProductionDocument
} from '@/app/smylr-production/document-state'

type CodeObjectUpsertArgs = {
  height?: number
  mutation?: AutomationMutationMetadata
  name: string
  objectKey: string
  persist: boolean
  props: Record<string, unknown>
  source?: string
  state: Record<string, unknown>
  width?: number
  x?: number
  y?: number
  zoomToSelection: boolean
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing "${key}".`)
  return value.trim()
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function recordValue(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  return isUnknownRecord(value) ? structuredClone(value) : {}
}

function parseUpsertArgs(value: unknown): CodeObjectUpsertArgs {
  if (!isUnknownRecord(value)) throw new Error('Code Object arguments must be an object.')
  return {
    height: optionalNumber(value, 'height'),
    mutation: isUnknownRecord(value.mutation)
      ? (value.mutation as AutomationMutationMetadata)
      : undefined,
    name: optionalString(value, 'name') ?? 'Code Object',
    objectKey: requiredString(value, 'object_key'),
    persist: value.persist === true,
    props: recordValue(value, 'props'),
    source: optionalString(value, 'source'),
    state: recordValue(value, 'state'),
    width: optionalNumber(value, 'width'),
    x: optionalNumber(value, 'x'),
    y: optionalNumber(value, 'y'),
    zoomToSelection: value.zoom_to_selection !== false
  }
}

function codeObjectByKey(target: AutomationTarget, objectKey: string): SceneNode | null {
  const matches = target.store.graph.getChildren(target.pageId).filter((node) => {
    const document = codeObjectDocument(node)
    return document?.component === 'user-code' && document.definitionId === objectKey
  })
  if (matches.length > 1) {
    throw new Error(
      `Code Object key "${objectKey}" is duplicated on board "${target.pageName}": ${matches
        .map((node) => node.id)
        .join(', ')}`
    )
  }
  return matches[0] ?? null
}

async function persistCodeObject(target: AutomationTarget, requested: boolean) {
  if (!requested) return { requested: false, status: 'not-requested' as const }
  if (isSmylrProductionDocumentGraph(target.store.graph)) {
    if (!(await saveSmylrProductionDocument(target.store))) {
      throw new Error('The Code Object was applied, but workspace persistence failed.')
    }
    return { requested: true, status: 'saved-workspace' as const }
  }
  if (await target.store.persistWritableDocumentSource()) {
    return { requested: true, status: 'saved-document' as const }
  }
  return { requested: true, status: 'requires-app-save' as const }
}

function resultFor(frame: SceneNode, persistence?: Awaited<ReturnType<typeof persistCodeObject>>) {
  const document = codeObjectDocument(frame)
  if (document?.component !== 'user-code') throw new Error('Code Object readback failed.')
  return {
    component: {
      definition_id: document.definitionId,
      name: document.name,
      props: document.props,
      source: document.source,
      source_length: document.source.length,
      state: document.state
    },
    frame: {
      height: frame.height,
      id: frame.id,
      name: frame.name,
      type: frame.type,
      width: frame.width,
      x: frame.x,
      y: frame.y
    },
    ...(persistence ? { persistence } : {})
  }
}

export function createAutomationCodeObjectUpsertHandler() {
  return async function handleCodeObjectUpsert(
    target: AutomationTarget,
    rawArgs: unknown
  ): Promise<unknown> {
    const args = parseUpsertArgs(rawArgs)
    const existing = codeObjectByKey(target, args.objectKey)
    const outcome = await enqueueAutomationMutation({
      metadata: args.mutation,
      target,
      toolArgs: existing ? { id: existing.id, source: args.source } : { source: args.source },
      toolName: 'upsert_code_object',
      run: async () => {
        if (target.store.state.currentPageId !== target.pageId) {
          await target.store.switchPage(target.pageId)
        }
        let frame: SceneNode
        if (existing) {
          const current = codeObjectDocument(existing)
          if (current?.component !== 'user-code') {
            throw new Error(`Frame "${existing.id}" is not an authored Code Object.`)
          }
          const document = createUserCodeObjectDocument({
            definitionId: current.definitionId,
            name: args.name,
            props: args.props,
            source: args.source ?? current.source,
            state: args.state
          })
          target.store.updateNodeWithUndo(
            existing.id,
            {
              ...(args.height === undefined ? {} : { height: args.height }),
              name: args.name,
              pluginData: codeObjectPluginData(existing, document),
              ...(args.width === undefined ? {} : { width: args.width }),
              ...(args.x === undefined ? {} : { x: args.x }),
              ...(args.y === undefined ? {} : { y: args.y })
            },
            'Update Code Object'
          )
          frame = target.store.graph.getNode(existing.id) ?? existing
        } else {
          if (!args.source) throw new Error('"source" is required when creating a Code Object.')
          const document = createUserCodeObjectDocument({
            definitionId: args.objectKey,
            name: args.name,
            props: args.props,
            source: args.source,
            state: args.state
          })
          frame = createCodeObject(target.store, {
            document,
            height: args.height ?? 520,
            name: args.name,
            width: args.width ?? 720,
            x: args.x,
            y: args.y
          })
        }
        target.store.select([frame.id])
        target.store.requestRender()
        if (args.zoomToSelection) {
          target.store.zoomToSelection(codeObjectViewportInsets())
        }
        const persistence = await persistCodeObject(target, args.persist)
        const currentFrame = target.store.graph.getNode(frame.id)
        if (!currentFrame) throw new Error('The Code Object disappeared during readback.')
        return resultFor(currentFrame, persistence)
      }
    })
    if (outcome.status === 'rejected') {
      return { applied: false, mutation_receipt: outcome.receipt }
    }
    return {
      ...outcome.value,
      applied: true,
      mutation_receipt: outcome.receipt
    }
  }
}

export function createAutomationCodeObjectReadHandler() {
  return async function handleCodeObjectRead(
    target: AutomationTarget,
    rawArgs: unknown
  ): Promise<unknown> {
    if (!isUnknownRecord(rawArgs)) throw new Error('Code Object arguments must be an object.')
    const objectKey = requiredString(rawArgs, 'object_key')
    const frame = codeObjectByKey(target, objectKey)
    if (!frame) {
      throw new Error(`Code Object "${objectKey}" was not found on board "${target.pageName}".`)
    }
    return resultFor(frame)
  }
}
