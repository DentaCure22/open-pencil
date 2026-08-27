import {
  CODE_OBJECT_SCHEMA_VERSION,
  type CodeObjectDocument as CoreCodeObjectDocument
} from '@open-pencil/core/code-object'

import type { CodeObjectBoardPermission } from './contracts'
import { OPEN_SOURCE_WORKSPACE_SOURCE } from './saved-sources'

export type OpenSourceArchitectureNode = {
  id: string
  kind: 'api' | 'cache' | 'database' | 'deploy' | 'frontend' | 'worker'
  label: string
  status: 'ready' | 'running' | 'warning'
  subtitle: string
  x: number
  y: number
}

export type OpenSourceArchitectureEdge = {
  id: string
  kind: 'cache' | 'database' | 'deploy' | 'http'
  label: string
  source: string
  target: string
}

export type OpenSourceKanbanTask = {
  id: string
  priority: 'high' | 'low' | 'medium'
  reference: string
  tags: string[]
  title: string
}

export type OpenSourceKanbanColumn = {
  id: string
  tasks: OpenSourceKanbanTask[]
  title: string
  tone: 'done' | 'progress' | 'review' | 'todo'
}

export type OpenSourceWorkspaceState =
  | {
      edges: OpenSourceArchitectureEdge[]
      nodes: OpenSourceArchitectureNode[]
      piece: 'architecture'
    }
  | {
      columns: OpenSourceKanbanColumn[]
      piece: 'kanban'
    }

export type OpenSourceWorkspaceDocument = CoreCodeObjectDocument<
  'open-source-workspace',
  OpenSourceWorkspaceState,
  CodeObjectBoardPermission
>

const OPEN_SOURCE_WORKSPACE_KIT = {
  nodes: [
    {
      id: 'web',
      kind: 'frontend',
      label: 'Web application',
      status: 'running',
      subtitle: 'Next.js · :3000',
      x: 60,
      y: 92
    },
    {
      id: 'gateway',
      kind: 'api',
      label: 'API gateway',
      status: 'running',
      subtitle: 'Edge routes · HTTPS',
      x: 340,
      y: 92
    },
    {
      id: 'orchestrator',
      kind: 'worker',
      label: 'Agent orchestrator',
      status: 'ready',
      subtitle: 'FastAPI · :8000',
      x: 620,
      y: 92
    },
    {
      id: 'postgres',
      kind: 'database',
      label: 'Postgres',
      status: 'ready',
      subtitle: 'Primary data store',
      x: 340,
      y: 330
    },
    {
      id: 'redis',
      kind: 'cache',
      label: 'Redis',
      status: 'ready',
      subtitle: 'Queues and cache',
      x: 620,
      y: 330
    },
    {
      id: 'worker',
      kind: 'worker',
      label: 'Background worker',
      status: 'warning',
      subtitle: '3 active jobs',
      x: 900,
      y: 210
    },
    {
      id: 'deploy',
      kind: 'deploy',
      label: 'Cloud deployment',
      status: 'running',
      subtitle: 'Production · us-east',
      x: 900,
      y: 450
    }
  ],
  edges: [
    {
      id: 'web-gateway',
      kind: 'http',
      label: 'HTTPS',
      source: 'web',
      target: 'gateway'
    },
    {
      id: 'gateway-orchestrator',
      kind: 'http',
      label: 'API',
      source: 'gateway',
      target: 'orchestrator'
    },
    {
      id: 'orchestrator-postgres',
      kind: 'database',
      label: 'DATABASE_URL',
      source: 'orchestrator',
      target: 'postgres'
    },
    {
      id: 'orchestrator-redis',
      kind: 'cache',
      label: 'REDIS_URL',
      source: 'orchestrator',
      target: 'redis'
    },
    {
      id: 'redis-worker',
      kind: 'cache',
      label: 'jobs',
      source: 'redis',
      target: 'worker'
    },
    {
      id: 'worker-deploy',
      kind: 'deploy',
      label: 'release',
      source: 'worker',
      target: 'deploy'
    }
  ],
  columns: [
    {
      id: 'todo',
      title: 'Backlog',
      tone: 'todo',
      tasks: [
        {
          id: 'task-1',
          priority: 'high',
          reference: 'TSK-1042',
          tags: ['architecture', 'agent'],
          title: 'Map approval gates into the runtime graph'
        },
        {
          id: 'task-2',
          priority: 'medium',
          reference: 'TSK-1048',
          tags: ['design'],
          title: 'Tighten empty states for deployment targets'
        }
      ]
    },
    {
      id: 'progress',
      title: 'In progress',
      tone: 'progress',
      tasks: [
        {
          id: 'task-3',
          priority: 'high',
          reference: 'TSK-1037',
          tags: ['kanban', 'sync'],
          title: 'Keep task changes visible to running agents'
        },
        {
          id: 'task-4',
          priority: 'low',
          reference: 'TSK-1045',
          tags: ['api'],
          title: 'Add project health summaries'
        }
      ]
    },
    {
      id: 'review',
      title: 'Review',
      tone: 'review',
      tasks: [
        {
          id: 'task-5',
          priority: 'medium',
          reference: 'TSK-1029',
          tags: ['permissions'],
          title: 'Review scoped connector permissions'
        }
      ]
    },
    {
      id: 'done',
      title: 'Done',
      tone: 'done',
      tasks: [
        {
          id: 'task-6',
          priority: 'low',
          reference: 'TSK-1018',
          tags: ['infra'],
          title: 'Persist container positions in project config'
        }
      ]
    }
  ]
} satisfies {
  columns: OpenSourceKanbanColumn[]
  edges: OpenSourceArchitectureEdge[]
  nodes: OpenSourceArchitectureNode[]
}

const DEFAULT_OPEN_SOURCE_WORKSPACE_STATE: OpenSourceWorkspaceState = {
  edges: structuredClone(OPEN_SOURCE_WORKSPACE_KIT.edges),
  nodes: structuredClone(OPEN_SOURCE_WORKSPACE_KIT.nodes),
  piece: 'architecture'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function stringValue(value: unknown, fallback: string, maximum = 80) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : fallback
}

export function createOpenSourceWorkspaceDocument(
  state: OpenSourceWorkspaceState = DEFAULT_OPEN_SOURCE_WORKSPACE_STATE
): OpenSourceWorkspaceDocument {
  return {
    boardPermissions: [],
    component: 'open-source-workspace',
    definitionId: 'openpencil.open-source-workspace',
    modality: 'board-tool',
    name: 'Architecture + Kanban',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: OPEN_SOURCE_WORKSPACE_SOURCE,
    state: structuredClone(state)
  }
}

export function createOpenSourceWorkspaceKitDefinition() {
  return {
    architecture: {
      document: createOpenSourceWorkspaceDocument({
        edges: structuredClone(OPEN_SOURCE_WORKSPACE_KIT.edges),
        nodes: structuredClone(OPEN_SOURCE_WORKSPACE_KIT.nodes),
        piece: 'architecture'
      }),
      name: 'Architecture flow',
      width: 1180
    },
    gap: 80,
    height: 620,
    kanban: {
      document: createOpenSourceWorkspaceDocument({
        columns: structuredClone(OPEN_SOURCE_WORKSPACE_KIT.columns),
        piece: 'kanban'
      }),
      name: 'Kanban board',
      width: 1180
    },
    width: 2440
  }
}

export function normalizeOpenSourceWorkspaceState(
  state: Record<string, unknown>
): OpenSourceWorkspaceState {
  const nodeKinds = new Set<OpenSourceArchitectureNode['kind']>([
    'api',
    'cache',
    'database',
    'deploy',
    'frontend',
    'worker'
  ])
  const nodeStatuses = new Set<OpenSourceArchitectureNode['status']>([
    'ready',
    'running',
    'warning'
  ])
  const priorities = new Set<OpenSourceKanbanTask['priority']>(['high', 'low', 'medium'])
  const tones = new Set<OpenSourceKanbanColumn['tone']>(['done', 'progress', 'review', 'todo'])
  if (state.piece === 'kanban' && Array.isArray(state.columns)) {
    const columns = state.columns.slice(0, 8).flatMap((value, columnIndex) => {
      if (!isRecord(value)) return []
      const fallback =
        OPEN_SOURCE_WORKSPACE_KIT.columns[columnIndex % OPEN_SOURCE_WORKSPACE_KIT.columns.length]
      const tasks = Array.isArray(value.tasks)
        ? value.tasks.slice(0, 40).flatMap((taskValue, taskIndex) => {
            if (!isRecord(taskValue)) return []
            const taskFallback =
              fallback.tasks[taskIndex % Math.max(fallback.tasks.length, 1)] ??
              OPEN_SOURCE_WORKSPACE_KIT.columns[0].tasks[0]
            return [
              {
                id: stringValue(taskValue.id, `task-${columnIndex}-${taskIndex}`, 48),
                priority: priorities.has(taskValue.priority as OpenSourceKanbanTask['priority'])
                  ? (taskValue.priority as OpenSourceKanbanTask['priority'])
                  : taskFallback.priority,
                reference: stringValue(taskValue.reference, taskFallback.reference, 24),
                tags: Array.isArray(taskValue.tags)
                  ? taskValue.tags
                      .filter((tag): tag is string => typeof tag === 'string')
                      .slice(0, 5)
                      .map((tag) => tag.trim().slice(0, 24))
                      .filter(Boolean)
                  : taskFallback.tags,
                title: stringValue(taskValue.title, taskFallback.title, 140)
              }
            ]
          })
        : structuredClone(fallback.tasks)
      return [
        {
          id: stringValue(value.id, fallback.id, 48),
          tasks,
          title: stringValue(value.title, fallback.title, 48),
          tone: tones.has(value.tone as OpenSourceKanbanColumn['tone'])
            ? (value.tone as OpenSourceKanbanColumn['tone'])
            : fallback.tone
        }
      ]
    })
    return {
      columns: columns.length > 0 ? columns : structuredClone(OPEN_SOURCE_WORKSPACE_KIT.columns),
      piece: 'kanban'
    }
  }

  const nodes = Array.isArray(state.nodes)
    ? state.nodes.slice(0, 48).flatMap((value, index) => {
        if (!isRecord(value)) return []
        const fallback =
          OPEN_SOURCE_WORKSPACE_KIT.nodes[index % OPEN_SOURCE_WORKSPACE_KIT.nodes.length]
        return [
          {
            id: stringValue(value.id, fallback.id, 48),
            kind: nodeKinds.has(value.kind as OpenSourceArchitectureNode['kind'])
              ? (value.kind as OpenSourceArchitectureNode['kind'])
              : fallback.kind,
            label: stringValue(value.label, fallback.label),
            status: nodeStatuses.has(value.status as OpenSourceArchitectureNode['status'])
              ? (value.status as OpenSourceArchitectureNode['status'])
              : fallback.status,
            subtitle: stringValue(value.subtitle, fallback.subtitle, 120),
            x: clamp(finiteNumber(value.x, fallback.x), -2000, 4000),
            y: clamp(finiteNumber(value.y, fallback.y), -2000, 4000)
          }
        ]
      })
    : structuredClone(OPEN_SOURCE_WORKSPACE_KIT.nodes)
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(state.edges)
    ? state.edges.slice(0, 96).flatMap((value, index) => {
        if (!isRecord(value)) return []
        const fallback =
          OPEN_SOURCE_WORKSPACE_KIT.edges[index % OPEN_SOURCE_WORKSPACE_KIT.edges.length]
        const source = stringValue(value.source, fallback.source, 48)
        const target = stringValue(value.target, fallback.target, 48)
        if (!nodeIds.has(source) || !nodeIds.has(target)) return []
        return [
          {
            id: stringValue(value.id, fallback.id, 48),
            kind:
              value.kind === 'cache' ||
              value.kind === 'database' ||
              value.kind === 'deploy' ||
              value.kind === 'http'
                ? value.kind
                : fallback.kind,
            label: stringValue(value.label, fallback.label, 48),
            source,
            target
          }
        ]
      })
    : structuredClone(OPEN_SOURCE_WORKSPACE_KIT.edges)
  return {
    edges,
    nodes: nodes.length > 0 ? nodes : structuredClone(OPEN_SOURCE_WORKSPACE_KIT.nodes),
    piece: 'architecture'
  }
}
