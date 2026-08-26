import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  WORK_MAP_TODO_STATUSES,
  type WorkMapOperation,
  type WorkMapPlacement,
  type WorkMapProject,
  type WorkMapSnapshot,
  type WorkMapTodo
} from '#mcp/agent-router/work-map'
import { fail, ok } from '#mcp/result'
import { authorityJson } from '#mcp/tool/authority-client'

type AuthorityClient = typeof authorityJson

export const WORK_MAP_TOOL_NAMES = [
  'workmap_apply',
  'workmap_create_todo_chat',
  'workmap_query'
] as const

export type WorkMapToolOptions = {
  authorityRequest?: AuthorityClient
  currentThreadId?: string
}

const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    op: z.literal('create_project'),
    parent_id: z.string().trim().min(1).max(240).optional(),
    project_id: z.string().trim().min(1).max(240).optional()
  })
  .strict()

const renameProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    op: z.literal('rename_project'),
    project_id: z.string().trim().min(1).max(240)
  })
  .strict()

const placeChatSchema = z
  .object({
    op: z.literal('place_chat'),
    project_id: z.string().trim().min(1).max(240).nullable(),
    thread_id: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe('Defaults to the active worker chat')
      .optional()
  })
  .strict()

const createTodoSchema = z
  .object({
    description: z.string().trim().max(4_000).optional(),
    op: z.literal('create_todo'),
    plan_object_id: z.string().trim().min(1).max(240).optional(),
    plan_page_id: z.string().trim().min(1).max(240).optional(),
    project_id: z.string().trim().min(1).max(240),
    thread_id: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe('Agent-created todos default to the active chat')
      .optional(),
    title: z.string().trim().min(1).max(240),
    todo_id: z.string().trim().min(1).max(240).optional()
  })
  .strict()

const updateTodoSchema = z
  .object({
    description: z.string().trim().max(4_000).optional(),
    op: z.literal('update_todo'),
    plan_object_id: z.string().trim().min(1).max(240).nullable().optional(),
    plan_page_id: z.string().trim().min(1).max(240).nullable().optional(),
    project_id: z.string().trim().min(1).max(240).optional(),
    status: z.enum(WORK_MAP_TODO_STATUSES).optional(),
    thread_id: z.string().trim().min(1).max(240).nullable().optional(),
    title: z.string().trim().min(1).max(240).optional(),
    todo_id: z.string().trim().min(1).max(240)
  })
  .strict()
  .refine(
    (value) =>
      value.description !== undefined ||
      value.plan_object_id !== undefined ||
      value.plan_page_id !== undefined ||
      value.project_id !== undefined ||
      value.status !== undefined ||
      value.thread_id !== undefined ||
      value.title !== undefined,
    { message: 'update_todo needs at least one change' }
  )

const workMapOperationSchema = z.discriminatedUnion('op', [
  createProjectSchema,
  renameProjectSchema,
  placeChatSchema,
  createTodoSchema,
  updateTodoSchema
])

const workMapApplySchema = z
  .object({
    expected_revision: z
      .number()
      .int()
      .min(0)
      .describe('Revision returned by the latest workmap_query call'),
    operations: z.array(workMapOperationSchema).min(1).max(100),
    request_id: z.string().trim().min(1).max(240).optional()
  })
  .strict()

const todoReferenceSchema = z
  .object({
    id: z.string().trim().min(1).max(1_000),
    kind: z.enum(['board_object', 'chat', 'file', 'image', 'trace_evidence', 'url']),
    label: z.string().trim().min(1).max(240),
    note: z.string().trim().max(1_000).optional()
  })
  .strict()

const workMapCreateTodoChatSchema = z
  .object({
    acceptance: z.array(z.string().trim().min(1).max(1_000)).max(24).optional(),
    constraints: z.array(z.string().trim().min(1).max(1_000)).max(24).optional(),
    context: z.string().trim().max(4_000).optional(),
    desired_outcome: z.string().trim().max(2_000).optional(),
    expected_revision: z.number().int().min(0),
    goal: z.string().trim().min(1).max(2_000),
    known_facts: z.array(z.string().trim().min(1).max(1_000)).max(24).optional(),
    open_questions: z.array(z.string().trim().min(1).max(1_000)).max(24).optional(),
    project_id: z.string().trim().min(1).max(240),
    references: z.array(todoReferenceSchema).max(24).optional(),
    request_id: z.string().trim().min(1).max(240),
    suggested_next_step: z.string().trim().max(2_000).optional(),
    title: z.string().trim().min(1).max(240)
  })
  .strict()

type WorkMapQueryArgs = {
  include_finished?: boolean
  project_id?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function projectsFrom(value: unknown): WorkMapProject[] {
  return Array.isArray(value)
    ? value.filter(
        (project): project is WorkMapProject =>
          isRecord(project) &&
          typeof project.id === 'string' &&
          typeof project.name === 'string' &&
          (project.parentId === undefined || typeof project.parentId === 'string')
      )
    : []
}

function placementsFrom(value: unknown): WorkMapPlacement[] {
  return Array.isArray(value)
    ? value.filter(
        (placement): placement is WorkMapPlacement =>
          isRecord(placement) &&
          typeof placement.threadId === 'string' &&
          (placement.projectId === null || typeof placement.projectId === 'string') &&
          typeof placement.manual === 'boolean'
      )
    : []
}

function todosFrom(value: unknown): WorkMapTodo[] {
  return Array.isArray(value)
    ? value.filter(
        (todo): todo is WorkMapTodo =>
          isRecord(todo) &&
          typeof todo.id === 'string' &&
          typeof todo.projectId === 'string' &&
          typeof todo.title === 'string' &&
          WORK_MAP_TODO_STATUSES.includes(todo.status as WorkMapTodo['status'])
      )
    : []
}

function compactWorkMap(
  payload: Record<string, unknown>,
  args: WorkMapQueryArgs,
  currentThreadId: string
) {
  const projects = projectsFrom(payload.projects)
  const placements = placementsFrom(payload.placements)
  const todos = todosFrom(payload.todos)
  const currentPlacement = currentThreadId
    ? (placements.find((placement) => placement.threadId === currentThreadId) ?? null)
    : null
  const projectId = args.project_id?.trim() || currentPlacement?.projectId || ''
  const projectIds = new Set(
    projectId
      ? [
          projectId,
          ...projects
            .filter((project) => project.parentId === projectId)
            .map((project) => project.id)
        ]
      : currentThreadId
        ? []
        : projects.map((project) => project.id)
  )
  const visibleTodos = todos
    .filter((todo) => projectIds.has(todo.projectId))
    .filter((todo) => args.include_finished === true || todo.status !== 'finished')
    .slice(0, 100)
  const counts = Object.fromEntries(
    WORK_MAP_TODO_STATUSES.map((status) => [
      status,
      todos.filter((todo) => projectIds.has(todo.projectId) && todo.status === status).length
    ])
  )
  return {
    currentPlacement,
    ...(currentThreadId ? { currentThreadId } : {}),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      ...(project.parentId ? { parentId: project.parentId } : {}),
      openTodoCount: todos.filter(
        (todo) => todo.projectId === project.id && todo.status !== 'finished'
      ).length
    })),
    revision: Number.isInteger(payload.revision) ? payload.revision : 0,
    selectedProjectId: projectId || null,
    todoCounts: counts,
    todos: visibleTodos
  }
}

function withCurrentThread(
  operations: readonly z.infer<typeof workMapOperationSchema>[],
  currentThreadId: string
): WorkMapOperation[] {
  return operations.map((operation) => {
    if (operation.op === 'place_chat') {
      const threadId = operation.thread_id?.trim() || currentThreadId
      if (!threadId) throw new TypeError('place_chat requires thread_id outside a worker chat.')
      return { ...operation, thread_id: threadId }
    }
    if (operation.op === 'create_todo' && !operation.thread_id && currentThreadId) {
      return { ...operation, thread_id: currentThreadId }
    }
    return operation
  })
}

export function registerWorkMapTools(mcpServer: McpServer, options: WorkMapToolOptions = {}): void {
  const authority = options.authorityRequest ?? authorityJson
  const register = mcpServer.registerTool.bind(mcpServer) as (...args: unknown[]) => void

  register(
    'workmap_query',
    {
      description:
        'Read the durable Work Map: projects, one-level subprojects, this chat placement, and open todos for the selected project. At the beginning of an unplaced Board chat, use board_where first, then this tool to choose an existing project or an honest Misc placement. Read-only.',
      inputSchema: z
        .object({
          include_finished: z.boolean().optional(),
          project_id: z.string().trim().min(1).max(240).optional()
        })
        .strict()
    },
    async (args: WorkMapQueryArgs) => {
      try {
        const currentThreadId = options.currentThreadId?.trim() ?? ''
        const response = await authority('/agent-router/v1/pi/work-map')
        if (!response.ok || !response.payload) {
          throw new Error(
            typeof response.payload?.error === 'string'
              ? response.payload.error
              : `Work Map unavailable (${String(response.status)}).`
          )
        }
        return ok(compactWorkMap(response.payload, args, currentThreadId), 'workmap_query')
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'workmap_create_todo_chat',
    {
      description:
        'Create a dormant Todo chat without starting another agent. Use this when the user asks to save distinct future work. Seed the new chat with the goal, known context, constraints, open questions, acceptance checks, and concrete references already available. The Todo stays ready for the user to open, think through, and start with their first message.',
      inputSchema: workMapCreateTodoChatSchema
    },
    async (args: z.infer<typeof workMapCreateTodoChatSchema>) => {
      try {
        const currentThreadId = options.currentThreadId?.trim() ?? ''
        if (!currentThreadId) {
          throw new TypeError('workmap_create_todo_chat requires an active worker chat.')
        }
        const response = await authority('/agent-router/v1/pi/work-map/todo-chats/agent', {
          body: JSON.stringify({
            brief: {
              acceptance: args.acceptance,
              constraints: args.constraints,
              context: args.context,
              desiredOutcome: args.desired_outcome,
              goal: args.goal,
              knownFacts: args.known_facts,
              openQuestions: args.open_questions,
              references: args.references,
              suggestedNextStep: args.suggested_next_step
            },
            currentThreadId,
            expectedRevision: args.expected_revision,
            projectId: args.project_id,
            requestId: args.request_id,
            title: args.title
          }),
          method: 'POST'
        })
        if (!response.ok || !response.payload) {
          throw new Error(
            typeof response.payload?.error === 'string'
              ? response.payload.error
              : `Todo chat creation failed (${String(response.status)}).`
          )
        }
        const thread = isRecord(response.payload.thread) ? response.payload.thread : null
        const todo = isRecord(response.payload.todo) ? response.payload.todo : null
        return ok(
          {
            ...compactWorkMap(response.payload, { include_finished: false }, currentThreadId),
            threadId: typeof thread?.id === 'string' ? thread.id : null,
            todoId: typeof todo?.id === 'string' ? todo.id : null,
            todoStatus: typeof todo?.status === 'string' ? todo.status : null
          },
          'workmap_create_todo_chat'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'workmap_apply',
    {
      description:
        'Atomically organize the active chat or update its linked todos in the durable Work Map. A worker may place only itself and cannot override a manual placement. Use workmap_create_todo_chat—not create_todo—when saving distinct future work. Todo statuses are Todo, In motion, and Finished. Move active work to In motion and mark it Finished after the requested result is verified; blockers remain In motion and are explained in chat. Projects may contain one subproject level only.',
      inputSchema: workMapApplySchema
    },
    async (args: z.infer<typeof workMapApplySchema>) => {
      try {
        const currentThreadId = options.currentThreadId?.trim() ?? ''
        const response = await authority('/agent-router/v1/pi/work-map/agent', {
          body: JSON.stringify({
            currentThreadId: currentThreadId || undefined,
            expectedRevision: args.expected_revision,
            operations: withCurrentThread(args.operations, currentThreadId),
            requestId: args.request_id
          }),
          method: 'POST'
        })
        if (!response.ok || !response.payload) {
          throw new Error(
            typeof response.payload?.error === 'string'
              ? response.payload.error
              : `Work Map update failed (${String(response.status)}).`
          )
        }
        return ok(
          {
            ...compactWorkMap(response.payload, { include_finished: false }, currentThreadId),
            ...(isRecord(response.payload.receipt) ? { receipt: response.payload.receipt } : {})
          },
          'workmap_apply'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )
}

export function workMapSnapshotFromPayload(value: unknown): WorkMapSnapshot | null {
  if (!isRecord(value) || value.version !== 1 || !Number.isInteger(value.revision)) return null
  return {
    placements: placementsFrom(value.placements),
    projects: projectsFrom(value.projects),
    revision: Number(value.revision),
    todos: todosFrom(value.todos),
    version: 1
  }
}
