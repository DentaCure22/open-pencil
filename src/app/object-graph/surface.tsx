import {
  ConnectionMode,
  ReactFlow,
  useNodesInitialized,
  useStore,
  useStoreApi,
  type Connection,
  type EdgeChange,
  type IsValidConnection,
  type OnReconnect,
  type ProOptions,
  type Viewport
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import {
  canAddObjectGraphConnection,
  readObjectGraphPorts,
  type ObjectGraphConnectionKind,
  type ObjectGraphPortSide
} from '@open-pencil/scene-graph'
import {
  cancelEditorPresentationFrame,
  scheduleEditorPresentationFrame,
  type EditorPresentationFrame
} from '@open-pencil/vue/presentation'

import type { EditorStore } from '@/app/editor/active-store'
import { connectObjects, reconnectObjects } from '@/app/object-graph/actions'
import type { ConnectObjectsInput } from '@/app/object-graph/contracts'
import type { ObjectGraphNavigationState } from '@/app/object-graph/navigation'
import {
  readObjectGraphPortPresentation,
  subscribeObjectGraphPortPresentation
} from '@/app/object-graph/port-presentation'
import {
  OBJECT_GRAPH_EDGE_TYPE,
  OBJECT_GRAPH_NODE_TYPE,
  objectGraphReactFlowSnapshot,
  parseObjectGraphHandle,
  reconcileObjectGraphEdges,
  reconcileObjectGraphNodeHandles,
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

type ObjectGraphConnectionCandidate = {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}

const NODE_TYPES = {
  [OBJECT_GRAPH_NODE_TYPE]: OpenPencilObjectGraphNode
}

const EDGE_TYPES = {
  [OBJECT_GRAPH_EDGE_TYPE]: OpenPencilObjectGraphEdge
}

const DIRECT_CONNECTION_KIND_PREFERENCE = ['data', 'action', 'visual'] as const

const PRO_OPTIONS = {
  hideAttribution: true
} satisfies ProOptions

type ObjectGraphSurfaceFrame = {
  edges: ObjectGraphReactEdge[]
  interactive: boolean
  navigation: ObjectGraphNavigationState | null
  nodes: ObjectGraphReactNode[]
}

type ObjectGraphEdgeReadinessProps = {
  onChange: (ready: boolean) => void
}

type ObjectGraphViewportSyncProps = {
  store: EditorStore
}

function ObjectGraphEdgeReadiness({ onChange }: ObjectGraphEdgeReadinessProps) {
  const connectionMode = useStore((state) => state.connectionMode)
  const nodesInitialized = useNodesInitialized()
  const ready = connectionMode === ConnectionMode.Loose && nodesInitialized

  useEffect(() => {
    onChange(ready)
  }, [onChange, ready])

  useEffect(() => () => onChange(false), [onChange])
  return null
}

function ObjectGraphViewportSync({ store }: ObjectGraphViewportSyncProps) {
  const flowStore = useStoreApi()
  const syncViewport = useCallback(
    (presentation: EditorPresentationFrame) => {
      const state = flowStore.getState()
      const viewport = presentation.viewport
      const [x, y, zoom] = state.transform
      if (sameViewport({ x, y, zoom }, viewport)) return
      state.panZoom?.syncViewport(viewport)
      flowStore.setState({ transform: [viewport.x, viewport.y, viewport.zoom] })
    },
    [flowStore]
  )
  const scheduleViewport = useCallback(() => {
    scheduleEditorPresentationFrame(store, syncViewport)
  }, [store, syncViewport])

  useEffect(() => {
    const unsubscribeViewport = store.onEditorEvent('viewport:changed', scheduleViewport)
    const unsubscribeRepaint = store.onEditorEvent('repaint:requested', scheduleViewport)
    scheduleViewport()
    return () => {
      unsubscribeViewport()
      unsubscribeRepaint()
      cancelEditorPresentationFrame(store, syncViewport)
    }
  }, [scheduleViewport, store, syncViewport])

  return null
}

function sameViewport(current: Viewport, next: Viewport): boolean {
  return current.x === next.x && current.y === next.y && current.zoom === next.zoom
}

function syncHoveredNodeHandles(
  current: ObjectGraphSurfaceFrame,
  store: EditorStore
): ObjectGraphSurfaceFrame {
  const nodes = reconcileObjectGraphNodeHandles(
    current.nodes,
    store.state.hoveredNodeId,
    store.state.selectedIds
  )
  return nodes === current.nodes ? current : { ...current, nodes }
}

function sameIds(current: ReadonlySet<string>, next: string[]): boolean {
  return current.size === next.length && next.every((id) => current.has(id))
}

function directConnectionKind(
  store: EditorStore,
  sourceNodeId: string,
  sourcePortId: string | undefined,
  targetNodeId: string,
  targetPortId: string | undefined
): ObjectGraphConnectionKind | null {
  const sourceKinds = sourcePortId
    ? readObjectGraphPorts(store.graph.getNode(sourceNodeId)).find(({ id }) => id === sourcePortId)
        ?.kinds
    : undefined
  const targetKinds = targetPortId
    ? readObjectGraphPorts(store.graph.getNode(targetNodeId)).find(({ id }) => id === targetPortId)
        ?.kinds
    : undefined
  if (sourcePortId && !sourceKinds) return null
  if (targetPortId && !targetKinds) return null
  return (
    DIRECT_CONNECTION_KIND_PREFERENCE.find(
      (kind) =>
        (!sourceKinds || sourceKinds.includes(kind)) && (!targetKinds || targetKinds.includes(kind))
    ) ?? null
  )
}

function directConnectionInput(
  store: EditorStore,
  connection: ObjectGraphConnectionCandidate
):
  | (ConnectObjectsInput & { sourcePort: ObjectGraphPortSide; targetPort: ObjectGraphPortSide })
  | null {
  if (!connection.source || !connection.target) return null
  const source = parseObjectGraphHandle(connection.sourceHandle)
  const target = parseObjectGraphHandle(connection.targetHandle)
  const kind = directConnectionKind(
    store,
    connection.source,
    source.portId,
    connection.target,
    target.portId
  )
  if (!kind) return null
  return {
    kind,
    sourceNodeId: connection.source,
    sourcePort: source.port,
    ...(source.portId ? { sourcePortId: source.portId } : {}),
    targetNodeId: connection.target,
    targetPort: target.port,
    ...(target.portId ? { targetPortId: target.portId } : {})
  }
}

function projectSurfaceFrame(
  store: EditorStore,
  current?: ObjectGraphSurfaceFrame
): ObjectGraphSurfaceFrame {
  const navigation = store.objectGraphNavigation.getState()
  const snapshot = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId, {
    activeConnectionId: navigation?.activeConnectionId,
    hoveredNodeId: store.state.hoveredNodeId,
    runtimePortPoints: readObjectGraphPortPresentation,
    selectedIds: store.state.selectedIds
  })
  const interactive = store.state.activeTool === 'SELECT'
  if (!current) return { ...snapshot, interactive, navigation }
  return {
    edges: reconcileObjectGraphEdges(current.edges, snapshot.edges),
    interactive,
    navigation,
    nodes: reconcileObjectGraphNodes(current.nodes, snapshot.nodes)
  }
}

function sameNavigation(
  current: ObjectGraphNavigationState | null,
  next: ObjectGraphNavigationState | null
): boolean {
  return (
    current?.activeConnectionId === next?.activeConnectionId &&
    current?.activeEndpointId === next?.activeEndpointId &&
    current?.activeEndpointName === next?.activeEndpointName &&
    current?.originLabel === next?.originLabel
  )
}

function sameSurfaceFrame(
  current: ObjectGraphSurfaceFrame,
  next: ObjectGraphSurfaceFrame
): boolean {
  return (
    current.edges === next.edges &&
    current.interactive === next.interactive &&
    sameNavigation(current.navigation, next.navigation) &&
    current.nodes === next.nodes
  )
}

export function ObjectGraphSurface({ store }: ObjectGraphSurfaceProps) {
  const [connecting, setConnecting] = useState(false)
  const [edgesReady, setEdgesReady] = useState(false)
  const initialViewport = useMemo<Viewport>(
    () => ({
      x: store.state.panX,
      y: store.state.panY,
      zoom: store.state.zoom
    }),
    [store]
  )
  const [frame, setFrame] = useState<ObjectGraphSurfaceFrame>(() => projectSurfaceFrame(store))
  const hoverPending = useRef(false)
  const projectionPending = useRef(true)

  const flushFrame = useCallback(() => {
    flushSync(() => {
      if (projectionPending.current) {
        projectionPending.current = false
        hoverPending.current = false
        setFrame((current) => {
          const next = projectSurfaceFrame(store, current)
          return sameSurfaceFrame(current, next) ? current : next
        })
      } else if (hoverPending.current) {
        hoverPending.current = false
        setFrame((current) => syncHoveredNodeHandles(current, store))
      }
    })
  }, [store])

  const scheduleProjectionFrame = useCallback(() => {
    scheduleEditorPresentationFrame(store, flushFrame)
  }, [flushFrame, store])

  const scheduleProjection = useCallback(() => {
    projectionPending.current = true
    scheduleProjectionFrame()
  }, [scheduleProjectionFrame])

  const scheduleHover = useCallback(() => {
    hoverPending.current = true
    scheduleProjectionFrame()
  }, [scheduleProjectionFrame])

  useEffect(() => {
    const unsubscribeGraph = store.objectGraph.subscribe(scheduleProjection)
    const unsubscribeNavigation = store.objectGraphNavigation.subscribe(scheduleProjection)
    const unsubscribePortPresentation = subscribeObjectGraphPortPresentation(scheduleProjection)
    const unsubscribeTool = store.onEditorEvent('tool:changed', scheduleProjection)
    const unsubscribeHover = store.onEditorEvent('hover:changed', scheduleHover)
    scheduleProjection()
    return () => {
      unsubscribeGraph()
      unsubscribeNavigation()
      unsubscribePortPresentation()
      unsubscribeTool()
      unsubscribeHover()
      cancelEditorPresentationFrame(store, flushFrame)
    }
  }, [flushFrame, scheduleHover, scheduleProjection, store])

  const { edges, interactive, navigation, nodes } = frame
  const edgeIds = useMemo(() => new Set(edges.map((edge) => edge.id)), [edges])

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
      const input = directConnectionInput(store, connection)
      if (input) connectObjects(store, input)
    },
    [store]
  )

  const validConnection = useCallback<IsValidConnection>(
    (connection) => {
      const input = directConnectionInput(store, connection)
      return Boolean(
        input && canAddObjectGraphConnection(store.graph, store.state.currentPageId, input)
      )
    },
    [store]
  )

  const reconnect = useCallback<OnReconnect<ObjectGraphReactEdge>>(
    (edge, connection) => {
      const input = directConnectionInput(store, connection)
      if (input) reconnectObjects(store, edge.id, input)
    },
    [store]
  )

  if (nodes.length === 0 && edges.length === 0) return null

  return (
    <div
      className={[
        'openpencil-object-graph size-full',
        interactive ? 'openpencil-object-graph-interactive' : '',
        connecting ? 'openpencil-object-graph-connecting' : ''
      ].join(' ')}
      data-test-id="react-flow-object-graph"
    >
      <ReactFlow<ObjectGraphReactNode, ObjectGraphReactEdge>
        connectionMode={ConnectionMode.Loose}
        defaultViewport={initialViewport}
        deleteKeyCode={null}
        edges={edgesReady ? edges : []}
        edgeTypes={EDGE_TYPES}
        edgesFocusable={interactive}
        edgesReconnectable={interactive}
        elementsSelectable={interactive}
        elevateEdgesOnSelect
        isValidConnection={validConnection}
        minZoom={0.02}
        nodeTypes={NODE_TYPES}
        nodes={nodes}
        nodesConnectable={interactive}
        nodesDraggable={false}
        nodesFocusable={false}
        onConnect={connect}
        onConnectEnd={() => setConnecting(false)}
        onConnectStart={() => setConnecting(true)}
        onEdgesChange={changeEdges}
        onReconnect={reconnect}
        panOnDrag={false}
        panOnScroll={false}
        preventScrolling={false}
        proOptions={PRO_OPTIONS}
        selectionOnDrag={false}
        zoomOnDoubleClick={false}
        zoomOnPinch={false}
        zoomOnScroll={false}
      >
        <ObjectGraphEdgeReadiness onChange={setEdgesReady} />
        <ObjectGraphViewportSync store={store} />
      </ReactFlow>
      {navigation ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute top-28 left-1/2 z-30 flex max-w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 rounded-full border border-white/12 bg-[#121419]/95 px-3 py-1.5 text-[10px] text-slate-300 shadow-xl backdrop-blur-xl"
          data-test-id="object-graph-navigation-status"
          role="status"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-violet-400 shadow-[0_0_8px_rgb(167_139_250/0.9)]" />
          <span className="truncate">
            Focused{' '}
            <strong className="font-semibold text-white">{navigation.activeEndpointName}</strong>
          </span>
          <span className="hidden text-slate-500 sm:inline">
            Arrows move · Esc returns to {navigation.originLabel}
          </span>
        </div>
      ) : null}
    </div>
  )
}
