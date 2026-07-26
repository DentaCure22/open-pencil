import { randomHex } from '@open-pencil/core/random'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  createUserCodeObjectDocument,
  reactShapeDocument as codeObjectDocument,
  reactShapePluginData as codeObjectPluginData
} from '@/app/code-object/implementation'
import type { EditorStore } from '@/app/editor/active-store'

import {
  componentLifecycle,
  COMPONENT_LIFECYCLE_KEY,
  COMPONENT_LIFECYCLE_PLUGIN_ID,
  COMPONENT_SESSION_KEY
} from './component-lifecycle'
import type {
  BoardAuthorityDenialReason,
  BoardAuthorityGrant,
  BoardComponentClient,
  BoardComponentCreateInput,
  BoardComponentLifecycle,
  BoardComponentMutationOptions,
  BoardComponentReceipt,
  BoardComponentSnapshot,
  BoardComponentUpdateInput
} from './contracts'
import { boardNodeMatchesGrant, isBoardAuthorityGrantActive } from './grants'
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

function receiptMetadata(owner: BoardAuthorityGrant) {
  return {
    apiVersion: owner.apiVersion,
    grantId: owner.grantId
  }
}

function deniedReceipt(
  id: string,
  owner: BoardAuthorityGrant,
  type: BoardComponentReceipt['type'],
  reason: BoardAuthorityDenialReason,
  targetNodeId?: string
): BoardComponentReceipt {
  return {
    actionId: id,
    actorId: owner.actorId,
    apiVersion: owner.apiVersion,
    changed: false,
    grantId: owner.grantId,
    reason,
    status: 'denied',
    targetNodeId,
    type
  }
}

function ownerPluginData(
  node: SceneNode,
  owner: BoardAuthorityGrant,
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
            value: owner.grantId
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
  owner: BoardAuthorityGrant
): BoardComponentSnapshot[] {
  if (!isBoardAuthorityGrantActive(store, owner)) return []
  return store.graph
    .getChildren(owner.pageId)
    .filter((node) => boardNodeMatchesGrant(node, owner))
    .flatMap((node) => {
      const snapshot = boardComponentSnapshot(store, node)
      return snapshot ? [snapshot] : []
    })
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number | null {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isFinite(resolved)) return null
  return Math.min(maximum, Math.max(minimum, resolved))
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
  owner: BoardAuthorityGrant,
  input: BoardComponentCreateInput,
  ownedCount: number
): Pick<NormalizedComponentInput, 'cornerRadius' | 'height' | 'width' | 'x' | 'y'> | null {
  const origin = owner.defaultOrigin
  const x = boundedNumber(
    input.x,
    origin.x + origin.width + 72 + ownedCount * 24,
    -1_000_000,
    1_000_000
  )
  const y = boundedNumber(input.y, origin.y + 64 + ownedCount * 24, -1_000_000, 1_000_000)
  const width = boundedNumber(input.width, 220, 24, 5_000)
  const height = boundedNumber(input.height, 160, 24, 5_000)
  const cornerRadius = boundedNumber(input.cornerRadius, 0, 0, 2_500)
  return x === null || y === null || width === null || height === null || cornerRadius === null
    ? null
    : { cornerRadius, height, width, x, y }
}

function normalizeComponentInput(
  owner: BoardAuthorityGrant,
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

function restoreComponent(store: EditorStore, snapshot: SceneNode) {
  if (store.graph.getNode(snapshot.id) || !snapshot.parentId) return
  const { childIds: _childIds, id, parentId, ...overrides } = structuredClone(snapshot)
  store.graph.createNodeWithId(id, snapshot.type, parentId, { ...overrides, childIds: [] })
}

function createOwnedBoardComponent(
  store: EditorStore,
  owner: BoardAuthorityGrant,
  input: BoardComponentCreateInput,
  options: BoardComponentMutationOptions = {},
  id = actionId()
): BoardComponentReceipt {
  if (!isBoardAuthorityGrantActive(store, owner)) {
    return deniedReceipt(id, owner, 'board.component.create', 'grant-invalid')
  }
  if (!owner.permissions.includes('component.create')) {
    return deniedReceipt(id, owner, 'board.component.create', 'capability-denied')
  }
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
        restoreComponent(store, snapshot)
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
    ...receiptMetadata(owner),
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
  owner: BoardAuthorityGrant,
  componentId: string
): SceneNode | null {
  const target = store.graph.getNode(componentId)
  if (!target || target.parentId !== owner.pageId || !codeObjectDocument(target)) return null
  return boardNodeMatchesGrant(target, owner) ? target : null
}

function normalizedGeometryChanges(input: BoardComponentUpdateInput): Partial<SceneNode> | null {
  const changes: Partial<SceneNode> = {}
  const numericDefinitions = [
    ['x', -1_000_000, 1_000_000],
    ['y', -1_000_000, 1_000_000],
    ['width', 24, 5_000],
    ['height', 24, 5_000],
    ['rotation', -360_000, 360_000],
    ['opacity', 0, 1]
  ] as const
  for (const [key, minimum, maximum] of numericDefinitions) {
    const inputValue = input[key]
    if (inputValue === undefined) continue
    const value = boundedNumber(inputValue, 0, minimum, maximum)
    if (value === null) return null
    changes[key] = key === 'rotation' ? ((value % 360) + 360) % 360 : value
  }
  if (input.visible !== undefined) {
    if (typeof input.visible !== 'boolean') return null
    changes.visible = input.visible
  }
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') return null
    changes.name = (input.name.trim() || 'Board component').slice(0, 120)
  }
  return changes
}

function normalizedDocumentChanges(
  target: SceneNode,
  input: BoardComponentUpdateInput,
  owner: BoardAuthorityGrant,
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
  owner: BoardAuthorityGrant
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
  owner: BoardAuthorityGrant,
  componentId: string,
  input: BoardComponentUpdateInput,
  options: BoardComponentMutationOptions = {},
  id = actionId()
): BoardComponentReceipt {
  if (!isBoardAuthorityGrantActive(store, owner)) {
    return deniedReceipt(id, owner, 'board.component.update', 'grant-invalid', componentId)
  }
  if (!isUnknownRecord(input)) {
    return deniedReceipt(id, owner, 'board.component.update', 'invalid-payload', componentId)
  }
  if (
    requiredComponentUpdatePermissions(input).some(
      (permission) => !owner.permissions.includes(permission)
    )
  ) {
    return deniedReceipt(id, owner, 'board.component.update', 'capability-denied', componentId)
  }
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
      ...receiptMetadata(owner),
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
    store.graph.updateNodePreview(target.id, changes)
    store.requestOverlayRepaint()
  }
  const updated = store.graph.getNode(target.id)
  return {
    ...receiptMetadata(owner),
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
  owner: BoardAuthorityGrant,
  componentId: string,
  options: BoardComponentMutationOptions = {},
  id = actionId()
): BoardComponentReceipt {
  if (!isBoardAuthorityGrantActive(store, owner)) {
    return deniedReceipt(id, owner, 'board.component.delete', 'grant-invalid', componentId)
  }
  if (!owner.permissions.includes('component.delete')) {
    return deniedReceipt(id, owner, 'board.component.delete', 'capability-denied', componentId)
  }
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
  const snapshot = structuredClone(target)
  const previousSelection = new Set(store.state.selectedIds)
  store.graph.deleteNode(target.id)
  store.select([...previousSelection].filter((selectedId) => selectedId !== target.id))
  if ((options.history ?? 'undoable') === 'undoable') {
    store.undo.push({
      label: owner.labels.delete,
      forward: () => {
        store.graph.deleteNode(snapshot.id)
        store.select(
          [...store.state.selectedIds].filter((selectedId) => selectedId !== snapshot.id)
        )
        store.requestRender()
      },
      inverse: () => {
        restoreComponent(store, snapshot)
        store.select([...previousSelection])
        store.requestRender()
      }
    })
  }
  store.requestOverlayRepaint()
  return {
    ...receiptMetadata(owner),
    actionId: id,
    actorId: owner.actorId,
    changed: true,
    status: 'applied',
    targetNodeId: target.id,
    type: 'board.component.delete'
  }
}

export function createOwnedBoardComponentClient(
  store: EditorStore,
  owner: BoardAuthorityGrant
): BoardComponentClient {
  return {
    apiVersion: owner.apiVersion,
    components: ownedBoardComponentSnapshots(store, owner),
    createComponent: (component, options) =>
      createOwnedBoardComponent(store, owner, component, options),
    deleteComponent: (componentId, options) =>
      deleteOwnedBoardComponent(store, owner, componentId, options),
    grantId: owner.grantId,
    permissions: structuredClone(owner.permissions),
    updateComponent: (componentId, changes, options) =>
      updateOwnedBoardComponent(store, owner, componentId, changes, options)
  }
}
