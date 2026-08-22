import { randomHex } from '@open-pencil/core/random'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  boardNodeMatchesOwner,
  boundedBoardNumber,
  deleteBoardLeaf,
  normalizeBoardAppearanceChanges,
  normalizeBoardGeometryChanges,
  normalizeOwnedBoardGeometry,
  restoreBoardLeaf,
  runBoardMutation,
  type BoardPermission,
  type BoardPermissionDescriptor
} from '@/app/board-permissions'
import {
  createUserCodeObjectDocument,
  reactShapeDocument as codeObjectDocument,
  reactShapePluginData as codeObjectPluginData
} from '@/app/code-object/implementation'
import type { EditorStore } from '@/app/editor/active-store'

import type {
  BoardComponentClient,
  BoardComponentCreateInput,
  BoardComponentDenialReason,
  BoardComponentLifecycle,
  BoardComponentMutationOptions,
  BoardComponentReceipt,
  BoardComponentSession,
  BoardComponentSessionContext,
  BoardComponentSnapshot,
  BoardComponentUpdateInput
} from './contracts'
import {
  componentLifecycle,
  COMPONENT_LIFECYCLE_KEY,
  COMPONENT_LIFECYCLE_PLUGIN_ID,
  COMPONENT_SESSION_KEY
} from './lifecycle'
import { removeOwnedTransientBoardComponents } from './transient'
import { requiredComponentUpdatePermissions } from './update-permissions'

const DEFAULT_MAX_OWNED_COMPONENTS = 96
const MAX_COMPONENT_SOURCE_LENGTH = 200_000
const MAX_COMPONENT_DATA_LENGTH = 100_000

type NormalizedComponentInput = {
  cornerRadius: number
  definitionId: string
  height: number
  lifecycle: BoardComponentLifecycle
  name: string
  props: Record<string, unknown>
  source: string
  state: Record<string, unknown>
  width: number
  x: number
  y: number
}

function actionId(): string {
  return `board-action:${randomHex(8)}`
}

function deniedReceipt(
  id: string,
  owner: BoardComponentSessionContext,
  type: BoardComponentReceipt['type'],
  reason: BoardComponentDenialReason,
  targetNodeId?: string
): BoardComponentReceipt {
  return {
    actionId: id,
    actorId: owner.actorId,
    changed: false,
    reason,
    status: 'denied',
    targetNodeId,
    type
  }
}

function mutationDenial(
  store: EditorStore,
  owner: BoardComponentSessionContext,
  requiredPermissions: readonly BoardPermission[]
): BoardComponentDenialReason | null {
  if (!owner.isActive()) return 'session-closed'
  const permission = runBoardMutation(store, owner, requiredPermissions, () => undefined)
  return permission.status === 'denied' ? permission.reason : null
}

function ownerPluginData(
  node: SceneNode,
  owner: BoardComponentSessionContext,
  lifecycle: BoardComponentLifecycle
): SceneNode['pluginData'] {
  return [
    ...node.pluginData.filter(
      (entry) =>
        (entry.pluginId !== owner.marker.pluginId || entry.key !== owner.marker.key) &&
        (entry.pluginId !== COMPONENT_LIFECYCLE_PLUGIN_ID ||
          ![COMPONENT_LIFECYCLE_KEY, COMPONENT_SESSION_KEY].includes(entry.key))
    ),
    {
      key: owner.marker.key,
      pluginId: owner.marker.pluginId,
      value: owner.marker.value
    },
    {
      key: COMPONENT_LIFECYCLE_KEY,
      pluginId: COMPONENT_LIFECYCLE_PLUGIN_ID,
      value: lifecycle
    },
    ...(lifecycle === 'transient'
      ? [
          {
            key: COMPONENT_SESSION_KEY,
            pluginId: COMPONENT_LIFECYCLE_PLUGIN_ID,
            value: owner.sessionId
          }
        ]
      : [])
  ]
}

function boardComponentSnapshot(
  store: EditorStore,
  node: SceneNode
): BoardComponentSnapshot | null {
  const document = codeObjectDocument(node)
  if (node.type !== 'FRAME' || !document) return null
  return {
    definitionId: document.definitionId,
    height: node.height,
    id: node.id,
    lifecycle: componentLifecycle(node),
    name: node.name,
    opacity: node.opacity,
    props: structuredClone(document.props),
    rotation: node.rotation,
    selected: store.state.selectedIds.has(node.id),
    source: document.source,
    state: structuredClone(document.state),
    visible: node.visible,
    width: node.width,
    x: node.x,
    y: node.y
  }
}

export function ownedBoardComponentSnapshots(
  store: EditorStore,
  owner: BoardComponentSessionContext
): BoardComponentSnapshot[] {
  if (mutationDenial(store, owner, [])) return []
  return store.graph
    .getChildren(owner.pageId)
    .filter((node) => boardNodeMatchesOwner(node, owner))
    .flatMap((node) => {
      const snapshot = boardComponentSnapshot(store, node)
      return snapshot ? [snapshot] : []
    })
}

function boundedRecord(value: unknown): Record<string, unknown> | null {
  if (!isUnknownRecord(value)) return null
  try {
    return JSON.stringify(value).length <= MAX_COMPONENT_DATA_LENGTH ? structuredClone(value) : null
  } catch {
    return null
  }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedComponentGeometry(
  owner: BoardComponentSessionContext,
  input: BoardComponentCreateInput,
  ownedCount: number
): Pick<NormalizedComponentInput, 'cornerRadius' | 'height' | 'width' | 'x' | 'y'> | null {
  const geometry = normalizeOwnedBoardGeometry(owner, input, ownedCount)
  const cornerRadius = boundedBoardNumber(input.cornerRadius, 0, 0, 2_500)
  return geometry && cornerRadius !== null ? { ...geometry, cornerRadius } : null
}

function normalizeComponentInput(
  owner: BoardComponentSessionContext,
  input: BoardComponentCreateInput,
  ownedCount: number
): NormalizedComponentInput | null {
  if (
    !isUnknownRecord(input) ||
    typeof input.definitionId !== 'string' ||
    typeof input.source !== 'string'
  ) {
    return null
  }
  const geometry = normalizedComponentGeometry(owner, input, ownedCount)
  const props = boundedRecord(input.props ?? {})
  const state = boundedRecord(input.state ?? {})
  const definitionId = input.definitionId.trim().slice(0, 160)
  const source = input.source.trim()
  if (
    !geometry ||
    !props ||
    !state ||
    !definitionId ||
    !source ||
    source.length > MAX_COMPONENT_SOURCE_LENGTH
  ) {
    return null
  }
  if (input.name !== undefined && typeof input.name !== 'string') return null
  if (input.lifecycle !== undefined && !['durable', 'transient'].includes(input.lifecycle)) {
    return null
  }
  return {
    ...geometry,
    definitionId,
    lifecycle: input.lifecycle ?? 'durable',
    name: (input.name?.trim() || 'Board component').slice(0, 120),
    props,
    source,
    state
  }
}

function createOwnedBoardComponent(
  store: EditorStore,
  owner: BoardComponentSessionContext,
  input: BoardComponentCreateInput,
  options: BoardComponentMutationOptions = {},
  id = actionId()
): BoardComponentReceipt {
  const denial = mutationDenial(store, owner, ['component.create'])
  if (denial) return deniedReceipt(id, owner, 'board.component.create', denial)
  const owned = ownedBoardComponentSnapshots(store, owner)
  if (owned.length >= (owner.maxComponents ?? DEFAULT_MAX_OWNED_COMPONENTS)) {
    return deniedReceipt(id, owner, 'board.component.create', 'component-limit')
  }
  const normalized = normalizeComponentInput(owner, input, owned.length)
  if (!normalized || !store.graph.getNode(owner.pageId)) {
    return deniedReceipt(id, owner, 'board.component.create', 'invalid-payload')
  }
  const document = createUserCodeObjectDocument({
    definitionId: normalized.definitionId,
    name: normalized.name,
    props: normalized.props,
    source: normalized.source,
    state: normalized.state
  })
  const frame = store.graph.createNode('FRAME', owner.pageId, {
    clipsContent: true,
    cornerRadius: normalized.cornerRadius,
    fills: [],
    height: normalized.height,
    name: normalized.name,
    pluginData: [],
    strokes: [],
    width: normalized.width,
    x: normalized.x,
    y: normalized.y
  })
  store.graph.updateNode(frame.id, {
    pluginData: ownerPluginData(
      { ...frame, pluginData: codeObjectPluginData(frame, document) },
      owner,
      normalized.lifecycle
    )
  })
  const created = store.graph.getNode(frame.id)
  if (!created) return deniedReceipt(id, owner, 'board.component.create', 'action-failed')
  if ((options.history ?? 'undoable') === 'undoable') {
    const snapshot = structuredClone(created)
    store.undo.push({
      label: owner.labels.create,
      forward: () => {
        restoreBoardLeaf(store, snapshot)
        store.requestRender()
      },
      inverse: () => {
        store.graph.deleteNode(snapshot.id)
        store.select(
          [...store.state.selectedIds].filter((selectedId) => selectedId !== snapshot.id)
        )
        store.requestRender()
      }
    })
  }
  store.requestOverlayRepaint()
  return {
    actionId: id,
    actorId: owner.actorId,
    changed: true,
    component: boardComponentSnapshot(store, created) ?? undefined,
    status: 'applied',
    targetNodeId: created.id,
    type: 'board.component.create'
  }
}

function ownedComponentTarget(
  store: EditorStore,
  owner: BoardComponentSessionContext,
  componentId: string
): SceneNode | null {
  const target = store.graph.getNode(componentId)
  if (!target || target.parentId !== owner.pageId || !codeObjectDocument(target)) return null
  return boardNodeMatchesOwner(target, owner) ? target : null
}

function normalizedGeometryChanges(input: BoardComponentUpdateInput): Partial<SceneNode> | null {
  const geometry = normalizeBoardGeometryChanges(input)
  const appearance = normalizeBoardAppearanceChanges(input, 'Board component')
  return geometry && appearance ? { ...geometry, ...appearance } : null
}

function normalizedDocumentChanges(
  target: SceneNode,
  input: BoardComponentUpdateInput,
  owner: BoardComponentSessionContext,
  name: string | undefined
): Pick<SceneNode, 'pluginData'> | null {
  const document = codeObjectDocument(target)
  if (document?.component !== 'user-code') return null
  if (input.source !== undefined && typeof input.source !== 'string') return null
  const props = input.props === undefined ? document.props : boundedRecord(input.props)
  const state = input.state === undefined ? document.state : boundedRecord(input.state)
  const source = input.source === undefined ? document.source : input.source.trim()
  if (!props || !state || !source || source.length > MAX_COMPONENT_SOURCE_LENGTH) return null
  const nextDocument = {
    ...document,
    name: name ?? document.name,
    props,
    source,
    state
  }
  return {
    pluginData: ownerPluginData(
      { ...target, pluginData: codeObjectPluginData(target, nextDocument) },
      owner,
      componentLifecycle(target)
    )
  }
}

function normalizedComponentChanges(
  target: SceneNode,
  input: BoardComponentUpdateInput,
  owner: BoardComponentSessionContext
): Partial<SceneNode> | null {
  if (!isUnknownRecord(input)) return null
  const geometry = normalizedGeometryChanges(input)
  if (!geometry) return null
  const changesDocument =
    input.props !== undefined ||
    input.state !== undefined ||
    input.source !== undefined ||
    input.name !== undefined
  if (!changesDocument) return geometry
  const document = normalizedDocumentChanges(target, input, owner, geometry.name)
  return document ? { ...geometry, ...document } : null
}

function updateOwnedBoardComponent(
  store: EditorStore,
  owner: BoardComponentSessionContext,
  componentId: string,
  input: BoardComponentUpdateInput,
  options: BoardComponentMutationOptions = {},
  id = actionId()
): BoardComponentReceipt {
  if (!isUnknownRecord(input)) {
    return deniedReceipt(id, owner, 'board.component.update', 'invalid-payload', componentId)
  }
  const denial = mutationDenial(store, owner, requiredComponentUpdatePermissions(input))
  if (denial) return deniedReceipt(id, owner, 'board.component.update', denial, componentId)
  const target = ownedComponentTarget(store, owner, componentId)
  if (!target) {
    return deniedReceipt(
      id,
      owner,
      'board.component.update',
      store.graph.getNode(componentId) ? 'component-not-owned' : 'target-missing',
      componentId
    )
  }
  const changes = normalizedComponentChanges(target, input, owner)
  if (!changes) {
    return deniedReceipt(id, owner, 'board.component.update', 'invalid-payload', componentId)
  }
  const changed = Object.entries(changes).some(
    ([key, value]) => JSON.stringify(target[key as keyof SceneNode]) !== JSON.stringify(value)
  )
  if (!changed) {
    return {
      actionId: id,
      actorId: owner.actorId,
      changed: false,
      component: boardComponentSnapshot(store, target) ?? undefined,
      status: 'noop',
      targetNodeId: target.id,
      type: 'board.component.update'
    }
  }
  const history = options.history ?? 'undoable'
  if (history === 'undoable') {
    store.updateNodeWithUndo(target.id, changes, owner.labels.update)
  } else {
    store.graph.updateNodePreview(target.id, changes, { affectsScene: false })
    store.requestOverlayRepaint()
  }
  const updated = store.graph.getNode(target.id)
  return {
    actionId: id,
    actorId: owner.actorId,
    changed: true,
    component: updated ? (boardComponentSnapshot(store, updated) ?? undefined) : undefined,
    status: 'applied',
    targetNodeId: target.id,
    type: 'board.component.update'
  }
}

function deleteOwnedBoardComponent(
  store: EditorStore,
  owner: BoardComponentSessionContext,
  componentId: string,
  options: BoardComponentMutationOptions = {},
  id = actionId()
): BoardComponentReceipt {
  const denial = mutationDenial(store, owner, ['component.delete'])
  if (denial) return deniedReceipt(id, owner, 'board.component.delete', denial, componentId)
  const target = ownedComponentTarget(store, owner, componentId)
  if (!target) {
    return deniedReceipt(
      id,
      owner,
      'board.component.delete',
      store.graph.getNode(componentId) ? 'component-not-owned' : 'target-missing',
      componentId
    )
  }
  deleteBoardLeaf(store, target, owner.labels.delete, options.history ?? 'undoable')
  store.requestOverlayRepaint()
  return {
    actionId: id,
    actorId: owner.actorId,
    changed: true,
    status: 'applied',
    targetNodeId: target.id,
    type: 'board.component.delete'
  }
}

function createOwnedBoardComponentClient(
  store: EditorStore,
  owner: BoardComponentSessionContext
): BoardComponentClient {
  return {
    get components() {
      return ownedBoardComponentSnapshots(store, owner)
    },
    createComponent: (component, options) =>
      createOwnedBoardComponent(store, owner, component, options),
    deleteComponent: (componentId, options) =>
      deleteOwnedBoardComponent(store, owner, componentId, options),
    updateComponent: (componentId, changes, options) =>
      updateOwnedBoardComponent(store, owner, componentId, changes, options)
  }
}

export function createBoardComponentSession(
  store: EditorStore,
  descriptor: BoardPermissionDescriptor
): BoardComponentSession | null {
  let active = true
  const owner: BoardComponentSessionContext = {
    ...structuredClone(descriptor),
    isActive: () => active,
    sessionId: `board-component-session:${randomHex(8)}`
  }
  const permission = runBoardMutation(store, owner, [], () => undefined)
  if (permission.status === 'denied') return null
  return {
    board: createOwnedBoardComponentClient(store, owner),
    dispose: () => {
      if (!active) return []
      const removed = removeOwnedTransientBoardComponents(store, owner)
      active = false
      return removed
    }
  }
}
