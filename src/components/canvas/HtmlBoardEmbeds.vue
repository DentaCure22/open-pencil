<script setup lang="ts">
import { useEditorStore } from '@/app/editor/active-store'
import {
  forwardEmbeddedSurfaceWheel,
  isEmbeddedSurfaceWheelMessage
} from '@/app/editor/canvas/embedded-surface-wheel'
import { resolveExperienceFamily } from '@/app/experience-family'
import {
  FIELD_RUN_HANDOFF_EVENT,
  getPreparedFieldRun,
  prepareFieldRunForStore,
  readPreparedFieldRuns,
  recordFieldRunAttemptEndedForStore,
  recordFieldRunAttemptStartedForStore,
  type PreparedFieldRun
} from '@/app/field-sessions'
import { htmlBoardRegisteredLiveComponentByRoute } from '@/app/html-board/components'
import {
  HTML_BOARD_BRIDGE_KIND,
  htmlBoardDocument,
  htmlBoardElementSelection,
  htmlBoardSrcdoc,
  isHtmlBoardFrame
} from '@/app/html-board/workspace'
import type { HtmlBoardMode } from '@/app/html-board/workspace'
import {
  HUMAN_SESSION_STATE_EVENT,
  abortObservedHumanSession,
  issueObservedHumanSessionProof,
  observedHumanSessionState,
  recordObservedTaskInteraction,
  startObservedHumanSession
} from '@/app/human-sessions'
import type { ObservedHumanSessionProof, ObservedHumanSessionState } from '@/app/human-sessions'
import {
  applyInteractiveSurfaceEvent,
  interactiveSurfaceKind,
  interactiveSurfaceStateForBoard,
  resolveInteractiveSurfacePresentation
} from '@/app/interactive-surface'
import {
  createPendingObservedReviewAttempt,
  humanLearningReviewDigest,
  recordHumanLearningReview,
  retainObservedReviewProof,
  retryPendingObservedReviewAttempt,
  resolveLearningReviewContext,
  verifiedCompositionFieldGateForStore
} from '@/app/learning-receipts'
import type {
  PendingObservedReviewAttempt,
  RecordHumanLearningReviewRequest,
  ResolvedLearningReviewContext
} from '@/app/learning-receipts'
import type { ComposedExperienceFieldGateEvaluation } from '@/app/proving-gates'
import { useActionToast } from '@/app/shell/toast/action'
import { smylrFrameBaseUrlFor } from '@/app/smylr-live-inspector/frame-origin'
import {
  liveFrameCanvasStyle,
  liveFrameHeaderStyle,
  liveFrameScreenOverlayStyle
} from '@/app/smylr-production/frame-transform'
import {
  cloneWorkspaceData,
  getKnowledgeWorkspace,
  type ExperienceProjectionPurpose,
  type KnowledgeWorkspace,
  type ResolvedExperienceFamilyV1
} from '@/app/workspace'
import { baseScope, experienceProjectionForStore } from '@/app/workspace-ui/helpers'
import { workspaceDocumentId } from '@/app/workspace-ui/persistence'
import { workspacePluginValue } from '@/app/workspace-ui/projection'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  FieldSessionPreparationSubmission,
  FieldSessionLaunchSubmission,
  FieldSessionLaunchSurface
} from '@/components/workspace/FieldSessionLaunchDialog.types'
import FieldSessionLaunchDialog from '@/components/workspace/FieldSessionLaunchDialog.vue'
import type {
  HumanLearningReviewSubmission,
  HumanLearningCompositionSummary,
  HumanLearningSurfaceSummary
} from '@/components/workspace/HumanLearningReviewDialog.types'
import HumanLearningReviewDialog from '@/components/workspace/HumanLearningReviewDialog.vue'

import './smylr-live-frame-header.css'

const store = useEditorStore()
const { showActionToast } = useActionToast()
const modeByFrame = ref<Record<string, HtmlBoardMode>>({})
const syncTick = ref(0)
const learningReviewFrameId = ref<string | null>(null)
const learningReviewSubmitting = ref(false)
const fieldSessionLaunchFrameId = ref<string | null>(null)
const fieldSessionPreparing = ref(false)
const fieldSessionLaunchSubmitting = ref(false)
const humanSession = ref<ObservedHumanSessionState>(observedHumanSessionState())
const verifiedCompositionGate = ref<ComposedExperienceFieldGateEvaluation | null>(null)
let pendingObservedReviewAttempt: PendingObservedReviewAttempt | null = null
const closedFieldAttemptIds = new Set<string>()
const bridgePorts = new Map<string, MessagePort>()
const bridgeGenerationByFrame = new Map<string, number>()
const iframeElements = new Map<string, HTMLIFrameElement>()
const renderCacheByFrame = new Map<string, HtmlBoardRenderCacheEntry>()
const pendingSurfaceResults = new Map<string, unknown>()
const pendingTrustedInteractionByFrame = new Map<string, TrustedIframeInteraction>()
const trustedInteractionSequenceByFrame = new Map<
  string,
  { generation: number; sequence: number }
>()
const liveComponentsByFrame = ref<Record<string, HtmlBoardLiveComponentOverlay[]>>({})
let unsubscribe: Array<() => void> = []

type UnknownRecord = { [key: string]: unknown }
type BridgeTransport = 'port' | 'window'
type TrustedIframeInteraction = {
  generation: number
  kind: 'keydown' | 'pointerdown'
  occurredAt: string
  sequence: number
}
type HtmlBoardLiveComponentOverlay = {
  componentId: string
  rect: Rect
  route: string
}
type HtmlBoardRenderCacheEntry = {
  document: ReturnType<typeof htmlBoardDocument>
  height: number
  name: string
  pluginData: SceneNode['pluginData']
  srcdoc: string
  width: number
}

const FORM_LABELS = {
  'evidence-brief': 'Evidence brief',
  'flow-studio': 'Comparison',
  'interactive-program': 'Interactive tool',
  'record-explorer': 'Record explorer',
  'sequential-presentation': 'Presentation',
  'spatial-map': 'Spatial map',
  'weekly-decision': 'Decision',
  'workflow-state': 'Workflow state'
} as const

const EMPTY_LEARNING_SURFACE: HumanLearningSurfaceSummary = {
  decided: false,
  formLabel: 'Unknown',
  name: 'Unavailable surface',
  renderer: 'unavailable'
}

const boards = computed(() => {
  void syncTick.value
  void store.state.currentPageId
  void store.state.sceneVersion
  return store.graph
    .getChildren(store.state.currentPageId)
    .filter((node) => isHtmlBoardFrame(node) && node.visible)
})

function boardRenderCache(board: SceneNode): HtmlBoardRenderCacheEntry {
  const cached = renderCacheByFrame.get(board.id)
  if (
    cached &&
    cached.pluginData === board.pluginData &&
    cached.height === board.height &&
    cached.name === board.name &&
    cached.width === board.width
  ) {
    return cached
  }
  const entry = {
    document: htmlBoardDocument(board),
    height: board.height,
    name: board.name,
    pluginData: board.pluginData,
    srcdoc: htmlBoardSrcdoc(board),
    width: board.width
  }
  renderCacheByFrame.set(board.id, entry)
  return entry
}

function boardSrcdoc(board: SceneNode) {
  return boardRenderCache(board).srcdoc
}

const learningReviewContext = computed(() => {
  void syncTick.value
  const frameId = learningReviewFrameId.value
  if (!frameId) return null
  const board = boards.value.find((candidate) => candidate.id === frameId)
  return board ? learningContextForBoard(board) : null
})

const learningReviewSurface = computed<HumanLearningSurfaceSummary>(() => {
  const context = learningReviewContext.value
  if (!context) return EMPTY_LEARNING_SURFACE
  return {
    decided: context.surface.status === 'decided',
    formLabel: FORM_LABELS[context.surface.form.kind],
    name: context.surface.name,
    renderer: context.surface.rendererId
  }
})

const learningReviewComposition = computed<HumanLearningCompositionSummary[]>(() =>
  (learningReviewContext.value?.composition ?? []).map((item) => ({
    companionName: item.companion.name,
    companionRenderer: item.companion.rendererId,
    companionSurface: item.companionRef,
    primaryName: item.primary.name,
    primaryRenderer: item.primary.rendererId,
    primarySurface: item.primaryRef,
    relation: {
      relationId: item.relation.id,
      revision: item.relation.revision
    }
  }))
)

const learningReviewCompositionGate = computed(
  () => verifiedCompositionGate.value ?? learningReviewContext.value?.compositionGate
)

const learningReviewOpen = computed({
  get: () => learningReviewFrameId.value !== null,
  set: (open: boolean) => {
    if (!open && !learningReviewSubmitting.value) learningReviewFrameId.value = null
  }
})

const fieldSessionLaunchSurface = computed<FieldSessionLaunchSurface | null>(() => {
  void syncTick.value
  const frameId = fieldSessionLaunchFrameId.value
  if (!frameId) return null
  const board = boards.value.find((candidate) => candidate.id === frameId)
  if (!board) return null
  const state = interactiveSurfaceStateForBoard(store, board)
  if (!state) return null
  return {
    artifactId: state.surface.artifact.boardId,
    artifactRevision: state.surface.artifact.boardRevision,
    constraints: cloneWorkspaceData(state.intent.constraints),
    desiredOutcome: state.intent.desiredOutcome,
    evidenceCount: state.evidence.items.length,
    evidenceManifestId: state.surface.evidenceManifest.objectId,
    evidenceManifestRevision: state.surface.evidenceManifest.revision,
    evidenceStatus: state.evidence.status,
    familyMemberCount: state.surface.formChoice.composition?.surfaceCount ?? 1,
    formLabel: FORM_LABELS[state.surface.form.kind],
    formRationale: state.surface.form.rationale,
    intentId: state.surface.intent.objectId,
    intentRevision: state.surface.intent.revision,
    name: state.surface.name,
    surfaceRunId: state.surface.id,
    surfaceRevision: state.surface.revision,
    taskBrief: state.intent.statement
  }
})

const fieldSessionLaunchOpen = computed({
  get: () => fieldSessionLaunchFrameId.value !== null,
  set: (open: boolean) => {
    if (!open && !fieldSessionLaunchSubmitting.value) fieldSessionLaunchFrameId.value = null
  }
})

function preparedRunForBoard(board: SceneNode): PreparedFieldRun | null {
  const state = interactiveSurfaceStateForBoard(store, board)
  if (!state) return null
  return (
    readPreparedFieldRuns(store.graph)
      .toReversed()
      .find(
        (run) =>
          run.boardId === board.id &&
          run.target.surfaceRun.objectId === state.surface.id &&
          run.target.surfaceRun.revision === state.surface.revision &&
          run.target.artifact.boardRevision === state.surface.artifact.boardRevision
      ) ?? null
  )
}

const fieldSessionPreparedRunCode = computed(() => {
  const frameId = fieldSessionLaunchFrameId.value
  const board = frameId ? boards.value.find((candidate) => candidate.id === frameId) : undefined
  return board ? (preparedRunForBoard(board)?.runCode ?? null) : null
})

const learningReviewSession = computed<ObservedHumanSessionState>(() => {
  const context = learningReviewContext.value
  const session = humanSession.value
  return context && session.target?.surfaceRun.objectId === context.surface.id
    ? session
    : { interactionCount: 0, status: 'idle' }
})

onMounted(() => {
  const sync = () => {
    syncTick.value += 1
  }
  unsubscribe = [
    store.onEditorEvent('graph:replaced', sync),
    store.onEditorEvent('page:changed', sync),
    store.onEditorEvent('node:updated', sync)
  ]
})

onUnmounted(() => {
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  for (const port of bridgePorts.values()) port.close()
  bridgePorts.clear()
  bridgeGenerationByFrame.clear()
  iframeElements.clear()
  renderCacheByFrame.clear()
  pendingSurfaceResults.clear()
  pendingTrustedInteractionByFrame.clear()
  trustedInteractionSequenceByFrame.clear()
})

useEventListener(window, HUMAN_SESSION_STATE_EVENT, (event) => {
  const state = (event as CustomEvent<ObservedHumanSessionState>).detail
  humanSession.value = state
  if (state.status === 'aborted' || state.status === 'expired') {
    void closePreparedFieldAttempt(state)
  }
})

useEventListener(window, FIELD_RUN_HANDOFF_EVENT, (event) => {
  const runCode = (event as CustomEvent<{ runCode?: unknown }>).detail?.runCode
  if (typeof runCode !== 'string') return
  void nextTick(() => {
    const run = getPreparedFieldRun(store.graph, runCode)
    const board = run ? boards.value.find((candidate) => candidate.id === run.boardId) : undefined
    if (!run || !board || !canStartObservedSession(board)) {
      showActionToast('The prepared field surface is no longer eligible to start')
      return
    }
    fieldSessionLaunchFrameId.value = board.id
  })
})

watch(boards, (nextBoards) => {
  const boardIds = new Set(nextBoards.map((candidate) => candidate.id))
  modeByFrame.value = Object.fromEntries(
    Object.entries(modeByFrame.value).filter(([frameId]) => boardIds.has(frameId))
  )
  liveComponentsByFrame.value = Object.fromEntries(
    Object.entries(liveComponentsByFrame.value).filter(([frameId]) => boardIds.has(frameId))
  )
  for (const frameId of iframeElements.keys()) {
    if (!boardIds.has(frameId)) {
      bridgeGenerationByFrame.delete(frameId)
      iframeElements.delete(frameId)
      pendingSurfaceResults.delete(frameId)
      pendingTrustedInteractionByFrame.delete(frameId)
      trustedInteractionSequenceByFrame.delete(frameId)
      renderCacheByFrame.delete(frameId)
    }
  }
  for (const [frameId, port] of bridgePorts) {
    if (!boardIds.has(frameId)) {
      port.close()
      bridgePorts.delete(frameId)
    }
  }
  if (htmlBoardElementSelection.value && !boardIds.has(htmlBoardElementSelection.value.boardId)) {
    htmlBoardElementSelection.value = null
  }
  if (learningReviewFrameId.value && !boardIds.has(learningReviewFrameId.value)) {
    learningReviewFrameId.value = null
  }
  if (fieldSessionLaunchFrameId.value && !boardIds.has(fieldSessionLaunchFrameId.value)) {
    fieldSessionLaunchFrameId.value = null
  }
  void nextTick(() => {
    for (const board of nextBoards) syncMode(board.id)
  })
})

function modeFor(frameId: string): HtmlBoardMode {
  return modeByFrame.value[frameId] ?? 'design'
}

function learningContextForBoard(board: SceneNode): ResolvedLearningReviewContext | null {
  const state = interactiveSurfaceStateForBoard(store, board)
  if (!state?.receipt) return null
  try {
    return resolveLearningReviewContext(store, {
      decisionReceiptId: state.receipt.id,
      surfaceRunId: state.surface.id
    })
  } catch {
    return null
  }
}

function hasHumanLearningReview(board: SceneNode): boolean {
  return Boolean(
    learningContextForBoard(board)?.existing.receipts.some(
      (receipt) => receipt.executionKind === 'human'
    )
  )
}

function canRecordHumanLearningReview(board: SceneNode): boolean {
  const context = learningContextForBoard(board)
  return Boolean(
    context && !context.existing.receipts.some((receipt) => receipt.executionKind === 'human')
  )
}

async function openHumanLearningReview(board: SceneNode) {
  if (!canRecordHumanLearningReview(board)) return
  pendingObservedReviewAttempt = null
  verifiedCompositionGate.value = null
  learningReviewFrameId.value = board.id
  try {
    const verified = await verifiedCompositionFieldGateForStore(store)
    if (learningReviewFrameId.value === board.id) verifiedCompositionGate.value = verified
  } catch (error) {
    console.warn('Verified composition gate could not refresh', error)
  }
}

function supportsObservedSession(
  state: NonNullable<ReturnType<typeof interactiveSurfaceStateForBoard>>
) {
  return (
    state.surface.status === 'in-review' &&
    !state.receipt &&
    !state.surface.capabilities.externalWrites &&
    !state.surface.capabilities.networkAccess &&
    !state.surface.capabilities.sourceWrites
  )
}

type InteractiveSurfaceState = NonNullable<ReturnType<typeof interactiveSurfaceStateForBoard>>
type FieldRunFamilyMember = {
  artifact: InteractiveSurfaceState['surface']['artifact']
  surfaceRun: { objectId: string; revision: number }
}
type ResolvedFieldRunFamily = {
  family?: ResolvedExperienceFamilyV1
  members: FieldRunFamilyMember[]
  primary: FieldRunFamilyMember
}

function resolveFieldRunFamily(
  state: InteractiveSurfaceState,
  workspace: KnowledgeWorkspace
): ResolvedFieldRunFamily {
  const family = state.surface.formChoice.composition
    ? resolveExperienceFamily(
        workspace,
        { objectId: state.surface.id, revision: state.surface.revision },
        { graph: store.graph, requireMaterializedBoards: true }
      )
    : undefined
  const fallback = {
    artifact: state.surface.artifact,
    surfaceRun: {
      objectId: state.surface.id,
      revision: state.surface.revision
    }
  }
  return {
    family,
    members: family?.members ?? [fallback],
    primary: family?.primary ?? fallback
  }
}

function familyMatchesProjection(
  resolved: ResolvedFieldRunFamily,
  projection: NonNullable<ReturnType<typeof experienceProjectionForStore>>,
  purpose: ExperienceProjectionPurpose
): boolean {
  return resolved.members.every((familyMember) =>
    projection.resolved.members[purpose].some(
      (member) =>
        member.objectId === familyMember.surfaceRun.objectId &&
        member.revision === familyMember.surfaceRun.revision
    )
  )
}

function familyMembersEligible(
  resolved: ResolvedFieldRunFamily,
  workspace: KnowledgeWorkspace
): boolean {
  return resolved.members.every((familyMember) => {
    if (!Object.hasOwn(workspace.objects, familyMember.surfaceRun.objectId)) return false
    const member = workspace.objects[familyMember.surfaceRun.objectId]
    if (member.type !== 'surface-run') return false
    const capabilities: Record<string, unknown> = member.capabilities
    return Boolean(
      member.revision === familyMember.surfaceRun.revision &&
      member.status === 'in-review' &&
      capabilities.externalWrites === false &&
      capabilities.networkAccess === false &&
      capabilities.sourceWrites === false
    )
  })
}

function preparedRunMatchesSurface(
  prepared: PreparedFieldRun | null,
  board: SceneNode,
  state: InteractiveSurfaceState
): prepared is PreparedFieldRun {
  return Boolean(
    prepared &&
    prepared.boardId === board.id &&
    prepared.target.surfaceRun.objectId === state.surface.id &&
    prepared.target.surfaceRun.revision === state.surface.revision &&
    prepared.target.artifact.boardRevision === state.surface.artifact.boardRevision
  )
}

function preparedFamilyIsCurrent(prepared: PreparedFieldRun): boolean {
  if (prepared.version === 1) return true
  const workspace = getKnowledgeWorkspace(workspaceDocumentId(store.graph), prepared.targetPageId)
  if (!workspace) return false
  try {
    const currentFamily = resolveExperienceFamily(workspace, prepared.rootSurface, {
      graph: store.graph,
      requireMaterializedBoards: true
    })
    return JSON.stringify(currentFamily) === JSON.stringify(prepared.scope.family)
  } catch {
    return false
  }
}

function canStartObservedSession(board: SceneNode): boolean {
  const status = humanSession.value.status
  const state = interactiveSurfaceStateForBoard(store, board)
  return Boolean(
    state &&
    supportsObservedSession(state) &&
    (!state.surface.formChoice.composition ||
      state.surface.formChoice.composition.role === 'primary') &&
    ['aborted', 'consumed', 'expired', 'idle'].includes(status)
  )
}

function sessionTargetsBoard(board: SceneNode): boolean {
  const target = humanSession.value.target
  if (!target) return false
  const state = interactiveSurfaceStateForBoard(store, board)
  if (!state) return false
  if (humanSession.value.scope?.kind === 'experience-family') {
    return humanSession.value.scope.family.members.some(
      (member) =>
        member.artifact.boardId === board.id && member.surfaceRun.objectId === state.surface.id
    )
  }
  return target.artifact.boardId === board.id && target.surfaceRun.objectId === state.surface.id
}

function openFieldSessionLaunch(board: SceneNode): void {
  if (!canStartObservedSession(board)) return
  fieldSessionLaunchFrameId.value = board.id
}

function fieldPreparationContext() {
  const frameId = fieldSessionLaunchFrameId.value
  const board = frameId ? boards.value.find((candidate) => candidate.id === frameId) : undefined
  const state = board ? interactiveSurfaceStateForBoard(store, board) : null
  const projection = experienceProjectionForStore(store)
  const currentPage = store.graph.getNode(store.state.currentPageId)
  if (!board || !state || !projection || currentPage?.type !== 'CANVAS') {
    throw new Error('The exact field surface and projection are no longer available')
  }
  if (!supportsObservedSession(state)) {
    throw new Error('Field handoff requires an undecided, read-only, isolated surface')
  }
  const purpose = projection.activePurpose
  const viewId = workspacePluginValue(currentPage, 'viewId') ?? projection.viewIds[purpose]
  const basePageId = baseScope(store).basePageId
  const workspace = getKnowledgeWorkspace(workspaceDocumentId(store.graph), basePageId)
  if (!viewId || !workspace) {
    throw new Error('The active presentation is no longer connected to its workspace')
  }
  const resolved = resolveFieldRunFamily(state, workspace)
  if (
    !familyMatchesProjection(resolved, projection, purpose) ||
    !familyMembersEligible(resolved, workspace)
  ) {
    throw new Error('The full exact family must be present and eligible in this presentation')
  }
  return { basePageId, currentPage, purpose, resolved, state, viewId }
}

async function prepareHumanSession(submission: FieldSessionPreparationSubmission): Promise<void> {
  let context: ReturnType<typeof fieldPreparationContext>
  try {
    context = fieldPreparationContext()
  } catch (error) {
    showActionToast(error instanceof Error ? error.message : 'The exact family is unavailable')
    return
  }
  const { basePageId, currentPage, purpose, resolved, state, viewId } = context
  const { family, primary } = resolved
  fieldSessionPreparing.value = true
  try {
    const result = await prepareFieldRunForStore(store, {
      boardId: primary.artifact.boardId,
      projectionPageId: currentPage.id,
      projectionViewId: viewId,
      purpose,
      rootSurface: primary.surfaceRun,
      runCode: submission.runCode,
      scope: family
        ? {
            family,
            kind: 'experience-family' as const,
            schemaVersion: 1 as const
          }
        : undefined,
      target: {
        artifact: cloneWorkspaceData(primary.artifact),
        evidenceManifest: cloneWorkspaceData(
          family?.evidenceManifest ?? state.surface.evidenceManifest
        ),
        intent: cloneWorkspaceData(family?.intent ?? state.surface.intent),
        surfaceRun: cloneWorkspaceData(primary.surfaceRun)
      },
      targetPageId: basePageId
    })
    syncTick.value += 1
    showActionToast(
      result.created
        ? `Prepared ${result.run.runCode} · hand the browser to the participant`
        : `${result.run.runCode} is already prepared for this exact experience`
    )
  } catch (error) {
    showActionToast(error instanceof Error ? error.message : 'Field handoff could not be prepared')
  } finally {
    fieldSessionPreparing.value = false
  }
}

function canAbortObservedSession(board: SceneNode): boolean {
  return (
    sessionTargetsBoard(board) && ['active', 'issued', 'ready'].includes(humanSession.value.status)
  )
}

async function closePreparedFieldAttempt(state: ObservedHumanSessionState): Promise<void> {
  if (
    !state.sessionId ||
    !state.fieldSessionId?.startsWith('field-session_') ||
    !['aborted', 'expired'].includes(state.status) ||
    closedFieldAttemptIds.has(state.sessionId)
  ) {
    return
  }
  closedFieldAttemptIds.add(state.sessionId)
  try {
    await recordFieldRunAttemptEndedForStore(store, {
      endedAt: new Date().toISOString(),
      result: state.status as 'aborted' | 'expired',
      runCode: state.fieldSessionId.slice('field-session_'.length),
      sessionId: state.sessionId
    })
    syncTick.value += 1
  } catch (error) {
    closedFieldAttemptIds.delete(state.sessionId)
    showActionToast(
      error instanceof Error ? error.message : 'Field-run ending could not be preserved'
    )
  }
}

async function abortHumanSession(): Promise<void> {
  try {
    humanSession.value = abortObservedHumanSession()
    await closePreparedFieldAttempt(humanSession.value)
    pendingObservedReviewAttempt = null
    showActionToast('Observed field session aborted · no verified proof was retained')
  } catch (error) {
    showActionToast(error instanceof Error ? error.message : 'Observed session could not abort')
  }
}

async function startHumanSession(submission: FieldSessionLaunchSubmission): Promise<void> {
  const frameId = fieldSessionLaunchFrameId.value
  const board = frameId ? boards.value.find((candidate) => candidate.id === frameId) : undefined
  const state = board ? interactiveSurfaceStateForBoard(store, board) : null
  if (!board || !state) {
    showActionToast('The exact field surface is no longer available')
    return
  }
  if (!supportsObservedSession(state)) {
    showActionToast('Observed field sessions require an undecided, read-only, isolated surface')
    return
  }
  const prepared = getPreparedFieldRun(store.graph, submission.runCode)
  if (!preparedRunMatchesSurface(prepared, board, state)) {
    showActionToast('Prepare this exact run before the participant starts')
    return
  }
  if (!preparedFamilyIsCurrent(prepared)) {
    showActionToast('The prepared family changed; prepare a new exact handoff')
    return
  }
  fieldSessionLaunchSubmitting.value = true
  try {
    humanSession.value = await startObservedHumanSession({
      actorId: submission.participantAlias,
      dataPolicy: 'phi-free-declared-v1',
      fieldSessionId: `field-session_${submission.runCode}`,
      scope: prepared.version === 2 ? cloneWorkspaceData(prepared.scope) : undefined,
      target: cloneWorkspaceData(prepared.target)
    })
    if (!humanSession.value.sessionId || !humanSession.value.startedAt) {
      throw new Error('Observed session did not return an exact attempt identity')
    }
    try {
      await recordFieldRunAttemptStartedForStore(store, {
        runCode: prepared.runCode,
        sessionId: humanSession.value.sessionId,
        startedAt: humanSession.value.startedAt
      })
    } catch (error) {
      humanSession.value = abortObservedHumanSession()
      throw error
    }
    fieldSessionLaunchFrameId.value = null
    setMode(board.id, 'interact')
    showActionToast('Bound field session started · complete the task, then review the outcome')
  } catch (error) {
    showActionToast(error instanceof Error ? error.message : 'Observed session could not start')
  } finally {
    fieldSessionLaunchSubmitting.value = false
  }
}

function coherentLearningOutcome(review: HumanLearningReviewSubmission): boolean {
  return review.jobCompleted ? review.outcome === 'passed' : review.outcome !== 'passed'
}

function reviewerFor(
  context: ResolvedLearningReviewContext,
  sessionState: ObservedHumanSessionState,
  exactSession: boolean
): string {
  if (pendingObservedReviewAttempt) return pendingObservedReviewAttempt.request.recordedBy
  if (exactSession) return sessionState.actorId ?? 'field-participant'
  return context.decision.outcome.actorId ?? 'local-human-reviewer'
}

function candidateLearningRequest(
  context: ResolvedLearningReviewContext,
  review: HumanLearningReviewSubmission,
  recordedAt: string,
  recordedBy: string
): RecordHumanLearningReviewRequest {
  return {
    comparisonBaseline: review.comparisonBaseline,
    comparisonOutcome: review.comparison,
    compositionEvaluations: review.compositionEvaluations,
    decisionReceiptId: context.decision.id,
    durableOutcome: review.jobCompleted && review.outcome === 'passed',
    evidenceTraceable: review.evidenceTraceable,
    expectedWorkspaceRevision: context.workspaceRevision,
    formDisposition: review.formDisposition,
    intentCompleted: review.jobCompleted,
    keyboardAccepted: review.keyboardAccepted,
    occurredAt: context.decision.outcome.decidedAt,
    outcome: review.outcome,
    qualitativeFeedback: {
      frictions: [],
      strengths: [],
      suggestedChanges: [],
      summary: review.feedback
    },
    recordedAt,
    recordedBy,
    repairCount: review.repairCount,
    runId: review.idempotencyKey,
    safetyViolation: review.safetyProblem,
    surfaceRunId: context.surface.id,
    visualAccepted: review.visualAccepted
  }
}

async function retainProofForExactSession(
  attempt: PendingObservedReviewAttempt,
  context: ResolvedLearningReviewContext,
  sessionState: ObservedHumanSessionState,
  exactSession: boolean
): Promise<PendingObservedReviewAttempt> {
  if (
    attempt.proof ||
    !exactSession ||
    !['active', 'issued', 'ready'].includes(sessionState.status)
  ) {
    return attempt
  }
  const request = attempt.request
  const proof: ObservedHumanSessionProof = await issueObservedHumanSessionProof({
    actorId: request.recordedBy,
    decisionReceiptId: context.decision.id,
    occurredAt: context.decision.outcome.decidedAt,
    recordedAt: request.recordedAt,
    reviewDigest: await humanLearningReviewDigest(request),
    runId: request.runId,
    surfaceRunId: context.surface.id,
    finalFamilyDigest: context.experienceFamily?.familyDigest
  })
  return retainObservedReviewProof(attempt, proof)
}

function learningRecordedMessage(
  resolution: 'created' | 'existing' | 'replayed',
  verified: boolean
): string {
  if (resolution === 'existing') return 'Learning already recorded'
  return verified ? 'Verified human learning recorded' : 'Self-reported learning recorded'
}

async function handleHumanLearningReview(review: HumanLearningReviewSubmission) {
  const context = learningReviewContext.value
  if (!context) {
    showActionToast('The exact approved surface is no longer available')
    return
  }
  if (!coherentLearningOutcome(review)) {
    showActionToast('Match the run outcome to whether the job completed')
    return
  }

  learningReviewSubmitting.value = true
  try {
    const recordedAt = pendingObservedReviewAttempt?.request.recordedAt ?? new Date().toISOString()
    const sessionState = observedHumanSessionState()
    const exactSession = sessionState.target?.surfaceRun.objectId === context.surface.id
    const recordedBy = reviewerFor(context, sessionState, exactSession)
    const candidateRequest = candidateLearningRequest(context, review, recordedAt, recordedBy)
    let attempt = pendingObservedReviewAttempt
      ? retryPendingObservedReviewAttempt(pendingObservedReviewAttempt, candidateRequest)
      : createPendingObservedReviewAttempt(candidateRequest)
    pendingObservedReviewAttempt = attempt
    attempt = await retainProofForExactSession(attempt, context, sessionState, exactSession)
    pendingObservedReviewAttempt = attempt
    const result = await recordHumanLearningReview(store, {
      ...attempt.request,
      sessionProof: attempt.proof
    })
    if (result.resolution === 'existing' && attempt.proof) {
      humanSession.value = abortObservedHumanSession()
    }
    pendingObservedReviewAttempt = null
    syncTick.value += 1
    learningReviewFrameId.value = null
    const verified = result.receipt.attestation.kind === 'observed-session'
    showActionToast(learningRecordedMessage(result.resolution, verified))
  } catch (error) {
    showActionToast(error instanceof Error ? error.message : 'Learning could not be recorded')
  } finally {
    learningReviewSubmitting.value = false
  }
}

function sandboxFor(board: SceneNode) {
  return interactiveSurfaceKind(board)
    ? 'allow-scripts'
    : 'allow-forms allow-modals allow-popups allow-scripts'
}

function setMode(frameId: string, mode: HtmlBoardMode) {
  modeByFrame.value = { ...modeByFrame.value, [frameId]: mode }
  if (mode !== 'interact') pendingTrustedInteractionByFrame.delete(frameId)
  store.select([frameId])
  if (mode !== 'inspect' && htmlBoardElementSelection.value?.boardId === frameId) {
    htmlBoardElementSelection.value = null
  }
  syncMode(frameId)
}

function setIframeElement(value: unknown) {
  if (value instanceof HTMLIFrameElement) {
    const frameId = value.dataset.htmlBoardId
    if (frameId) iframeElements.set(frameId, value)
  }
}

function sendBridgeMessage(frameId: string, message: UnknownRecord) {
  const payload = { ...message, kind: HTML_BOARD_BRIDGE_KIND }
  const port = bridgePorts.get(frameId)
  if (port) {
    port.postMessage(payload)
    return
  }
  iframeElements.get(frameId)?.contentWindow?.postMessage(payload, '*')
}

function syncSurfacePresentation(frameId: string) {
  const board = boards.value.find((candidate) => candidate.id === frameId)
  if (!board) return
  const surfaceState = interactiveSurfaceStateForBoard(store, board)
  const projection = experienceProjectionForStore(store)
  if (!surfaceState || !projection) return
  const member = projection.resolved.members[projection.activePurpose].find(
    (candidate) => candidate.objectId === surfaceState.surface.id
  )
  if (member?.role !== 'root-surface' && member?.role !== 'companion-surface') return
  const presentation = resolveInteractiveSurfacePresentation(surfaceState.surface, {
    comparisonBasis: projection.comparison.basis,
    purpose: projection.activePurpose,
    role: member.role
  })
  if (presentation.status !== 'resolved' || !presentation.rendererViewId) return
  sendBridgeMessage(frameId, {
    action: 'set-surface-view',
    purpose: presentation.purpose,
    rendererViewId: presentation.rendererViewId,
    role: presentation.role,
    surfaceRunId: presentation.surfaceRunId
  })
}

function syncMode(frameId: string) {
  sendBridgeMessage(frameId, { action: 'set-mode', mode: modeFor(frameId) })
  syncSurfacePresentation(frameId)
  const board = boards.value.find((candidate) => candidate.id === frameId)
  if (board) sendInteractiveSurfaceState(frameId, board)
  const selection = htmlBoardElementSelection.value
  if (selection?.boardId === frameId && modeFor(frameId) === 'inspect') {
    sendBridgeMessage(frameId, {
      action: 'set-selection',
      selector: selection.selector
    })
  }
}

function handleIframeLoad(frameId: string, event: Event) {
  if (!(event.currentTarget instanceof HTMLIFrameElement)) return
  const iframe = event.currentTarget
  iframeElements.set(frameId, iframe)
  const generation = (bridgeGenerationByFrame.get(frameId) ?? 0) + 1
  bridgeGenerationByFrame.set(frameId, generation)
  pendingTrustedInteractionByFrame.delete(frameId)
  trustedInteractionSequenceByFrame.delete(frameId)
  bridgePorts.get(frameId)?.close()
  const channel = new MessageChannel()
  bridgePorts.set(frameId, channel.port1)
  channel.port1.onmessage = (portEvent) =>
    routeBridgePayload(frameId, generation, portEvent.data, 'port')
  channel.port1.start()
  iframe.contentWindow?.postMessage({ action: 'connect', kind: HTML_BOARD_BRIDGE_KIND }, '*', [
    channel.port2
  ])
}

function textValue(value: unknown, maxLength = 180): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function liveComponentSrc(route: string) {
  if (!htmlBoardRegisteredLiveComponentByRoute(route)?.live) return ''
  return new URL(route, smylrFrameBaseUrlFor(window.location.href)).href
}

function liveComponentStyle(component: HtmlBoardLiveComponentOverlay, frameId: string) {
  const profile = htmlBoardRegisteredLiveComponentByRoute(component.route)?.live
  const height =
    modeFor(frameId) === 'interact'
      ? Math.max(component.rect.height, profile?.interactionHeight ?? 0)
      : component.rect.height
  return {
    height: `${height}px`,
    left: `${component.rect.x}px`,
    top: `${component.rect.y}px`,
    width: `${component.rect.width}px`
  }
}

function sendInteractiveSurfaceState(frameId: string, board: SceneNode) {
  const state = interactiveSurfaceStateForBoard(store, board)
  if (state) sendBridgeMessage(frameId, { action: 'surface-state', payload: state })
}

function acceptTrustedInteraction(
  frameId: string,
  generation: number,
  payload: unknown,
  transport: BridgeTransport
): void {
  if (
    transport !== 'port' ||
    generation !== bridgeGenerationByFrame.get(frameId) ||
    modeFor(frameId) !== 'interact' ||
    !isUnknownRecord(payload)
  ) {
    return
  }
  const kind = payload.kind
  const sequence = payload.sequence
  const occurredAt = textValue(payload.occurredAt, 40)
  const occurredAtMs = Date.parse(occurredAt)
  if (
    (kind !== 'pointerdown' && kind !== 'keydown') ||
    typeof sequence !== 'number' ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !Number.isFinite(occurredAtMs) ||
    Math.abs(Date.now() - occurredAtMs) > 10_000
  ) {
    return
  }
  const last = trustedInteractionSequenceByFrame.get(frameId)
  if (last?.generation === generation && sequence <= last.sequence) return
  trustedInteractionSequenceByFrame.set(frameId, { generation, sequence })
  pendingTrustedInteractionByFrame.set(frameId, {
    generation,
    kind,
    occurredAt,
    sequence
  })
}

async function handleInteractiveSurfaceEvent(frameId: string, board: SceneNode, payload: unknown) {
  if (modeFor(frameId) !== 'interact') {
    sendBridgeMessage(frameId, {
      action: 'surface-event-result',
      payload: {
        error: 'Interactive surface changes require Interact mode',
        eventId: isUnknownRecord(payload) ? textValue(payload.eventId, 120) : 'invalid-event',
        status: 'rejected'
      }
    })
    return
  }
  const generation = bridgeGenerationByFrame.get(frameId) ?? 0
  const pendingTrustedInteraction = pendingTrustedInteractionByFrame.get(frameId)
  pendingTrustedInteractionByFrame.delete(frameId)
  const trustedInteraction =
    pendingTrustedInteraction &&
    Math.abs(Date.now() - Date.parse(pendingTrustedInteraction.occurredAt)) <= 10_000
      ? pendingTrustedInteraction
      : undefined
  const before = interactiveSurfaceStateForBoard(store, board)
  const result = await applyInteractiveSurfaceEvent(store, board, payload)
  if (
    result.status === 'applied' &&
    result.state &&
    bridgeGenerationByFrame.get(frameId) === generation
  ) {
    pendingSurfaceResults.set(frameId, result)
  }
  if (
    result.status === 'applied' &&
    result.state &&
    before &&
    trustedInteraction?.generation === generation &&
    bridgeGenerationByFrame.get(frameId) === generation &&
    before.surface.id === result.state.surface.id
  ) {
    try {
      recordObservedTaskInteraction({
        after: {
          artifactRevision: result.state.artifactRevision,
          surfaceRevision: result.state.surface.revision
        },
        before: {
          artifactRevision: before.artifactRevision,
          surfaceRevision: before.surface.revision
        },
        eventId: result.eventId,
        frameId,
        kind: trustedInteraction.kind,
        occurredAt: trustedInteraction.occurredAt,
        surfaceRunId: result.state.surface.id
      })
    } catch (error) {
      console.warn('Observed task interaction could not be recorded', error)
    }
  }
  sendBridgeMessage(frameId, {
    action: 'surface-event-result',
    payload: result
  })
  if (result.state)
    sendBridgeMessage(frameId, {
      action: 'surface-state',
      payload: result.state
    })
}

function handleBridgePayload(
  frameId: string,
  generation: number,
  data: unknown,
  transport: BridgeTransport
) {
  if (!isUnknownRecord(data)) return
  const message = data
  if (!message || message.kind !== HTML_BOARD_BRIDGE_KIND) return
  const board = boards.value.find((candidate) => candidate.id === frameId)
  if (!board) return
  if (message.action === 'trusted-interaction') {
    acceptTrustedInteraction(frameId, generation, message.payload, transport)
    return
  }
  if (message.action === 'ready') {
    syncMode(frameId)
    const pendingResult = pendingSurfaceResults.get(frameId)
    if (pendingResult) {
      sendBridgeMessage(frameId, {
        action: 'surface-event-result',
        payload: pendingResult
      })
      pendingSurfaceResults.delete(frameId)
    }
    sendInteractiveSurfaceState(frameId, board)
    return
  }
  if (message.action === 'surface-event' && interactiveSurfaceKind(board)) {
    void handleInteractiveSurfaceEvent(frameId, board, message.payload)
    return
  }
  if (message.action === 'live-components') {
    if (!Array.isArray(message.payload)) return
    const components = message.payload.slice(0, 12).flatMap((value) => {
      if (!isUnknownRecord(value) || !isUnknownRecord(value.rect)) return []
      const componentId = textValue(value.componentId, 100)
      const route = textValue(value.route, 160)
      const rect = {
        height: numberValue(value.rect.height),
        width: numberValue(value.rect.width),
        x: numberValue(value.rect.x),
        y: numberValue(value.rect.y)
      }
      if (
        !componentId ||
        !htmlBoardRegisteredLiveComponentByRoute(route)?.live ||
        rect.height <= 0 ||
        rect.width <= 0
      ) {
        return []
      }
      return [{ componentId, rect, route }]
    })
    liveComponentsByFrame.value = {
      ...liveComponentsByFrame.value,
      [frameId]: components
    }
    return
  }
  if (message.action !== 'selection' || modeFor(board.id) !== 'inspect') return
  if (!isUnknownRecord(message.payload)) return

  const payload = message.payload
  const sourceRect = isUnknownRecord(payload.rect) ? payload.rect : {}
  const sourceStyles = isUnknownRecord(payload.styles) ? payload.styles : {}
  const sourceComponentProps = isUnknownRecord(payload.componentProps) ? payload.componentProps : {}
  const sourceComponentControls = isUnknownRecord(payload.componentControls)
    ? payload.componentControls
    : {}
  const styles = Object.fromEntries(
    Object.entries(sourceStyles)
      .slice(0, 24)
      .map(([key, value]) => [key.slice(0, 40), textValue(value, 160)])
  )
  const componentProps = Object.fromEntries(
    Object.entries(sourceComponentProps)
      .slice(0, 16)
      .map(([key, value]) => [key.slice(0, 48), textValue(value, 160)])
  )
  const componentControls = Object.fromEntries(
    Object.entries(sourceComponentControls)
      .slice(0, 16)
      .flatMap(([key, value]) => {
        if (!isUnknownRecord(value)) return []
        const declaredType = textValue(value.type, 16)
        const type = ['boolean', 'select', 'text'].includes(declaredType)
          ? (declaredType as 'boolean' | 'select' | 'text')
          : 'text'
        const declaredBinding = textValue(value.binding, 80)
        const binding =
          declaredBinding === 'text' ||
          declaredBinding === 'metadata' ||
          /^attribute:(?:aria|data)-[a-z][\w-]*$/i.test(declaredBinding)
            ? declaredBinding
            : 'metadata'
        const options = Array.isArray(value.options)
          ? value.options
              .slice(0, 12)
              .map((option) => textValue(option, 80))
              .filter(Boolean)
          : []
        return [[key.slice(0, 48), { binding, options, type }]]
      })
  )
  const slotAccepts = Array.isArray(payload.slotAccepts)
    ? payload.slotAccepts
        .slice(0, 12)
        .map((value) => textValue(value, 80))
        .filter(Boolean)
    : []
  htmlBoardElementSelection.value = {
    boardId: board.id,
    className: textValue(payload.className),
    componentControls,
    componentId: textValue(payload.componentId, 80),
    componentName: textValue(payload.componentName, 80),
    componentProps,
    componentVariant: textValue(payload.componentVariant, 80),
    id: textValue(payload.id),
    rect: {
      height: numberValue(sourceRect.height),
      width: numberValue(sourceRect.width),
      x: numberValue(sourceRect.x),
      y: numberValue(sourceRect.y)
    },
    selector: textValue(payload.selector, 280),
    slotAccepts,
    slotChildCount: Math.max(0, Math.round(numberValue(payload.slotChildCount))),
    slotLabel: textValue(payload.slotLabel, 80),
    slotName: textValue(payload.slotName, 80),
    styles,
    tagName: textValue(payload.tagName, 40),
    text: textValue(payload.text)
  }
  store.select([board.id])
}

function routeBridgePayload(
  frameId: string,
  generation: number,
  data: unknown,
  transport: BridgeTransport
) {
  if (isEmbeddedSurfaceWheelMessage(data, HTML_BOARD_BRIDGE_KIND)) {
    const iframe = iframeElements.get(frameId)
    if (iframe) forwardEmbeddedSurfaceWheel(iframe, data)
    return
  }
  handleBridgePayload(frameId, generation, data, transport)
}

function handleBridgeMessage(event: MessageEvent) {
  if (!isUnknownRecord(event.data)) return
  const board = boards.value.find(
    (candidate) => iframeElements.get(candidate.id)?.contentWindow === event.source
  )
  if (board) {
    routeBridgePayload(board.id, bridgeGenerationByFrame.get(board.id) ?? 0, event.data, 'window')
  }
}

useEventListener(window, 'message', handleBridgeMessage)
</script>

<template>
  <template v-for="board in boards" :key="board.id">
    <div
      class="smylr-live-frame-header-container pointer-events-none absolute top-0 left-0 z-[8]"
      data-test-id="html-board-frame-header-container"
      :style="liveFrameScreenOverlayStyle(store, board)"
    >
      <div
        class="smylr-live-frame-header pointer-events-auto absolute left-1/2 z-[2] flex items-center gap-0.5 whitespace-nowrap rounded-md border border-border bg-panel px-1 py-0.5 text-surface shadow-sm transition-colors hover:bg-hover"
        data-test-id="html-board-frame-header"
        :style="liveFrameHeaderStyle(store.state.zoom)"
        role="toolbar"
        :aria-label="`${board.name} HTML board controls`"
        @pointerdown.stop
      >
        <span class="shrink-0 rounded bg-violet-500/15 px-1 text-[8px] font-medium text-violet-300"
          >HTML</span
        >
        <strong
          class="smylr-live-frame-header__title max-w-36 truncate px-1 text-[10px] font-medium"
          >{{ board.name }}</strong
        >
        <span
          v-if="hasHumanLearningReview(board)"
          data-test-id="html-board-learning-status"
          class="smylr-live-frame-header__optional flex items-center gap-1 rounded bg-emerald-400/15 px-1 text-[8px] font-medium text-emerald-200"
        >
          <icon-lucide-brain-circuit class="size-3" /> Learning recorded
        </span>
        <span
          v-if="!hasHumanLearningReview(board) && preparedRunForBoard(board)"
          data-test-id="html-board-field-run-prepared"
          class="smylr-live-frame-header__optional flex items-center gap-1 rounded bg-cyan-400/15 px-1 text-[8px] font-medium text-cyan-100"
        >
          {{ preparedRunForBoard(board)?.runCode }} prepared
        </span>
        <span
          v-if="
            !hasHumanLearningReview(board) &&
            sessionTargetsBoard(board) &&
            ['active', 'ready', 'issued'].includes(humanSession.status)
          "
          data-test-id="html-board-human-session-status"
          class="smylr-live-frame-header__optional flex items-center gap-1 rounded bg-blue-400/15 px-1 text-[8px] font-medium text-blue-100"
        >
          <icon-lucide-user-check class="size-3" />
          {{
            humanSession.status === 'ready'
              ? 'Session ready'
              : humanSession.status === 'issued'
                ? 'Proof issued'
                : 'Session active'
          }}
          ·
          {{ humanSession.interactionCount }} actions
          <template v-if="humanSession.familyMemberCount">
            · {{ humanSession.familyMembersUsed }}/{{ humanSession.familyMemberCount }}
            surfaces used
          </template>
        </span>
        <span
          v-if="
            !hasHumanLearningReview(board) &&
            sessionTargetsBoard(board) &&
            ['aborted', 'expired'].includes(humanSession.status)
          "
          data-test-id="html-board-human-session-terminal-status"
          class="smylr-live-frame-header__optional flex items-center gap-1 rounded bg-amber-400/15 px-1 text-[8px] font-medium text-amber-100"
        >
          {{ humanSession.status === 'expired' ? 'Session expired' : 'Session aborted' }}
          · no proof
        </span>
        <button
          v-if="canAbortObservedSession(board)"
          type="button"
          data-test-id="html-board-human-session-abort"
          class="smylr-live-frame-header__optional h-7 rounded bg-rose-400/15 px-1.5 text-[9px] font-medium text-rose-100 transition-colors hover:bg-rose-400/25"
          @click.stop="abortHumanSession"
        >
          Abort session
        </button>
        <button
          v-if="!hasHumanLearningReview(board) && canStartObservedSession(board)"
          type="button"
          data-test-id="html-board-human-session-start"
          class="smylr-live-frame-header__optional h-7 rounded bg-blue-400/15 px-1.5 text-[9px] font-medium text-blue-100 transition-colors hover:bg-blue-400/25"
          @click.stop="openFieldSessionLaunch(board)"
        >
          Start field session
        </button>
        <button
          v-if="canRecordHumanLearningReview(board)"
          type="button"
          data-test-id="html-board-learning-review"
          class="smylr-live-frame-header__optional h-7 rounded bg-violet-400/15 px-1.5 text-[9px] font-medium text-violet-100 transition-colors hover:bg-violet-400/25"
          @click.stop="openHumanLearningReview(board)"
        >
          Review outcome
        </button>
        <span
          class="smylr-live-frame-header__divider mx-0.5 h-3.5 w-px shrink-0 bg-border"
          aria-hidden="true"
        />
        <div class="flex shrink-0 items-center gap-0.5" role="group" aria-label="HTML board mode">
          <button
            v-for="mode in ['design', 'inspect', 'interact'] as const"
            :key="mode"
            type="button"
            class="h-7 rounded px-1.5 text-[9px] font-medium capitalize transition-colors focus-visible:ring-1 focus-visible:ring-violet-400 focus-visible:outline-none"
            :class="
              modeFor(board.id) === mode
                ? 'bg-hover text-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                : 'text-muted hover:bg-hover hover:text-surface'
            "
            :aria-pressed="modeFor(board.id) === mode"
            :data-test-id="`html-board-mode-${mode}`"
            @click.stop="setMode(board.id, mode)"
          >
            {{ mode }}
          </button>
        </div>
      </div>
    </div>
    <div
      data-test-id="html-board-embed"
      class="pointer-events-none absolute top-0 left-0 z-[7]"
      :style="liveFrameCanvasStyle(store, board)"
    >
      <div class="absolute inset-0 overflow-hidden rounded-xl bg-white shadow-lg">
        <iframe
          :key="`${board.id}:${modeFor(board.id) === 'inspect' ? 'inspect' : 'runtime'}`"
          :ref="setIframeElement"
          :class="modeFor(board.id) === 'design' ? 'pointer-events-none' : 'pointer-events-auto'"
          :name="`openpencil-${modeFor(board.id)}`"
          :srcdoc="boardSrcdoc(board)"
          :title="`${board.name} interactive design`"
          class="size-full border-0 bg-white"
          :data-html-board-id="board.id"
          data-test-id="html-board-frame"
          :sandbox="sandboxFor(board)"
          @load="handleIframeLoad(board.id, $event)"
        />
      </div>
      <iframe
        v-for="component in liveComponentsByFrame[board.id] ?? []"
        :key="`${board.id}:${component.componentId}:${component.route}`"
        :class="modeFor(board.id) === 'interact' ? 'pointer-events-auto' : 'pointer-events-none'"
        :data-html-board-live-component-id="component.componentId"
        :src="liveComponentSrc(component.route)"
        :style="liveComponentStyle(component, board.id)"
        :title="`${component.componentId} live production component`"
        class="absolute z-[6] border-0 bg-transparent"
        data-test-id="html-board-live-component"
        data-observed-task="non-qualifying-live-component"
        sandbox="allow-same-origin allow-scripts"
        @pointerdown.stop
      />
    </div>
  </template>
  <FieldSessionLaunchDialog
    v-if="fieldSessionLaunchSurface"
    v-model:open="fieldSessionLaunchOpen"
    :submitting="fieldSessionLaunchSubmitting"
    :preparing="fieldSessionPreparing"
    :prepared-run-code="fieldSessionPreparedRunCode"
    :surface="fieldSessionLaunchSurface"
    @prepare="prepareHumanSession"
    @start="startHumanSession"
  />
  <HumanLearningReviewDialog
    v-if="learningReviewContext"
    v-model:open="learningReviewOpen"
    :baseline="learningReviewContext.baseline"
    :composition="learningReviewComposition"
    :composition-gate="learningReviewCompositionGate ?? learningReviewContext.compositionGate"
    :submitting="learningReviewSubmitting"
    :surface="learningReviewSurface"
    :session="learningReviewSession"
    @submit="handleHumanLearningReview"
  />
</template>
