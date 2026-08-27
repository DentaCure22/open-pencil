import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  WORK_MAP_TODO_STATUSES,
  type WorkMapBot,
  type WorkMapOperation,
  type WorkMapPlacement,
  type WorkMapProject,
  type WorkMapRoutine,
  type WorkMapSnapshot,
  type WorkMapTodo
} from '#mcp/agent-router/work-map'
import { fail, ok } from '#mcp/result'
import { authorityJson } from '#mcp/tool/authority-client'

type AuthorityClient = typeof authorityJson

export const WORK_MAP_TOOL_NAMES = [
  'workmap_apply',
  'workmap_capture_future_work',
  'workmap_query',
  'workmap_update_todo_object'
] as const

export type WorkMapToolOptions = {
  allowConversationLifecycle?: boolean
  authorityRequest?: AuthorityClient
  currentThreadId?: string
}

const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    op: z
      .literal('create_project')
      .describe(
        'Compatibility operation that creates a Bot directory only, without an empty Board frame'
      ),
    parent_id: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe('Parent Bot directory for a one-level sub-bot')
      .optional(),
    project_id: z.string().trim().min(1).max(240).describe('Stable Bot directory ID').optional()
  })
  .strict()

const renameProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    op: z.literal('rename_project'),
    project_id: z.string().trim().min(1).max(240)
  })
  .strict()

const setProjectSpaceSchema = z
  .object({
    frame_id: z.string().trim().min(1).max(240).nullable(),
    op: z
      .literal('set_project_space')
      .describe(
        'Bind the exact Board frame created for this directory when its first Board object is placed; a sub-bot frame must be nested inside its parent Bot frame'
      ),
    page_id: z.string().trim().min(1).max(240).nullable(),
    project_id: z.string().trim().min(1).max(240)
  })
  .strict()
  .refine((value) => (value.frame_id === null) === (value.page_id === null), {
    message: 'page_id and frame_id must both be set or both be null'
  })

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

const createBotSchema = z
  .object({
    bot_id: z.string().trim().min(1).max(240).optional(),
    op: z.literal('create_bot'),
    project_id: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe('Bot directory that owns this persistent charter chat'),
    thread_id: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe('Defaults to the active worker chat')
      .optional()
  })
  .strict()

const createRoutineSchema = z
  .object({
    bot_id: z.string().trim().min(1).max(240),
    create_briefing_object: z
      .boolean()
      .optional()
      .describe(
        'Create a structured read-only briefing Code Object owned by each successful Inbox receipt; leave false for simple checks'
      ),
    every_minutes: z.number().int().min(1).max(525_600).optional(),
    next_run_at: z.string().datetime({ offset: true }),
    op: z.literal('create_routine'),
    prompt: z.string().trim().min(1).max(8_000),
    routine_id: z.string().trim().min(1).max(240).optional()
  })
  .strict()

const updateRoutineSchema = z
  .object({
    create_briefing_object: z
      .boolean()
      .describe('Whether successful runs create a structured read-only Inbox briefing Code Object'),
    op: z.literal('update_routine'),
    routine_id: z.string().trim().min(1).max(240)
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

const archiveTodoSchema = z
  .object({
    confirmed: z
      .literal(true)
      .describe('Set only after the user confirms the exact archive list in a later turn'),
    op: z.literal('archive_todo'),
    todo_id: z.string().trim().min(1).max(240)
  })
  .strict()

const restoreTodoSchema = z
  .object({
    op: z.literal('restore_todo'),
    todo_id: z.string().trim().min(1).max(240)
  })
  .strict()

const workMapOperationSchemas = [
  createProjectSchema,
  renameProjectSchema,
  setProjectSpaceSchema,
  placeChatSchema,
  createBotSchema,
  createRoutineSchema,
  updateRoutineSchema,
  createTodoSchema,
  updateTodoSchema
] as const

const workMapOperationSchema = z.discriminatedUnion('op', workMapOperationSchemas)

const conversationLifecycleOperationSchema = z.discriminatedUnion('op', [
  ...workMapOperationSchemas,
  archiveTodoSchema,
  restoreTodoSchema
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

const conversationLifecycleWorkMapApplySchema = z
  .object({
    expected_revision: z
      .number()
      .int()
      .min(0)
      .describe('Revision returned by the latest workmap_query call'),
    operations: z.array(conversationLifecycleOperationSchema).min(1).max(100),
    request_id: z.string().trim().min(1).max(240).optional()
  })
  .strict()

const todoReferenceSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .describe('Exact ID, path, or URL already available in the current chat'),
    kind: z.enum(['board_object', 'chat', 'file', 'image', 'trace_evidence', 'url']),
    label: z.string().trim().min(1).max(240),
    note: z.string().trim().max(1_000).optional()
  })
  .strict()

const workMapCreateTodoChatSchema = z
  .object({
    acceptance: z
      .array(z.string().trim().min(1).max(1_000))
      .max(24)
      .optional()
      .describe('Optional success checks already stated or obvious from the current chat'),
    constraints: z
      .array(z.string().trim().min(1).max(1_000))
      .max(24)
      .optional()
      .describe('Optional limits already established in the current chat'),
    context: z
      .string()
      .trim()
      .max(4_000)
      .optional()
      .describe('Optional short reason this came up or why it is being deferred'),
    desired_outcome: z
      .string()
      .trim()
      .max(2_000)
      .optional()
      .describe('Optional concrete result when it is already clear'),
    document_html: z
      .string()
      .trim()
      .max(100_000)
      .optional()
      .describe(
        'Optional complete HTML for the Todo Code Object. Use semantic, directly editable text and responsive inline CSS that reflows from narrow Object panels to wide surfaces; avoid fixed-width layouts and omit scripts. If absent, OpenPencil creates the responsive todo-document preset.'
      ),
    expected_revision: z
      .number()
      .int()
      .min(0)
      .describe('Revision returned by the latest workmap_query call'),
    goal: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .describe(
        'One sentence describing the future work; keep this useful even when capture is thin'
      ),
    known_facts: z
      .array(z.string().trim().min(1).max(1_000))
      .max(24)
      .optional()
      .describe('Optional facts already established; do not research to fill this field'),
    open_questions: z
      .array(z.string().trim().min(1).max(1_000))
      .max(24)
      .optional()
      .describe('Optional decisions visibly left open; the future Todo chat can elaborate them'),
    project_id: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe('Bot directory that should own the Todo'),
    references: z
      .array(todoReferenceSchema)
      .max(24)
      .optional()
      .describe(
        'Optional exact references already in hand; do not gather new evidence for capture'
      ),
    request_id: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe('Unique idempotency key for this capture'),
    suggested_next_step: z
      .string()
      .trim()
      .max(2_000)
      .optional()
      .describe('Optional first move that will help the future chat begin'),
    title: z.string().trim().min(1).max(240).describe('Short, actionable Todo chat title')
  })
  .strict()

const workMapUpdateTodoObjectSchema = z
  .object({
    document_html: z
      .string()
      .trim()
      .min(1)
      .max(200_000)
      .describe(
        "Complete replacement HTML for this chat's Todo Code Object. Preserve useful user edits and references. Use semantic, directly editable text and responsive CSS that reflows from narrow Object panels to wide surfaces; omit scripts."
      ),
    title: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe('Canonical Todo title shown in the Work Map, chat, and HTML heading')
  })
  .strict()

type WorkMapQueryArgs = {
  include_archived?: boolean
  project_id?: string
}

const workMapQuerySchema = z
  .object({
    project_id: z.string().trim().min(1).max(240).optional()
  })
  .strict()

const conversationLifecycleWorkMapQuerySchema = workMapQuerySchema.extend({
  include_archived: z
    .boolean()
    .optional()
    .describe('Include archived Todo chats only to resolve an explicit restore request')
})

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
          (project.botId === undefined || typeof project.botId === 'string') &&
          (project.parentId === undefined || typeof project.parentId === 'string') &&
          (project.spaceFrameId === undefined || typeof project.spaceFrameId === 'string') &&
          (project.spacePageId === undefined || typeof project.spacePageId === 'string') &&
          (project.workspaceRoot === undefined || typeof project.workspaceRoot === 'string') &&
          (project.spaceFrameId === undefined) === (project.spacePageId === undefined)
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
          (todo.archivedAt === undefined || typeof todo.archivedAt === 'string') &&
          typeof todo.id === 'string' &&
          typeof todo.projectId === 'string' &&
          typeof todo.title === 'string' &&
          WORK_MAP_TODO_STATUSES.includes(todo.status as WorkMapTodo['status'])
      )
    : []
}

function botsFrom(value: unknown): WorkMapBot[] {
  return Array.isArray(value)
    ? value.filter(
        (bot): bot is WorkMapBot =>
          isRecord(bot) &&
          typeof bot.id === 'string' &&
          typeof bot.threadId === 'string' &&
          (bot.projectId === null || typeof bot.projectId === 'string')
      )
    : []
}

function routinesFrom(value: unknown): WorkMapRoutine[] {
  return Array.isArray(value)
    ? value.filter(
        (routine): routine is WorkMapRoutine =>
          isRecord(routine) &&
          typeof routine.botId === 'string' &&
          typeof routine.enabled === 'boolean' &&
          typeof routine.id === 'string' &&
          typeof routine.prompt === 'string'
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
  const bots = botsFrom(payload.bots)
  const routines = routinesFrom(payload.routines)
  const currentPlacement = currentThreadId
    ? (placements.find((placement) => placement.threadId === currentThreadId) ?? null)
    : null
  const projectId = args.project_id?.trim() || currentPlacement?.projectId || ''
  let visibleProjectIds: string[]
  if (projectId) {
    visibleProjectIds = [
      projectId,
      ...projects.filter((project) => project.parentId === projectId).map((project) => project.id)
    ]
  } else {
    visibleProjectIds = currentThreadId ? [] : projects.map((project) => project.id)
  }
  const projectIds = new Set(visibleProjectIds)
  const visibleBots = bots
    .filter((bot) =>
      projectId
        ? bot.threadId === currentThreadId ||
          bot.projectId === projectId ||
          projectIds.has(bot.projectId ?? '')
        : true
    )
    .slice(0, 100)
  const visibleBotIds = new Set(visibleBots.map((bot) => bot.id))
  const visibleTodos = todos
    .filter((todo) => projectIds.has(todo.projectId))
    .filter((todo) => args.include_archived || !todo.archivedAt)
    .slice(0, 100)
  const counts = Object.fromEntries(
    WORK_MAP_TODO_STATUSES.map((status) => [
      status,
      todos.filter(
        (todo) => projectIds.has(todo.projectId) && !todo.archivedAt && todo.status === status
      ).length
    ])
  )
  const directories = projects.map((project) => ({
    botId: project.botId ?? null,
    id: project.id,
    name: project.name,
    ...(project.parentId ? { parentId: project.parentId } : {}),
    ...(project.spaceFrameId && project.spacePageId
      ? {
          space: { frameId: project.spaceFrameId, pageId: project.spacePageId }
        }
      : { space: null }),
    workspaceRoot: project.workspaceRoot ?? null,
    openTodoCount: todos.filter((todo) => todo.projectId === project.id && !todo.archivedAt).length
  }))
  return {
    bots: visibleBots,
    currentBot: currentThreadId
      ? (bots.find((bot) => bot.threadId === currentThreadId) ?? null)
      : null,
    currentPlacement,
    ...(currentThreadId ? { currentThreadId } : {}),
    directories,
    projects: directories,
    revision: Number.isInteger(payload.revision) ? payload.revision : 0,
    routines: routines.filter((routine) => visibleBotIds.has(routine.botId)).slice(0, 100),
    selectedDirectoryId: projectId || null,
    selectedProjectId: projectId || null,
    todoCounts: counts,
    todos: visibleTodos
  }
}

function withCurrentThread(
  operations: readonly WorkMapOperation[],
  currentThreadId: string
): WorkMapOperation[] {
  return operations.map((operation) => {
    if (operation.op === 'place_chat') {
      const threadId = operation.thread_id?.trim() || currentThreadId
      if (!threadId) throw new TypeError('place_chat requires thread_id outside a worker chat.')
      return { ...operation, thread_id: threadId }
    }
    if (operation.op === 'create_bot') {
      const threadId = operation.thread_id?.trim() || currentThreadId
      if (!threadId) throw new TypeError('create_bot requires thread_id outside a worker chat.')
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
  const allowConversationLifecycle = options.allowConversationLifecycle === true
  const register = mcpServer.registerTool.bind(mcpServer) as (...args: unknown[]) => void

  register(
    'workmap_query',
    {
      description:
        "Read the active durable Work Map as Bot directories: root Bots, one-level sub-bots, each directory's exact Board space frame/page when bound, its persistent charter chat and schedules, placed working chats, and unarchived Todos. A directory has no Board space until its first Board object needs one. A sub-bot's directory entry names its parent, whose bound frame is the required Board parent for the sub-bot space. The projects field is a compatibility alias of directories. Inbox contains scheduled-run receipts, never Bot directories. Archived chats stay out unless the live parent sets include_archived for an explicit restore request. At the beginning of an unplaced Board chat, use board_where first, then choose an existing Bot directory or an honest Misc placement. Read-only.",
      inputSchema: allowConversationLifecycle
        ? conversationLifecycleWorkMapQuerySchema
        : workMapQuerySchema
    },
    async (args: WorkMapQueryArgs) => {
      try {
        const currentThreadId = options.currentThreadId?.trim() ?? ''
        if (args.include_archived && !allowConversationLifecycle) {
          throw new TypeError('Only the live parent can inspect archived Work Map chats.')
        }
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
    'workmap_capture_future_work',
    {
      description:
        'Capture distinct future work without interrupting the current task. Creates one dormant Todo chat with one editable, responsive Todo Code Object rendered by the todo-document preset; it does not start another agent or a Plan Code Object. Send a short title and one-sentence goal. Include only context, facts, constraints, questions, acceptance checks, references, or tailored HTML already supported by the current conversation. The user can open the same Todo later and elaborate its Code Object there.',
      inputSchema: workMapCreateTodoChatSchema
    },
    async (args: z.infer<typeof workMapCreateTodoChatSchema>) => {
      try {
        const currentThreadId = options.currentThreadId?.trim() ?? ''
        if (!currentThreadId) {
          throw new TypeError('workmap_capture_future_work requires an active worker chat.')
        }
        const response = await authority('/agent-router/v1/pi/work-map/todo-chats/agent', {
          body: JSON.stringify({
            brief: {
              acceptance: args.acceptance,
              constraints: args.constraints,
              context: args.context,
              desiredOutcome: args.desired_outcome,
              documentHtml: args.document_html,
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
            ...compactWorkMap(response.payload, {}, currentThreadId),
            threadId: typeof thread?.id === 'string' ? thread.id : null,
            todoId: typeof todo?.id === 'string' ? todo.id : null,
            todoStatus: typeof todo?.status === 'string' ? todo.status : null
          },
          'workmap_capture_future_work'
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
        'Atomically organize the active chat inside a Bot directory, bind that directory to an exact Board frame with set_project_space, configure its persistent charter chat, or update a linked Todo. create_project is the compatibility operation for creating a root Bot directory or one-level sub-bot. Creating a Bot or sub-bot never creates an empty Board frame: leave its space absent until the first Board object is placed, then create one dedicated parent frame and bind its exact page and frame IDs. A sub-bot Board frame must be created or reparented inside its bound parent Bot frame, and its space cannot bind before the parent space or on another page. create_bot attaches the active or newly dispatched persistent charter chat and must name its owning project_id; Bots never live in Inbox or Misc. create_routine adds Scheduled work to that Bot directory. Decide per routine whether create_briefing_object should add a read-only briefing Object to each successful run; leave it off for simple checks. update_routine can change that briefing choice later without recreating the schedule. A scheduled routine stays Scheduled and only its run receipt appears in Inbox; it does not become In motion. Todo and In motion are the only active states. Only ordinary working chats and user-started Todos appear in In motion, and only a Todo transitions from Todo to In motion. A worker may change only its active chat and cannot override a manual placement. Use workmap_capture_future_work—not create_todo—when saving distinct future work. When work settles, report the result in chat and leave it visible until the user archives the conversation. On the live parent only, show the exact archive list and wait for later confirmation before archive_todo with confirmed true. Restore exact Todo chats immediately when asked. Apply lifecycle operations separately from organization changes. Archiving preserves the chat and evidence. No delete operation is exposed.',
      inputSchema: allowConversationLifecycle
        ? conversationLifecycleWorkMapApplySchema
        : workMapApplySchema
    },
    async (args: z.infer<typeof conversationLifecycleWorkMapApplySchema>) => {
      try {
        const currentThreadId = options.currentThreadId?.trim() ?? ''
        const operations = withCurrentThread(args.operations, currentThreadId)
        const lifecycleOperations = operations.filter(
          (operation) => operation.op === 'archive_todo' || operation.op === 'restore_todo'
        )
        if (lifecycleOperations.length && !allowConversationLifecycle) {
          throw new TypeError('Only the live parent can archive or restore Work Map chats.')
        }
        if (lifecycleOperations.length && lifecycleOperations.length !== operations.length) {
          throw new TypeError(
            'Archive or restore chats in a separate Work Map apply from organization changes.'
          )
        }
        const userAuthorizedLifecycle = lifecycleOperations.length > 0
        const response = await authority(
          userAuthorizedLifecycle
            ? '/agent-router/v1/pi/work-map/apply'
            : '/agent-router/v1/pi/work-map/agent',
          {
            body: JSON.stringify({
              ...(userAuthorizedLifecycle ? {} : { currentThreadId: currentThreadId || undefined }),
              expectedRevision: args.expected_revision,
              operations,
              requestId: args.request_id
            }),
            method: 'POST'
          }
        )
        if (!response.ok || !response.payload) {
          throw new Error(
            typeof response.payload?.error === 'string'
              ? response.payload.error
              : `Work Map update failed (${String(response.status)}).`
          )
        }
        return ok(
          {
            ...compactWorkMap(response.payload, {}, currentThreadId),
            ...(isRecord(response.payload.receipt) ? { receipt: response.payload.receipt } : {})
          },
          'workmap_apply'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'workmap_update_todo_object',
    {
      description:
        "Update the active chat's existing Todo Code Object. Use this after the user or conversation materially changes the Todo brief. Replace the same todo-document HTML rather than creating another Todo, chat, or object. Keep the document directly editable and responsive at narrow and wide Object-panel sizes. This does not start work or change Todo status.",
      inputSchema: workMapUpdateTodoObjectSchema
    },
    async (args: z.infer<typeof workMapUpdateTodoObjectSchema>) => {
      try {
        const currentThreadId = options.currentThreadId?.trim() ?? ''
        if (!currentThreadId) {
          throw new TypeError('workmap_update_todo_object requires an active Todo chat.')
        }
        const response = await authority(
          `/agent-router/v1/pi/conversations/${encodeURIComponent(currentThreadId)}/todo-draft`,
          {
            body: JSON.stringify({
              documentHtml: args.document_html,
              title: args.title
            }),
            method: 'PATCH'
          }
        )
        if (!response.ok || !response.payload) {
          throw new Error(
            typeof response.payload?.error === 'string'
              ? response.payload.error
              : `Todo Code Object update failed (${String(response.status)}).`
          )
        }
        return ok(
          { threadId: currentThreadId, title: args.title, updated: true },
          'workmap_update_todo_object'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )
}

type WorkMapDirectorySnapshot = Pick<WorkMapSnapshot, 'placements' | 'projects' | 'todos'>

export function workMapSnapshotFromPayload(value: unknown): WorkMapDirectorySnapshot | null {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !Number.isInteger(value.revision)
  ) {
    return null
  }
  return {
    placements: placementsFrom(value.placements),
    projects: projectsFrom(value.projects),
    todos: todosFrom(value.todos)
  }
}
