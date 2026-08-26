import { createAutomationBoardBuildHandler } from '@/app/automation/bridge/board-build'
import { recordMutationRequestReceipt } from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

export const ANCHOR_ID = 'node:code-object-anchor'
export const BOARD_REVISION = 12
export const OBJECT_KEY = 'idea-dashboard'
export const OWNER_ID = 'node:code-object-owner'
export const REQUEST_ID = 'request:code-object-build'
export const SOURCE =
  'export default function IdeaDashboard() { return <main>Build the idea</main> }'
export const SOURCE_HASH = `sha256:${'1'.repeat(64)}`

type Calls = {
  contexts: number
  creates: unknown[]
  persistence: number[]
  presentations: unknown[]
  reads: unknown[]
  refines: unknown[]
}

type HarnessOptions = {
  boardRead?: unknown
  createResult?: unknown
  persistence?: {
    duration_ms: number
    reason?: string
    requested_scene_revision: number
    status: 'durable' | 'unknown'
    target?: 'browser_local' | 'local_workspace_authority'
  }
  presentation?: unknown
  refineResult?: unknown
  semanticRead?: unknown
  semanticReadRejectsKeyLookup?: boolean
}

type StoredReceiptRoute = 'refine_code_object' | 'upsert_code_object'

export function target(): AutomationTarget {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  return {
    contentDocumentId: 'content-document:code-object-build',
    documentId: 'document-tab:code-object-build',
    documentName: 'Code Object build document',
    pageId,
    pageName: store.graph.getNode(pageId)?.name ?? 'Page 1',
    runtimeInstanceId: 'runtime:code-object-build',
    store,
    workspaceId: 'workspace:code-object-build'
  }
}

export function recipe(overrides: Record<string, unknown> = {}) {
  return {
    initial_state: { count: 0 },
    kind: 'code_object',
    name: 'Idea dashboard',
    object_key: OBJECT_KEY,
    operation: 'create',
    props: { accent: 'violet' },
    source: SOURCE,
    source_format: 'tsx',
    ...overrides
  }
}

export function args(recipeValue: Record<string, unknown> = recipe()) {
  return {
    anchor_id: ANCHOR_ID,
    context_token: 'context:code-object-build',
    contract: 'board-build/v1',
    expected_revision: BOARD_REVISION,
    extension: {
      contract: 'board-builder-extension/v1',
      profile_id: 'calm-technical',
      skill_id: 'optional-design-taste'
    },
    intent: 'Create one interactive idea dashboard',
    recipe: recipeValue,
    request_id: REQUEST_ID,
    task_id: 'task:code-object-build',
    trace_id: 'trace:code-object-build'
  }
}

export function refineRecipe(overrides: Record<string, unknown> = {}) {
  return {
    expected_source_hash: SOURCE_HASH,
    kind: 'code_object',
    name: 'Idea dashboard v2',
    object_key: OBJECT_KEY,
    operation: 'refine',
    owner_id: OWNER_ID,
    props: { accent: 'cyan' },
    source: `${SOURCE}\n// refined`,
    source_format: 'tsx',
    ...overrides
  }
}

export function refineBuildArgs(recipeValue: Record<string, unknown> = refineRecipe()) {
  const { anchor_id: _anchorId, ...buildArgs } = args(recipeValue)
  return buildArgs
}

export function semanticReadback() {
  return {
    component: {
      definition_id: OBJECT_KEY,
      name: 'Idea dashboard',
      props: { accent: 'violet' },
      source: SOURCE,
      state: { count: 0 }
    },
    frame: {
      height: 520,
      id: OWNER_ID,
      name: 'Idea dashboard',
      type: 'FRAME',
      width: 720,
      x: 220,
      y: 80
    }
  }
}

export function recordStoredReceipt(
  exactTarget: AutomationTarget,
  route: StoredReceiptRoute,
  inputDigest: string,
  touchedProperties: string[]
): void {
  recordMutationRequestReceipt(exactTarget, {
    inputDigest,
    mutationReceipt: {
      appliedRevision: BOARD_REVISION + 1,
      enqueuedRevision: BOARD_REVISION,
      expectedRevision: BOARD_REVISION,
      requestId: REQUEST_ID,
      status: 'applied',
      touchedProperties
    },
    objectIds: [OWNER_ID],
    requestId: REQUEST_ID,
    route,
    semanticIds: [OBJECT_KEY],
    version: 1
  })
}

export function createHarness(options: HarnessOptions = {}) {
  const calls: Calls = {
    contexts: 0,
    creates: [],
    persistence: [],
    presentations: [],
    reads: [],
    refines: []
  }
  const handler = createAutomationBoardBuildHandler({
    board: {
      change: () => Promise.reject(new Error('Unexpected board_change call.')),
      context: (exactTarget) => {
        calls.contexts += 1
        return Promise.resolve({
          board_build_base: {
            content_document_id: exactTarget.contentDocumentId,
            context_token: 'context:code-object-present',
            contract: 'board-build/v1',
            document_id: exactTarget.documentId,
            expected_revision: BOARD_REVISION,
            page_id: exactTarget.pageId,
            runtime_instance_id: exactTarget.runtimeInstanceId,
            workspace_id: exactTarget.workspaceId
          },
          context_token: 'context:code-object-present'
        })
      },
      present(_target, presentArgs) {
        calls.presentations.push(presentArgs)
        return Promise.resolve(
          options.presentation ?? {
            presentation: { acknowledged: true, selected_ids: [OWNER_ID] }
          }
        )
      },
      read(_target, readArgs) {
        calls.reads.push(readArgs)
        return Promise.resolve(
          options.boardRead ?? {
            board_revision: BOARD_REVISION,
            nodes: [{ id: ANCHOR_ID }],
            scope: 'selection'
          }
        )
      }
    },
    canWrite: () => true,
    codeObjectCreate(_target, createArgs) {
      calls.creates.push(createArgs)
      return Promise.resolve(
        options.createResult ?? {
          owner_id: OWNER_ID,
          placement: { bounds: { height: 520, width: 720, x: 220, y: 80 } },
          readback: semanticReadback(),
          receipt: { idempotentReplay: false, requestId: REQUEST_ID, status: 'applied' },
          semantic_owner: 'upsert_code_object',
          status: { attention_required: false, command: 'completed', mutation: 'applied' }
        }
      )
    },
    codeObjectRead(_target, readArgs) {
      if (
        options.semanticReadRejectsKeyLookup &&
        typeof readArgs === 'object' &&
        readArgs !== null &&
        'object_key' in readArgs
      ) {
        return Promise.reject(new Error(`Code Object key "${OBJECT_KEY}" is duplicated.`))
      }
      return Promise.resolve(options.semanticRead ?? semanticReadback()).then((result) => {
        calls.reads.push(readArgs)
        return result
      })
    },
    codeObjectRefine(_target, refineArgs) {
      calls.refines.push(refineArgs)
      return Promise.resolve(
        options.refineResult ?? {
          owner_id: OWNER_ID,
          preservation: {
            board_permissions: true,
            geometry: true,
            legacy_connections: true,
            object_graph_connections: true,
            other_plugin_data: true,
            state: true
          },
          readback: { code_object: { reconciliation: { reasons: [], status: 'current' } } },
          receipt: { idempotent_replay: false, requestId: REQUEST_ID, status: 'applied' },
          semantic_owner: { owner_id: OWNER_ID, root_object_id: OWNER_ID },
          status: { attention_required: false, command: 'completed', mutation: 'applied' }
        }
      )
    },
    mermaid: () => Promise.reject(new Error('Unexpected Mermaid call.')),
    mermaidSource: () => Promise.reject(new Error('Unexpected Mermaid source call.')),
    persist(_store, revision) {
      calls.persistence.push(revision)
      return Promise.resolve(
        options.persistence ?? {
          duration_ms: 1,
          requested_scene_revision: revision,
          status: 'durable',
          target: 'local_workspace_authority'
        }
      )
    }
  })
  return { calls, handler }
}
