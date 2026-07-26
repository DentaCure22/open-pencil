import {
  ConnectionMode,
  ReactFlow,
  type Connection,
  type EdgeChange,
  type IsValidConnection,
  type OnReconnect,
  type ReactFlowInstance,
  type Viewport
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { flushSync } from 'react-dom'

import {
  cancelEditorPresentationFrame,
  scheduleEditorPresentationFrame,
  type EditorPresentationFrame
} from '@open-pencil/vue'

import type { EditorStore } from '@/app/editor/active-store'
import { connectObjects, disconnectObjects, reconnectObjects } from '@/app/object-graph/actions'
import {
  OBJECT_GRAPH_EDGE_TYPE,
  OBJECT_GRAPH_NODE_TYPE,
  canAddObjectGraphConnection,
  objectGraphReactFlowSnapshot,
  parseObjectGraphHandleSide,
  reconcileObjectGraphEdges,
  reconcileObjectGraphNodes,
  type ObjectGraphReactEdge,
  type ObjectGraphReactNode
} from '@/app/object-graph/react-flow'
import { OpenPencilObjectGraphEdge } from '@/app/object-graph/surface-edge'
import { OpenPencilObjectGraphNode } from '@/app/object-graph/surface-node'

import '@xyflow/react/dist/style.css'
import './surface.css'

type ObjectGraphSurfaceProps = {
  store: EditorStore
}

type ObjectGraphSurfaceStyle = CSSProperties & {
  '--openpencil-object-graph-inverse-zoom': string
  '--openpencil-object-graph-zoom': string
}

const NODE_TYPES = {
  [OBJECT_GRAPH_NODE_TYPE]: OpenPencilObjectGraphNode
}

const EDGE_TYPES = {
  [OBJECT_GRAPH_EDGE_TYPE]: OpenPencilObjectGraphEdge
}

const DIRECT_CONNECTION_KIND = 'action'

type ObjectGraphSurfaceFrame = {
  edges: ObjectGraphReactEdge[]
  nodes: ObjectGraphReactNode[]
}

function sameIds(current: ReadonlySet<string>, next: string[]): boolean {
  return current.size === next.length && next.every((id) => current.has(id))
}

function sameViewport(current: Viewport, next: Viewport): boolean {
  return current.x === next.x && current.y === next.y && current.zoom === next.zoom
}

function projectSurfaceFrame(
  store: EditorStore,
  onDisconnect: (connectionId: string) => void,
  current?: ObjectGraphSurfaceFrame
): ObjectGraphSurfaceFrame {
  const snapshot = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId, {
    hoveredNodeId: store.state.hoveredNodeId,
    onDisconnect,
    selectedIds: store.state.selectedIds
  })
  if (!current) return snapshot
  return {
    edges: reconcileObjectGraphEdges(current.edges, snapshot.edges),
    nodes: reconcileObjectGraphNodes(current.nodes, snapshot.nodes)
  }
}

function sameSurfaceFrame(
  current: ObjectGraphSurfaceFrame,
  next: ObjectGraphSurfaceFrame
): boolean {
  return current.edges === next.edges && current.nodes === next.nodes
}

export function ObjectGraphSurface({ store }: ObjectGraphSurfaceProps) {
  const [connecting, setConnecting] = useState(false)
  const initialViewport = useMemo<Viewport>(
    () => ({
      x: store.state.panX,
      y: store.state.panY,
      zoom: store.state.zoom
    }),
    [store]
  )
  const removeConnection = useCallback(
    (connectionId: string) => {
      disconnectObjects(store, connectionId)
    },
    [store]
  )

  const [frame, setFrame] = useState<ObjectGraphSurfaceFrame>(() =>
    projectSurfaceFrame(store, removeConnection)
  )
  const projectionPending = useRef(true)
  const reactFlow = useRef<ReactFlowInstance<ObjectGraphReactNode, ObjectGraphReactEdge> | null>(
    null
  )
  const syncedViewport = useRef<Viewport | null>(null)
  const surface = useRef<HTMLDivElement | null>(null)

  const syncViewport = useCallback(
    (viewport?: Viewport) => {
      const instance = reactFlow.current
      if (!instance) return
      const next = viewport ?? {
        x: store.state.panX,
        y: store.state.panY,
        zoom: store.state.zoom
      }
      if (syncedViewport.current && sameViewport(syncedViewport.current, next)) return
      syncedViewport.current = next
      surface.current?.style.setProperty(
        '--openpencil-object-graph-inverse-zoom',
        String(1 / next.zoom)
      )
      surface.current?.style.setProperty('--openpencil-object-graph-zoom', String(next.zoom))
      void instance.setViewport(next, { duration: 0 })
    },
    [store]
  )

  const flushFrame = useCallback(
    (presentation: EditorPresentationFrame) => {
      syncViewport(presentation.viewport)
      if (!projectionPending.current) return
      projectionPending.current = false
      flushSync(() => {
        setFrame((current) => {
          const next = projectSurfaceFrame(store, removeConnection, current)
          return sameSurfaceFrame(current, next) ? current : next
        })
      })
    },
    [removeConnection, store, syncViewport]
  )

  const scheduleFrame = useCallback(() => {
    scheduleEditorPresentationFrame(store, flushFrame)
  }, [flushFrame, store])

  const scheduleProjection = useCallback(() => {
    projectionPending.current = true
    scheduleFrame()
  }, [scheduleFrame])

  useEffect(() => {
    const unsubscribeGraph = store.objectGraph.subscribe(scheduleProjection)
    const unsubscribeViewport = store.onEditorEvent('viewport:changed', scheduleFrame)
    scheduleProjection()
    return () => {
      unsubscribeGraph()
      unsubscribeViewport()
      cancelEditorPresentationFrame(store, flushFrame)
    }
  }, [flushFrame, scheduleFrame, scheduleProjection, store])

  const { edges, nodes } = frame
  const edgeIds = useMemo(() => new Set(edges.map((edge) => edge.id)), [edges])
  const surfaceStyle: ObjectGraphSurfaceStyle = {
    '--openpencil-object-graph-inverse-zoom': String(1 / initialViewport.zoom),
    '--openpencil-object-graph-zoom': String(initialViewport.zoom)
  }

  const changeEdges = useCallback(
    (changes: EdgeChange<ObjectGraphReactEdge>[]) => {
      const selectionChanges = changes.filter((change) => change.type === 'select')
      if (selectionChanges.length === 0) return
      const ids = selectionChanges.flatMap((change) => (change.selected ? [change.id] : []))
      const selectedConnectionIds = [...store.state.selectedIds].filter((id) => edgeIds.has(id))
      if (ids.length === 0 && selectedConnectionIds.length === 0) return
      if (!sameIds(store.state.selectedIds, ids)) store.select(ids)
    },
    [edgeIds, store]
  )

  const connect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      connectObjects(store, {
        kind: DIRECT_CONNECTION_KIND,
        sourceNodeId: connection.source,
        sourcePort: parseObjectGraphHandleSide(connection.sourceHandle),
        targetNodeId: connection.target,
        targetPort: parseObjectGraphHandleSide(connection.targetHandle)
      })
    },
    [store]
  )

  const validConnection = useCallback<IsValidConnection>(
    (connection) =>
      Boolean(
        connection.source &&
        connection.target &&
        canAddObjectGraphConnection(store.graph, store.state.currentPageId, {
          kind: DIRECT_CONNECTION_KIND,
          sourceNodeId: connection.source,
          sourcePort: parseObjectGraphHandleSide(connection.sourceHandle),
          targetNodeId: connection.target,
          targetPort: parseObjectGraphHandleSide(connection.targetHandle)
        })
      ),
    [store]
  )

  const reconnect = useCallback<OnReconnect<ObjectGraphReactEdge>>(
    (edge, connection) => {
      reconnectObjects(store, edge.id, {
        sourceNodeId: connection.source,
        sourcePort: parseObjectGraphHandleSide(connection.sourceHandle),
        targetNodeId: connection.target,
        targetPort: parseObjectGraphHandleSide(connection.targetHandle)
      })
    },
    [store]
  )

  const initialize = useCallback(
    (instance: ReactFlowInstance<ObjectGraphReactNode, ObjectGraphReactEdge>) => {
      reactFlow.current = instance
      syncedViewport.current = null
      syncViewport()
    },
    [syncViewport]
  )

  if (nodes.length === 0 && edges.length === 0) return null

  return (
    <div
      className={[
        'openpencil-object-graph size-full',
        connecting ? 'openpencil-object-graph-connecting' : ''
      ].join(' ')}
      data-test-id="react-flow-object-graph"
      ref={surface}
      style={surfaceStyle}
    >
      <ReactFlow<ObjectGraphReactNode, ObjectGraphReactEdge>
        colorMode="dark"
        connectionMode={ConnectionMode.Loose}
        defaultViewport={initialViewport}
        deleteKeyCode={null}
        edges={edges}
        edgeTypes={EDGE_TYPES}
        edgesFocusable
        edgesReconnectable
        elementsSelectable
        elevateEdgesOnSelect
        isValidConnection={validConnection}
        minZoom={0.02}
        nodeTypes={NODE_TYPES}
        nodes={nodes}
        nodesConnectable
        nodesDraggable={false}
        nodesFocusable={false}
        onConnect={connect}
        onConnectEnd={() => setConnecting(false)}
        onConnectStart={() => setConnecting(true)}
        onEdgesChange={changeEdges}
        onInit={initialize}
        onReconnect={reconnect}
        panOnDrag={false}
        panOnScroll={false}
        preventScrolling={false}
        selectionOnDrag={false}
        zoomOnDoubleClick={false}
        zoomOnPinch={false}
        zoomOnScroll={false}
      />
    </div>
  )
}
