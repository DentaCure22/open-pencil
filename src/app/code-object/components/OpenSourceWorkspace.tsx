/**
 * Frameless Code Object surfaces adapted from OpenArchFlow and OpenSail.
 * Full attribution: ./OpenSourceWorkspace.NOTICE.md
 */
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'

import type { OpenSourceArchitectureNode, OpenSourceWorkspaceState } from '../model'

import './OpenSourceWorkspace.css'

type OpenSourceWorkspaceProps = {
  interactionEnabled: boolean
  onStateChange: (state: OpenSourceWorkspaceState) => void
  state: OpenSourceWorkspaceState
}

type ArchitectureState = Extract<OpenSourceWorkspaceState, { piece: 'architecture' }>
type KanbanState = Extract<OpenSourceWorkspaceState, { piece: 'kanban' }>

const NODE_ICONS = {
  api: '</>',
  cache: '⚡',
  database: '◫',
  deploy: '⇧',
  frontend: '◇',
  worker: '⊞'
} as const

function ArchitectureNodeCard({ data }: { data: OpenSourceArchitectureNode }) {
  return (
    <article className={`os-architecture-node os-node-${data.kind}`}>
      <span className="os-node-icon" aria-hidden="true">
        {NODE_ICONS[data.kind]}
      </span>
      <span className="os-node-copy">
        <strong>{data.label}</strong>
        <small>{data.subtitle}</small>
      </span>
      <span className={`os-status os-status-${data.status}`}>{data.status}</span>
    </article>
  )
}

function edgeColor(kind: ArchitectureState['edges'][number]['kind']) {
  if (kind === 'database') return '#49c49d'
  if (kind === 'cache') return '#e86777'
  if (kind === 'deploy') return '#d89b50'
  return '#6593eb'
}

function ArchitectureSurface({ state }: OpenSourceWorkspaceProps & { state: ArchitectureState }) {
  const nodesById = new Map(state.nodes.map((node) => [node.id, node]))

  return (
    <div className="os-architecture-surface" data-test-id="open-source-architecture">
      <svg aria-hidden="true" className="os-architecture-edges">
        {state.edges.map((edge) => {
          const source = nodesById.get(edge.source)
          const target = nodesById.get(edge.target)
          if (!source || !target) return null
          return (
            <line
              key={edge.id}
              stroke={edgeColor(edge.kind)}
              strokeWidth="2"
              x1={source.x + 220}
              x2={target.x}
              y1={source.y + 30}
              y2={target.y + 30}
            />
          )
        })}
      </svg>
      {state.nodes.map((node) => (
        <div
          className="os-architecture-node-position"
          key={node.id}
          style={{ left: node.x, top: node.y }}
        >
          <ArchitectureNodeCard data={node} />
        </div>
      ))}
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
