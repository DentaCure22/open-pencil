import type { Editor, ViewportInsets } from '@open-pencil/core/editor'
import {
  objectGraphConnectionById,
  objectGraphConnectionsForNode,
  projectObjectGraphNode,
  type ObjectGraphConnection,
  type SceneGraph
} from '@open-pencil/scene-graph'

import {
  SPATIAL_DIRECTION_VECTORS,
  type SpatialNavigationDirection
} from '@/app/editor/spatial-navigation'
import { objectGraphConnectionName } from '@/app/object-graph/records'

export type ObjectGraphNavigationDirection = SpatialNavigationDirection
export type ObjectGraphNavigationEndpoint = 'source' | 'target'

type NavigationCandidate = {
  connectionId: string
  distance: number
  nodeId: string
  offAxisRatio: number
}

type ObjectGraphViewportSnapshot = {
  panX: number
  panY: number
  zoom: number
}

type ObjectGraphNavigationSession = ObjectGraphNavigationState & {
  originPageId: string
  originSelection: string[]
  originViewport: ObjectGraphViewportSnapshot
}

export type ObjectGraphNavigationState = {
  activeConnectionId: string
  activeEndpointId: string
  activeEndpointName: string
  originLabel: string
}

export type ObjectGraphNavigation = {
  clear: () => void
  dispose: () => void
  fitConnection: (connectionId: string, insets?: ViewportInsets) => boolean
  focusConnection: (connectionId: string, insets?: ViewportInsets) => boolean
  focusEndpoint: (
    connectionId: string,
    endpoint: ObjectGraphNavigationEndpoint,
    insets?: ViewportInsets
  ) => boolean
  getState: () => ObjectGraphNavigationState | null
  navigateSelectedNodeInDirection: (
    direction: ObjectGraphNavigationDirection,
    insets?: ViewportInsets
  ) => boolean
  navigateSelectionInDirection: (
    direction: ObjectGraphNavigationDirection,
    insets?: ViewportInsets
  ) => boolean
  returnToOrigin: () => boolean
  subscribe: (listener: () => void) => () => void
}

function compareCandidates(first: NavigationCandidate, second: NavigationCandidate): number {
  return (
    first.offAxisRatio - second.offAxisRatio ||
    first.distance - second.distance ||
    first.nodeId.localeCompare(second.nodeId) ||
    first.connectionId.localeCompare(second.connectionId)
  )
}

export function connectedObjectGraphTargetInDirection(
  graph: SceneGraph,
  pageId: string,
  nodeId: string,
  direction: ObjectGraphNavigationDirection
): Pick<NavigationCandidate, 'connectionId' | 'nodeId'> | null {
  const current = graph.getNode(nodeId)
  if (!current) return null
  const origin = projectObjectGraphNode(current, graph).bounds
  const vector = SPATIAL_DIRECTION_VECTORS[direction]
  const candidates: NavigationCandidate[] = []

  for (const connection of objectGraphConnectionsForNode(graph, pageId, nodeId)) {
    const peerId =
      connection.sourceNodeId === nodeId ? connection.targetNodeId : connection.sourceNodeId
    const peer = graph.getNode(peerId)
    if (!peer || !graph.isDescendant(peer.id, pageId)) continue
    const target = projectObjectGraphNode(peer, graph).bounds
    const dx = target.centerX - origin.centerX
    const dy = target.centerY - origin.centerY
    const primary = dx * vector.x + dy * vector.y
    const perpendicular = Math.abs(dx * vector.y - dy * vector.x)
    if (primary <= 0 || perpendicular > primary) continue
    candidates.push({
      connectionId: connection.id,
      distance: Math.hypot(dx, dy),
      nodeId: peer.id,
      offAxisRatio: perpendicular / primary
    })
  }

  candidates.sort(compareCandidates)
  if (candidates.length === 0) return null
  const candidate = candidates[0]
  return { connectionId: candidate.connectionId, nodeId: candidate.nodeId }
}

export function connectedObjectGraphNodeInDirection(
  graph: SceneGraph,
  pageId: string,
  nodeId: string,
  direction: ObjectGraphNavigationDirection
): string | null {
  return connectedObjectGraphTargetInDirection(graph, pageId, nodeId, direction)?.nodeId ?? null
}

function connectionEndpointId(
  connection: ObjectGraphConnection,
  endpoint: ObjectGraphNavigationEndpoint
): string {
  return endpoint === 'source' ? connection.sourceNodeId : connection.targetNodeId
}

function connectionEndpointInDirection(
  editor: Editor,
  connection: ObjectGraphConnection,
  direction: ObjectGraphNavigationDirection
): ObjectGraphNavigationEndpoint | null {
  const source = editor.graph.getNode(connection.sourceNodeId)
  const target = editor.graph.getNode(connection.targetNodeId)
  if (!source || !target) return null
  const sourceBounds = projectObjectGraphNode(source, editor.graph).bounds
  const targetBounds = projectObjectGraphNode(target, editor.graph).bounds
  const midpoint = {
    x: (sourceBounds.centerX + targetBounds.centerX) / 2,
    y: (sourceBounds.centerY + targetBounds.centerY) / 2
  }
  const vector = SPATIAL_DIRECTION_VECTORS[direction]
  const sourcePrimary =
    (sourceBounds.centerX - midpoint.x) * vector.x + (sourceBounds.centerY - midpoint.y) * vector.y
  const targetPrimary =
    (targetBounds.centerX - midpoint.x) * vector.x + (targetBounds.centerY - midpoint.y) * vector.y
  const best = Math.max(sourcePrimary, targetPrimary)
  if (best <= 0.001) return null
  return sourcePrimary > targetPrimary ? 'source' : 'target'
}

function validSelectionId(editor: Editor, pageId: string, id: string): boolean {
  return Boolean(editor.graph.getNode(id) || objectGraphConnectionById(editor.graph, pageId, id))
}

function singleSelectedId(editor: Editor): string | null {
  if (editor.state.selectedIds.size !== 1) return null
  const selectedId = editor.state.selectedIds.values().next().value
  return typeof selectedId === 'string' ? selectedId : null
}

function selectedOriginLabel(editor: Editor, selectedIds: string[]): string {
  if (selectedIds.length !== 1) return 'previous view'
  const selectedId = selectedIds[0]
  if (!selectedId) return 'previous view'
  const selectedNode = editor.graph.getNode(selectedId)
  if (selectedNode) return selectedNode.name
  const connection = objectGraphConnectionById(editor.graph, editor.state.currentPageId, selectedId)
  return connection ? objectGraphConnectionName(editor.graph, connection) : 'previous view'
}

function fitObjectGraphConnection(
  editor: Editor,
  connection: ObjectGraphConnection,
  insets?: ViewportInsets
): boolean {
  const source = editor.graph.getNode(connection.sourceNodeId)
  const target = editor.graph.getNode(connection.targetNodeId)
  if (!source || !target) return false
  const sourceBounds = projectObjectGraphNode(source, editor.graph).bounds
  const targetBounds = projectObjectGraphNode(target, editor.graph).bounds
  editor.zoomToBounds(
    Math.min(sourceBounds.boundX, targetBounds.boundX),
    Math.min(sourceBounds.boundY, targetBounds.boundY),
    Math.max(sourceBounds.boundX + sourceBounds.width, targetBounds.boundX + targetBounds.width),
    Math.max(sourceBounds.boundY + sourceBounds.height, targetBounds.boundY + targetBounds.height),
    insets
  )
  return true
}

export function createObjectGraphNavigation(editor: Editor): ObjectGraphNavigation {
  const listeners = new Set<() => void>()
  let restoring = false
  let session: ObjectGraphNavigationSession | null = null

  function notify(): void {
    listeners.forEach((listener) => listener())
  }

  function clear(): void {
    if (session) {
      session = null
      notify()
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }

  function getState(): ObjectGraphNavigationState | null {
    if (!session) return null
    return {
      activeConnectionId: session.activeConnectionId,
      activeEndpointId: session.activeEndpointId,
      activeEndpointName: session.activeEndpointName,
      originLabel: session.originLabel
    }
  }

  function startSession(connectionId: string, endpointId: string, activeName?: string): boolean {
    const endpoint = editor.graph.getNode(endpointId)
    if (!endpoint) return false
    const previous = session
    session = {
      activeConnectionId: connectionId,
      activeEndpointId: endpoint.id,
      activeEndpointName: activeName ?? endpoint.name,
      originLabel:
        previous?.originLabel ?? selectedOriginLabel(editor, [...editor.state.selectedIds]),
      originPageId: previous?.originPageId ?? editor.state.currentPageId,
      originSelection: previous?.originSelection ?? [...editor.state.selectedIds],
      originViewport: previous?.originViewport ?? {
        panX: editor.state.panX,
        panY: editor.state.panY,
        zoom: editor.state.zoom
      }
    }
    return true
  }

  function fitConnection(connectionId: string, insets?: ViewportInsets): boolean {
    const connection = objectGraphConnectionById(
      editor.graph,
      editor.state.currentPageId,
      connectionId
    )
    return connection ? fitObjectGraphConnection(editor, connection, insets) : false
  }

  function focusConnection(connectionId: string, insets?: ViewportInsets): boolean {
    const connection = objectGraphConnectionById(
      editor.graph,
      editor.state.currentPageId,
      connectionId
    )
    if (!connection) return false
    clear()
    editor.select([connection.id])
    return fitObjectGraphConnection(editor, connection, insets)
  }

  function focusEndpoint(
    connectionId: string,
    endpoint: ObjectGraphNavigationEndpoint,
    insets?: ViewportInsets
  ): boolean {
    const connection = objectGraphConnectionById(
      editor.graph,
      editor.state.currentPageId,
      connectionId
    )
    if (!connection) return false
    const endpointId = connectionEndpointId(connection, endpoint)
    if (!startSession(connection.id, endpointId)) return false
    editor.select([endpointId])
    editor.revealNode(endpointId, insets)
    notify()
    return true
  }

  function navigateSelectedNodeInDirection(
    direction: ObjectGraphNavigationDirection,
    insets?: ViewportInsets
  ): boolean {
    const selectedId = singleSelectedId(editor)
    if (!selectedId || !editor.graph.getNode(selectedId)) return false
    const connections = objectGraphConnectionsForNode(
      editor.graph,
      editor.state.currentPageId,
      selectedId
    )
    if (connections.length === 0) return false
    const target = connectedObjectGraphTargetInDirection(
      editor.graph,
      editor.state.currentPageId,
      selectedId,
      direction
    )
    if (!target) return true
    if (!startSession(target.connectionId, target.nodeId)) return true
    editor.select([target.nodeId])
    editor.revealNode(target.nodeId, insets)
    notify()
    return true
  }

  function navigateSelectionInDirection(
    direction: ObjectGraphNavigationDirection,
    insets?: ViewportInsets
  ): boolean {
    const selectedId = singleSelectedId(editor)
    if (!selectedId) return false
    const connection = objectGraphConnectionById(
      editor.graph,
      editor.state.currentPageId,
      selectedId
    )
    if (connection) {
      const endpoint = connectionEndpointInDirection(editor, connection, direction)
      if (!endpoint) return true
      return focusEndpoint(connection.id, endpoint, insets)
    }

    const selectedNode = editor.graph.getNode(selectedId)
    if (!session || !selectedNode) return false
    const target = connectedObjectGraphTargetInDirection(
      editor.graph,
      editor.state.currentPageId,
      selectedNode.id,
      direction
    )
    if (!target) return true
    const nextConnection = objectGraphConnectionById(
      editor.graph,
      editor.state.currentPageId,
      target.connectionId
    )
    if (!nextConnection) return true
    if (
      !startSession(
        nextConnection.id,
        selectedNode.id,
        objectGraphConnectionName(editor.graph, nextConnection)
      )
    ) {
      return true
    }
    editor.select([nextConnection.id])
    editor.revealNode(target.nodeId, insets)
    notify()
    return true
  }

  function returnToOrigin(): boolean {
    if (!session || session.originPageId !== editor.state.currentPageId) return false
    const origin = session
    session = null
    restoring = true
    try {
      editor.setViewport(origin.originViewport)
      editor.select(
        origin.originSelection.filter((id) => validSelectionId(editor, origin.originPageId, id))
      )
    } finally {
      restoring = false
    }
    notify()
    return true
  }

  function validateSession(): void {
    if (!session) return
    const connection = objectGraphConnectionById(
      editor.graph,
      editor.state.currentPageId,
      session.activeConnectionId
    )
    if (!connection || !editor.graph.getNode(session.activeEndpointId)) clear()
  }

  const unsubscribes = [
    editor.onEditorEvent('graph:replaced', clear),
    editor.onEditorEvent('page:changed', clear),
    editor.onEditorEvent('node:deleted', validateSession),
    editor.onEditorEvent('node:updated', validateSession),
    editor.onEditorEvent('selection:changed', (selectedIds) => {
      if (
        restoring ||
        !session ||
        (selectedIds.length === 1 &&
          (selectedIds[0] === session.activeEndpointId ||
            selectedIds[0] === session.activeConnectionId))
      ) {
        return
      }
      clear()
    })
  ]

  function dispose(): void {
    for (const unsubscribe of unsubscribes) unsubscribe()
    listeners.clear()
    session = null
  }

  return {
    clear,
    dispose,
    fitConnection,
    focusConnection,
    focusEndpoint,
    getState,
    navigateSelectedNodeInDirection,
    navigateSelectionInDirection,
    returnToOrigin,
    subscribe
  }
}
