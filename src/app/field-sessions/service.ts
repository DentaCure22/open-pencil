import {
  getDocumentPersistenceReadiness,
  persistOpenPencilDocument,
} from '@/app/document/persistence-target'
import type { EditorStore } from '@/app/editor/session'
import { resolveExperienceFamily } from '@/app/experience-family'
import {
  observedHumanSessionState,
  type ObservedHumanSessionState,
} from '@/app/human-sessions'
import { verifyPersistedLearningReceiptAttestation } from '@/app/learning-receipts'
import {
  createWorkspaceId,
  getKnowledgeWorkspace,
  type KnowledgeWorkspace,
  type LearningReceipt,
  type WorkspaceObject,
} from '@/app/workspace'
import { runWorkspaceDocumentTransaction } from '@/app/workspace-ui/document-transaction'
import {
  ensureKnowledgeWorkspacesHydrated,
  workspaceDocumentId,
} from '@/app/workspace-ui/persistence'
import { useKnowledgeWorkspaceUi } from '@/app/workspace-ui/use'
import {
  getPreparedFieldRun,
  prepareFieldRun,
  readPreparedFieldRuns,
  recordFieldRunAttemptEnded,
  recordFieldRunAttemptStarted,
  type PreparedFieldRun,
  type PrepareFieldRunInput,
} from './ledger'

export type PreparedFieldRunStatus =
  | 'aborted'
  | 'active'
  | 'expired'
  | 'interrupted'
  | 'prepared'
  | 'stale'
  | 'verified-completed'

export type PreparedFieldRunSummary = {
  formId: string | null
  receiptId: string | null
  run: PreparedFieldRun
  status: PreparedFieldRunStatus
}

function exactRef(
  left: { objectId: string; revision: number },
  right: { objectId: string; revision: number }
): boolean {
  return left.objectId === right.objectId && left.revision === right.revision
}

function exactTarget(
  left: PreparedFieldRun['target'],
  right: PreparedFieldRun['target']
): boolean {
  return (
    exactRef(left.intent, right.intent) &&
    exactRef(left.evidenceManifest, right.evidenceManifest) &&
    exactRef(left.surfaceRun, right.surfaceRun) &&
    left.artifact.artifactId === right.artifact.artifactId &&
    left.artifact.boardId === right.artifact.boardId &&
    left.artifact.boardRevision === right.artifact.boardRevision &&
    left.artifact.boardSchemaVersion === right.artifact.boardSchemaVersion &&
    left.artifact.sourceHash === right.artifact.sourceHash
  )
}

function exactFamily(
  left: NonNullable<PreparedFieldRun['scope']>['family'],
  right: NonNullable<PreparedFieldRun['scope']>['family']
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function proofMatchesRunScope(
  receipt: LearningReceipt,
  run: PreparedFieldRun
): boolean {
  const claim = receipt.attestation.proof?.claim
  if (run.version === 1) return claim?.version !== 2
  return Boolean(
    claim?.version === 2 && exactFamily(claim.scope.family, run.scope.family)
  )
}

function fieldSessionId(runCode: string): string {
  return `field-session_${runCode}`
}

async function verifiedReceiptForRun(
  store: EditorStore,
  run: PreparedFieldRun,
  crypto: Crypto
): Promise<LearningReceipt | null> {
  ensureKnowledgeWorkspacesHydrated(store.graph)
  const workspace = getKnowledgeWorkspace(
    workspaceDocumentId(store.graph),
    run.targetPageId
  )
  if (!workspace) return null
  const receipts = Object.values(workspace.objects).filter(
    (object): object is LearningReceipt =>
      object.type === 'learning-receipt' &&
      object.executionKind === 'human' &&
      object.attestation.kind === 'observed-session' &&
      object.attestation.proof?.claim.fieldSessionId ===
        fieldSessionId(run.runCode) &&
      object.attestation.proof.claim.surfaceRunId ===
        run.target.surfaceRun.objectId &&
      exactTarget(object.attestation.proof.claim.target, run.target) &&
      proofMatchesRunScope(object, run)
  )
  for (const receipt of receipts) {
    try {
      await verifyPersistedLearningReceiptAttestation(receipt, crypto)
      return receipt
    } catch (error) {
      console.warn(
        `[Field runs] Receipt ${receipt.id} did not reverify and cannot complete ${run.runCode}`,
        error
      )
    }
  }
  return null
}

function sessionMatchesRun(
  session: ObservedHumanSessionState,
  run: PreparedFieldRun
): boolean {
  return Boolean(
    session.sessionId &&
    session.fieldSessionId === fieldSessionId(run.runCode) &&
    session.target &&
    exactTarget(session.target, run.target) &&
    (run.version === 1 ||
      (session.scope?.kind === 'experience-family' &&
        exactFamily(session.scope.family, run.scope.family)))
  )
}

function targetStillEligible(
  store: EditorStore,
  run: PreparedFieldRun
): boolean {
  const workspace = getKnowledgeWorkspace(
    workspaceDocumentId(store.graph),
    run.targetPageId
  )
  if (
    !workspace ||
    !Object.hasOwn(workspace.objects, run.target.surfaceRun.objectId)
  )
    return false
  const object = workspace.objects[run.target.surfaceRun.objectId]
  const primaryEligible = Boolean(
    object.type === 'surface-run' &&
    object.revision === run.target.surfaceRun.revision &&
    object.status === 'in-review' &&
    object.artifact.boardId === run.boardId
  )
  if (!primaryEligible || run.version === 1) return primaryEligible
  try {
    const family = resolveExperienceFamily(workspace, run.rootSurface, {
      graph: store.graph,
      requireMaterializedBoards: true,
    })
    return (
      exactFamily(family, run.scope.family) &&
      family.members.every((member) => {
        if (!Object.hasOwn(workspace.objects, member.surfaceRun.objectId))
          return false
        const surface = workspace.objects[member.surfaceRun.objectId]
        if (surface.type !== 'surface-run') return false
        const capabilities: Record<string, unknown> = surface.capabilities
        return Boolean(
          surface.revision === member.surfaceRun.revision &&
          surface.status === 'in-review' &&
          capabilities.externalWrites === false &&
          capabilities.networkAccess === false &&
          capabilities.sourceWrites === false
        )
      })
    )
  } catch {
    return false
  }
}

function requireEligiblePreparedFamily(
  store: EditorStore,
  workspace: KnowledgeWorkspace,
  run: PreparedFieldRun
): void {
  if (run.version === 1) return
  const family = resolveExperienceFamily(workspace, run.rootSurface, {
    graph: store.graph,
    requireMaterializedBoards: true,
  })
  if (!exactFamily(family, run.scope.family)) {
    throw new Error(`field_run_family_stale: ${run.runCode}`)
  }
  for (const member of family.members) {
    const object = workspace.objects[member.surfaceRun.objectId] as
      WorkspaceObject | undefined
    const capabilities: Record<string, unknown> =
      object?.type === 'surface-run' ? object.capabilities : {}
    if (
      object?.type !== 'surface-run' ||
      object.status !== 'in-review' ||
      capabilities.externalWrites !== false ||
      capabilities.networkAccess !== false ||
      capabilities.sourceWrites !== false
    ) {
      throw new Error(
        `field_run_family_member_not_eligible: ${member.surfaceRun.objectId}`
      )
    }
  }
}

function requireMaterializedPreparedBoards(
  store: EditorStore,
  run: PreparedFieldRun
): void {
  const boardIds =
    run.version === 2
      ? run.scope.family.members.map((member) => member.artifact.boardId)
      : [run.boardId]
  const missingBoardId = boardIds.find(
    (boardId) => !store.graph.getNode(boardId)
  )
  if (missingBoardId) {
    throw new Error(`field_run_board_not_materialized: ${missingBoardId}`)
  }
}

async function persistedMutation<T>(
  store: EditorStore,
  input: { historyLabel: string; runCode: string },
  mutation: () => T
): Promise<T> {
  const readiness = getDocumentPersistenceReadiness(store)
  if (!readiness.ready) {
    throw new Error(`field_run_persistence_not_ready: ${readiness.reason}`)
  }
  return runWorkspaceDocumentTransaction(
    store,
    {
      historyEntryId: createWorkspaceId('mutation'),
      label: `${input.historyLabel} ${input.runCode}`,
    },
    async () => {
      const value = mutation()
      if (!(await persistOpenPencilDocument(store))) {
        throw new Error('field_run_persistence_failed')
      }
      return value
    }
  )
}

export async function prepareFieldRunForStore(
  store: EditorStore,
  input: PrepareFieldRunInput
): Promise<{ created: boolean; run: PreparedFieldRun }> {
  const existing = getPreparedFieldRun(store.graph, input.runCode)
  if (existing) return prepareFieldRun(store.graph, input)
  return persistedMutation(
    store,
    { historyLabel: 'Prepare field run', runCode: input.runCode },
    () => prepareFieldRun(store.graph, input)
  )
}

export async function recordFieldRunAttemptStartedForStore(
  store: EditorStore,
  input: { runCode: string; sessionId: string; startedAt: string }
): Promise<PreparedFieldRun> {
  const result = await persistedMutation(
    store,
    { historyLabel: 'Start field run', runCode: input.runCode },
    () => recordFieldRunAttemptStarted(store.graph, input)
  )
  return result.run
}

export async function recordFieldRunAttemptEndedForStore(
  store: EditorStore,
  input: {
    endedAt: string
    result: 'aborted' | 'expired'
    runCode: string
    sessionId: string
  }
): Promise<PreparedFieldRun> {
  const result = await persistedMutation(
    store,
    { historyLabel: 'End field run', runCode: input.runCode },
    () => recordFieldRunAttemptEnded(store.graph, input)
  )
  return result.run
}

export async function preparedFieldRunSummaries(
  store: EditorStore,
  input: { crypto?: Crypto; session?: ObservedHumanSessionState } = {}
): Promise<PreparedFieldRunSummary[]> {
  const session = input.session ?? observedHumanSessionState()
  const crypto = input.crypto ?? globalThis.crypto
  return Promise.all(
    readPreparedFieldRuns(store.graph).map(async (run) => {
      const receipt = await verifiedReceiptForRun(store, run, crypto)
      if (receipt)
        return {
          formId: receipt.formId,
          receiptId: receipt.id,
          run,
          status: 'verified-completed' as const,
        }
      if (sessionMatchesRun(session, run)) {
        if (session.status === 'aborted') {
          return {
            formId: null,
            receiptId: null,
            run,
            status: 'aborted' as const,
          }
        }
        if (session.status === 'expired') {
          return {
            formId: null,
            receiptId: null,
            run,
            status: 'expired' as const,
          }
        }
        if (['active', 'issued', 'ready'].includes(session.status)) {
          return {
            formId: null,
            receiptId: null,
            run,
            status: 'active' as const,
          }
        }
      }
      const latest = run.attempts.at(-1)
      if (latest) {
        if (!latest.endedAt)
          return {
            formId: null,
            receiptId: null,
            run,
            status: 'interrupted' as const,
          }
        return {
          formId: null,
          receiptId: null,
          run,
          status: latest.result ?? 'interrupted',
        }
      }
      if (!targetStillEligible(store, run)) {
        return {
          formId: null,
          receiptId: null,
          run,
          status: 'stale' as const,
        }
      }
      return {
        formId: null,
        receiptId: null,
        run,
        status: 'prepared' as const,
      }
    })
  )
}

export async function activatePreparedFieldRunForStore(
  store: EditorStore,
  runCode: string
): Promise<PreparedFieldRun> {
  ensureKnowledgeWorkspacesHydrated(store.graph)
  const run = getPreparedFieldRun(store.graph, runCode)
  if (!run) throw new Error(`field_run_not_found: ${runCode}`)
  const workspace = getKnowledgeWorkspace(
    workspaceDocumentId(store.graph),
    run.targetPageId
  )
  if (!workspace)
    throw new Error(`field_run_workspace_not_found: ${run.targetPageId}`)
  const target = workspace.objects[run.target.surfaceRun.objectId] as
    WorkspaceObject | undefined
  if (
    target?.type !== 'surface-run' ||
    target.revision !== run.target.surfaceRun.revision ||
    target.status !== 'in-review' ||
    target.artifact.boardId !== run.boardId
  ) {
    throw new Error(`field_run_target_stale: ${run.runCode}`)
  }
  requireEligiblePreparedFamily(store, workspace, run)
  await useKnowledgeWorkspaceUi(store).activateExperienceProjection({
    basePageId: run.targetPageId,
    basePageName: store.graph.getNode(run.targetPageId)?.name ?? 'Workspace',
    pageId: run.projectionPageId,
    purpose: run.purpose,
    rootSurface: run.rootSurface,
    route: null,
    viewId: run.projectionViewId,
  })
  requireMaterializedPreparedBoards(store, run)
  return run
}
