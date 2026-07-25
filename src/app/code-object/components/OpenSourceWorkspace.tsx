/**
 * Frameless Code Object surfaces adapted from OpenArchFlow and OpenSail.
 * Full attribution: ./OpenSourceWorkspace.NOTICE.md
 */
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps
} from '@xyflow/react'
import { useEffect, useMemo, useState } from 'react'

import type { OpenSourceArchitectureNode, OpenSourceWorkspaceState } from '../model'

import '@xyflow/react/dist/style.css'
import './OpenSourceWorkspace.css'

type OpenSourceWorkspaceProps = {
  interactionEnabled: boolean
  onStateChange: (state: OpenSourceWorkspaceState) => void
  state: OpenSourceWorkspaceState
}

type ArchitectureState = Extract<OpenSourceWorkspaceState, { piece: 'architecture' }>
type KanbanState = Extract<OpenSourceWorkspaceState, { piece: 'kanban' }>
type ArchitectureFlowNode = Node<OpenSourceArchitectureNode, 'architecture-node'>

const NODE_ICONS = {
  api: '</>',
  cache: '⚡',
  database: '◫',
  deploy: '⇧',
  frontend: '◇',
  worker: '⊞'
} as const

function ArchitectureNodeCard({ data }: NodeProps<ArchitectureFlowNode>) {
  return (
    <article className={`os-architecture-node os-node-${data.kind}`}>
      <Handle className="os-handle" position={Position.Left} type="target" />
      <span className="os-node-icon" aria-hidden="true">
        {NODE_ICONS[data.kind]}
      </span>
      <span className="os-node-copy">
        <strong>{data.label}</strong>
        <small>{data.subtitle}</small>
      </span>
      <span className={`os-status os-status-${data.status}`}>{data.status}</span>
      <Handle className="os-handle" position={Position.Right} type="source" />
    </article>
  )
}

function flowNodes(state: ArchitectureState): ArchitectureFlowNode[] {
  return state.nodes.map((node) => ({
    data: node,
    id: node.id,
    position: { x: node.x, y: node.y },
    type: 'architecture-node'
  }))
}

function flowEdges(state: ArchitectureState): Edge[] {
  return state.edges.map((edge) => ({
    animated: edge.kind === 'deploy',
    data: { kind: edge.kind },
    id: edge.id,
    label: edge.label,
    labelStyle: { fill: '#8f96a1', fontSize: 9, fontWeight: 600 },
    markerEnd: { color: edgeColor(edge.kind), type: 'arrowclosed' },
    source: edge.source,
    style: { stroke: edgeColor(edge.kind), strokeWidth: 2 },
    target: edge.target,
    type: 'smoothstep'
  }))
}

function edgeColor(kind: ArchitectureState['edges'][number]['kind']) {
  if (kind === 'database') return '#49c49d'
  if (kind === 'cache') return '#e86777'
  if (kind === 'deploy') return '#d89b50'
  return '#6593eb'
}

function ArchitectureSurface({
  interactionEnabled,
  onStateChange,
  state
}: OpenSourceWorkspaceProps & { state: ArchitectureState }) {
  const [nodes, setNodes] = useState<ArchitectureFlowNode[]>(() => flowNodes(state))
  useEffect(() => setNodes(flowNodes(state)), [state])
  const edges = useMemo(() => flowEdges(state), [state])

  function changeNodes(changes: NodeChange<ArchitectureFlowNode>[]) {
    setNodes((current) => applyNodeChanges(changes, current))
  }

  function commitNodePosition(_: unknown, moved: ArchitectureFlowNode) {
    onStateChange({
      ...state,
      nodes: state.nodes.map((node) =>
        node.id === moved.id ? { ...node, x: moved.position.x, y: moved.position.y } : node
      )
    })
  }

  return (
    <div className="os-architecture-surface" data-test-id="open-source-architecture">
      <ReactFlow
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.14 }}
        maxZoom={1.5}
        minZoom={0.45}
        nodeTypes={{ 'architecture-node': ArchitectureNodeCard }}
        nodes={nodes}
        nodesDraggable={interactionEnabled}
        nodesFocusable={interactionEnabled}
        onNodeDragStop={commitNodePosition}
        onNodesChange={changeNodes}
        panOnDrag={interactionEnabled}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
        zoomOnPinch={interactionEnabled}
        zoomOnScroll={interactionEnabled}
      >
        <Background color="#4d5360" gap={22} size={1} variant={BackgroundVariant.Dots} />
        {interactionEnabled ? <Controls position="bottom-right" showInteractive={false} /> : null}
      </ReactFlow>
    </div>
  )
}

function KanbanTaskCard({ task }: { task: KanbanState['columns'][number]['tasks'][number] }) {
  return (
    <article className="os-kanban-task">
      <span className="os-task-meta">
        <small>{task.reference}</small>
        <em className={`os-priority os-priority-${task.priority}`}>{task.priority}</em>
      </span>
      <strong>{task.title}</strong>
      <span className="os-task-tags">
        {task.tags.map((tag) => (
          <small key={tag}>{tag}</small>
        ))}
      </span>
    </article>
  )
}

function KanbanSurface({
  interactionEnabled,
  onStateChange,
  state
}: OpenSourceWorkspaceProps & { state: KanbanState }) {
  function finishDrag(result: DropResult) {
    if (!interactionEnabled || !result.destination) return
    const sourceColumn = state.columns.find((column) => column.id === result.source.droppableId)
    const targetColumn = state.columns.find(
      (column) => column.id === result.destination?.droppableId
    )
    if (!sourceColumn || !targetColumn) return
    const sourceTasks = [...sourceColumn.tasks]
    const task = sourceTasks.splice(result.source.index, 1).at(0)
    if (!task) return
    const targetTasks = sourceColumn.id === targetColumn.id ? sourceTasks : [...targetColumn.tasks]
    targetTasks.splice(result.destination.index, 0, task)
    onStateChange({
      columns: state.columns.map((column) => {
        if (column.id === sourceColumn.id && column.id === targetColumn.id) {
          return { ...column, tasks: targetTasks }
        }
        if (column.id === sourceColumn.id) return { ...column, tasks: sourceTasks }
        if (column.id === targetColumn.id) return { ...column, tasks: targetTasks }
        return column
      }),
      piece: 'kanban'
    })
  }

  return (
    <DragDropContext onDragEnd={finishDrag}>
      <div className="os-kanban-surface" data-test-id="open-source-kanban">
        {state.columns.map((column) => (
          <Droppable droppableId={column.id} key={column.id}>
            {(drop) => (
              <section
                className={`os-kanban-lane os-lane-${column.tone}`}
                ref={drop.innerRef}
                {...drop.droppableProps}
              >
                <header>
                  <span className="os-lane-dot" aria-hidden="true" />
                  <strong>{column.title}</strong>
                  <small>{column.tasks.length}</small>
                  <span className="os-lane-handle" aria-hidden="true">
                    •••
                  </span>
                </header>
                <div className="os-task-list">
                  {column.tasks.map((task, index) => (
                    <Draggable
                      draggableId={task.id}
                      index={index}
                      isDragDisabled={!interactionEnabled}
                      key={task.id}
                    >
                      {(drag) => (
                        <div ref={drag.innerRef} {...drag.draggableProps} {...drag.dragHandleProps}>
                          <KanbanTaskCard task={task} />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {drop.placeholder}
                </div>
                <footer>+ Add task</footer>
              </section>
            )}
          </Droppable>
        ))}
      </div>
    </DragDropContext>
  )
}

export function OpenSourceWorkspace(props: OpenSourceWorkspaceProps) {
  if (props.state.piece === 'architecture') {
    return <ArchitectureSurface {...props} state={props.state} />
  }
  return <KanbanSurface {...props} state={props.state} />
}
