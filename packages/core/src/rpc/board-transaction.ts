import {
  canAddObjectGraphConnection,
  objectGraphConnectionById,
  objectGraphConnectionsOnPage,
  SceneGraph,
  setObjectGraphConnectionsOnPage,
  type ObjectGraphConnection,
  type SceneNode
} from '@open-pencil/scene-graph'

export type BoardTransactionNodeSnapshot = {
  node: SceneNode
  parentIndex: number
}

export type BoardTransactionConnectionSnapshot = {
  connection: ObjectGraphConnection
  index: number
}

export type BoardTransactionChange =
  | {
      after: BoardTransactionNodeSnapshot | null
      before: BoardTransactionNodeSnapshot | null
      entity: 'node'
      id: string
    }
  | {
      after: BoardTransactionConnectionSnapshot | null
      before: BoardTransactionConnectionSnapshot | null
      entity: 'connection'
      id: string
    }

export type BoardTransactionState = {
  connections: Map<string, BoardTransactionConnectionSnapshot>
  nodes: Map<string, BoardTransactionNodeSnapshot>
}

export type BoardTransactionDirection = 'after' | 'before'

export type BoardTransactionInspection = {
  alreadySatisfied: number
  applicable: number
  conflicts: string[]
  status: 'already_satisfied' | 'applicable' | 'conflict'
}

type ComparableRecord = { [key: string]: unknown }

function isComparableRecord(value: unknown): value is ComparableRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left instanceof Uint8Array || right instanceof Uint8Array) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => deepEqual(value, right[index]))
  }
  if (!isComparableRecord(left) || !isComparableRecord(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]))
  )
}

function nodeSnapshot(graph: SceneGraph, node: SceneNode): BoardTransactionNodeSnapshot {
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  return {
    node: structuredClone(node),
    parentIndex: parent ? parent.childIds.indexOf(node.id) : -1
  }
}

export function captureBoardTransactionState(
  graph: SceneGraph,
  pageId: string
): BoardTransactionState {
  const nodes = new Map<string, BoardTransactionNodeSnapshot>()
  const page = graph.getNode(pageId)
  const visit = (id: string): void => {
    const node = graph.getNode(id)
    if (!node) return
    nodes.set(id, nodeSnapshot(graph, node))
    for (const childId of node.childIds) visit(childId)
  }
  for (const childId of page?.childIds ?? []) visit(childId)
  return {
    connections: new Map(
      objectGraphConnectionsOnPage(graph, pageId).map((connection, index) => [
        connection.id,
        { connection: structuredClone(connection), index }
      ])
    ),
    nodes
  }
}

export function diffBoardTransactionStates(
  before: BoardTransactionState,
  after: BoardTransactionState
): BoardTransactionChange[] {
  const changes: BoardTransactionChange[] = []
  const nodeIds = [...new Set([...before.nodes.keys(), ...after.nodes.keys()])].sort()
  for (const id of nodeIds) {
    const beforeNode = before.nodes.get(id) ?? null
    const afterNode = after.nodes.get(id) ?? null
    if (!deepEqual(beforeNode, afterNode)) {
      changes.push({
        after: afterNode ? structuredClone(afterNode) : null,
        before: beforeNode ? structuredClone(beforeNode) : null,
        entity: 'node',
        id
      })
    }
  }
  const connectionIds = [
    ...new Set([...before.connections.keys(), ...after.connections.keys()])
  ].sort()
  for (const id of connectionIds) {
    const beforeConnection = before.connections.get(id) ?? null
    const afterConnection = after.connections.get(id) ?? null
    if (!deepEqual(beforeConnection, afterConnection)) {
      changes.push({
        after: afterConnection ? structuredClone(afterConnection) : null,
        before: beforeConnection ? structuredClone(beforeConnection) : null,
        entity: 'connection',
        id
      })
    }
  }
  return changes
}

function currentValue(
  graph: SceneGraph,
  pageId: string,
  change: BoardTransactionChange
): BoardTransactionChange['before'] {
  if (change.entity === 'connection') {
    const connections = objectGraphConnectionsOnPage(graph, pageId)
    const index = connections.findIndex((connection) => connection.id === change.id)
    const connection = objectGraphConnectionById(graph, pageId, change.id)
    return connection && index !== -1 ? { connection: structuredClone(connection), index } : null
  }
  const node = graph.getNode(change.id)
  return node && graph.isDescendant(node.id, pageId) ? nodeSnapshot(graph, node) : null
}

export function inspectBoardTransactionChanges(
  graph: SceneGraph,
  pageId: string,
  changes: readonly BoardTransactionChange[],
  direction: BoardTransactionDirection
): BoardTransactionInspection {
  let alreadySatisfied = 0
  let applicable = 0
  const conflicts: string[] = []
  const sourceKey = direction === 'before' ? 'after' : 'before'
  for (const change of changes) {
    const current = currentValue(graph, pageId, change)
    if (deepEqual(current, change[direction])) {
      alreadySatisfied += 1
    } else if (deepEqual(current, change[sourceKey])) {
      applicable += 1
    } else {
      conflicts.push(`${change.entity}:${change.id}`)
    }
  }
  let status: BoardTransactionInspection['status'] = 'already_satisfied'
  if (conflicts.length > 0) status = 'conflict'
  else if (applicable > 0) status = 'applicable'
  return {
    alreadySatisfied,
    applicable,
    conflicts,
    status
  }
}

function cloneGraphForTransaction(graph: SceneGraph): SceneGraph {
  const clone = new SceneGraph()
  clone.rootId = graph.rootId
  clone.nodes = new Map([...graph.nodes].map(([id, node]) => [id, structuredClone(node)] as const))
  clone.instanceIndex = new Map(
    [...graph.instanceIndex].map(([id, nodeIds]) => [id, new Set(nodeIds)] as const)
  )
  return clone
}

function currentNodeDepth(graph: SceneGraph, id: string): number {
  let depth = 0
  let parentId = graph.getNode(id)?.parentId ?? null
  while (parentId) {
    depth += 1
    parentId = graph.getNode(parentId)?.parentId ?? null
  }
  return depth
}

function currentNodeSnapshot(graph: SceneGraph, id: string): BoardTransactionNodeSnapshot | null {
  const node = graph.getNode(id)
  return node ? nodeSnapshot(graph, node) : null
}

function applyNodeChanges(
  graph: SceneGraph,
  changes: readonly Extract<BoardTransactionChange, { entity: 'node' }>[],
  direction: BoardTransactionDirection
): void {
  const desiredChanges = changes.filter(
    (change) => !deepEqual(currentNodeSnapshot(graph, change.id), change[direction])
  )
  const deletions = desiredChanges
    .filter((change) => change[direction] === null)
    .sort((left, right) => currentNodeDepth(graph, right.id) - currentNodeDepth(graph, left.id))
  for (const change of deletions) graph.deleteNode(change.id)

  const creations = desiredChanges.filter(
    (change) => change[direction] !== null && !graph.getNode(change.id)
  )
  const pending = [...creations]
  while (pending.length > 0) {
    const readyIndex = pending.findIndex((change) => {
      const desired = change[direction]
      return desired?.node.parentId ? Boolean(graph.getNode(desired.node.parentId)) : false
    })
    if (readyIndex === -1) {
      throw new Error('Transaction restore contains a node whose parent is unavailable.')
    }
    const change = pending.splice(readyIndex, 1)[0]
    const desired = change[direction]
    if (!desired?.node.parentId) throw new Error('Transaction restore node has no parent.')
    const { childIds: _childIds, id: _id, parentId: _parentId, type, ...rest } = desired.node
    graph.createNodeWithId(change.id, type, desired.node.parentId, { ...rest, childIds: [] })
  }

  for (const change of desiredChanges) {
    const desired = change[direction]
    const current = graph.getNode(change.id)
    if (!desired || !current) continue
    if (current.type !== desired.node.type) {
      throw new Error(`Transaction restore conflicts with node type for "${change.id}".`)
    }
    if (current.parentId !== desired.node.parentId) {
      if (!desired.node.parentId) throw new Error('Transaction restore node has no parent.')
      graph.reparentNode(change.id, desired.node.parentId)
    }
    const {
      childIds: _childIds,
      id: _id,
      parentId: _parentId,
      type: _type,
      ...changesToApply
    } = desired.node
    graph.updateNode(change.id, changesToApply)
  }
  for (const change of desiredChanges) {
    const desired = change[direction]
    if (desired?.node.parentId && graph.getNode(change.id)) {
      graph.insertChildAt(change.id, desired.node.parentId, desired.parentIndex)
    }
  }
}

function applyConnectionChanges(
  graph: SceneGraph,
  pageId: string,
  changes: readonly Extract<BoardTransactionChange, { entity: 'connection' }>[],
  direction: BoardTransactionDirection
): void {
  const changedIds = new Set(changes.map((change) => change.id))
  const connections = objectGraphConnectionsOnPage(graph, pageId).filter(
    (connection) => !changedIds.has(connection.id)
  )
  setObjectGraphConnectionsOnPage(graph, pageId, connections)
  const desiredConnections = changes
    .map((change) => change[direction])
    .filter((snapshot): snapshot is BoardTransactionConnectionSnapshot => snapshot !== null)
    .sort((left, right) => left.index - right.index)
  for (const desired of desiredConnections) {
    const connection = desired.connection
    if (!canAddObjectGraphConnection(graph, pageId, connection, connection.id)) {
      throw new Error(`Transaction restore conflicts with connection "${connection.id}".`)
    }
    connections.splice(desired.index, 0, structuredClone(connection))
    setObjectGraphConnectionsOnPage(graph, pageId, connections)
  }
}

function applyUnchecked(
  graph: SceneGraph,
  pageId: string,
  changes: readonly BoardTransactionChange[],
  direction: BoardTransactionDirection
): void {
  applyNodeChanges(
    graph,
    changes.filter(
      (change): change is Extract<BoardTransactionChange, { entity: 'node' }> =>
        change.entity === 'node'
    ),
    direction
  )
  applyConnectionChanges(
    graph,
    pageId,
    changes.filter(
      (change): change is Extract<BoardTransactionChange, { entity: 'connection' }> =>
        change.entity === 'connection'
    ),
    direction
  )
}

export function applyBoardTransactionChanges(
  graph: SceneGraph,
  pageId: string,
  changes: readonly BoardTransactionChange[],
  direction: BoardTransactionDirection
): BoardTransactionInspection {
  const inspection = inspectBoardTransactionChanges(graph, pageId, changes, direction)
  if (inspection.conflicts.length > 0) {
    throw new Error(
      `Transaction restore conflicts with current Board state: ${inspection.conflicts.join(', ')}.`
    )
  }
  if (inspection.applicable === 0) return inspection
  applyUnchecked(cloneGraphForTransaction(graph), pageId, changes, direction)
  applyUnchecked(graph, pageId, changes, direction)
  return inspection
}
