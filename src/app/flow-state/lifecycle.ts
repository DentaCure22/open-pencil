import {
  WORK_LIFECYCLE_ACTIONS,
  WORK_LIFECYCLE_STATUSES,
  type TransitionWorkLifecycleInput,
  type WorkLifecycleAction,
  type WorkLifecycleActorKind,
  type WorkLifecycleState,
  type WorkLifecycleStatus,
  type WorkLifecycleTransitionReceipt,
  type WorkLifecycleTransitionResult,
  type WorkLifecycleVerificationEvidence
} from './types'

const ACTION_LABELS: Record<WorkLifecycleAction, string> = {
  approve: 'Approve change set',
  archive: 'Move to history',
  'create-change-set': 'Create change set',
  'mark-preferred': 'Mark preferred',
  'request-changes': 'Request changes',
  'request-review': 'Send to review',
  'start-branch': 'Start isolated branch',
  'start-draft': 'Start draft',
  'start-implementation': 'Start implementation',
  verify: 'Verify in real app'
}

const STATUS_LABELS: Record<WorkLifecycleStatus, string> = {
  approved: 'Approved',
  'change-set': 'Change set',
  draft: 'Draft',
  historical: 'Historical',
  implementing: 'Implementing',
  'in-review': 'In review',
  preferred: 'Preferred',
  reference: 'Reference',
  verified: 'Verified'
}

const TRANSITIONS: Record<
  WorkLifecycleStatus,
  Partial<Record<WorkLifecycleAction, WorkLifecycleStatus>>
> = {
  approved: {
    archive: 'historical',
    'start-implementation': 'implementing'
  },
  'change-set': {
    approve: 'approved',
    archive: 'historical',
    'request-changes': 'draft'
  },
  draft: {
    archive: 'historical',
    'request-review': 'in-review',
    'start-branch': 'draft'
  },
  historical: {},
  implementing: {
    verify: 'verified'
  },
  'in-review': {
    archive: 'historical',
    'mark-preferred': 'preferred',
    'request-changes': 'draft'
  },
  preferred: {
    archive: 'historical',
    'create-change-set': 'change-set',
    'request-changes': 'draft'
  },
  reference: {
    archive: 'historical',
    'start-draft': 'draft'
  },
  verified: {
    archive: 'historical'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isWorkLifecycleStatus(value: unknown): value is WorkLifecycleStatus {
  return typeof value === 'string' && WORK_LIFECYCLE_STATUSES.includes(value as WorkLifecycleStatus)
}

function isWorkLifecycleAction(value: unknown): value is WorkLifecycleAction {
  return typeof value === 'string' && WORK_LIFECYCLE_ACTIONS.includes(value as WorkLifecycleAction)
}

function isActorKind(value: unknown): value is WorkLifecycleActorKind {
  return value === 'agent' || value === 'human' || value === 'system'
}

function isVerificationEvidence(value: unknown): value is WorkLifecycleVerificationEvidence {
  if (!isRecord(value)) return false
  return Boolean(
    value.realAppVerified === true &&
    value.testPassed === true &&
    typeof value.sourcePatchId === 'string' &&
    value.sourcePatchId.trim() &&
    typeof value.testCommand === 'string' &&
    value.testCommand.trim() &&
    typeof value.verifiedBy === 'string' &&
    value.verifiedBy.trim()
  )
}

function isTransitionReceipt(value: unknown): value is WorkLifecycleTransitionReceipt {
  if (!isRecord(value)) return false
  return Boolean(
    isWorkLifecycleAction(value.action) &&
    isActorKind(value.actorKind) &&
    isWorkLifecycleStatus(value.from) &&
    isWorkLifecycleStatus(value.to) &&
    typeof value.actorId === 'string' &&
    typeof value.id === 'string' &&
    typeof value.itemId === 'string' &&
    typeof value.label === 'string' &&
    typeof value.occurredAt === 'string' &&
    Number.isInteger(value.revision) &&
    (value.evidence === undefined || isVerificationEvidence(value.evidence))
  )
}

function cloneTransitionReceipt(
  receipt: WorkLifecycleTransitionReceipt
): WorkLifecycleTransitionReceipt {
  return {
    ...receipt,
    evidence: receipt.evidence ? { ...receipt.evidence } : undefined
  }
}

function transitionId(itemId: string, revision: number) {
  const bytes = new Uint32Array(2)
  globalThis.crypto.getRandomValues(bytes)
  return `work-transition_${itemId}_${revision}_${[...bytes]
    .map((value) => value.toString(36))
    .join('')}`
}

function verificationFailure(evidence: WorkLifecycleVerificationEvidence | undefined) {
  if (evidence && isVerificationEvidence(evidence)) return null
  return 'Verification requires a source patch, a passing test command, real-app evidence, and a verifier.'
}

export function workLifecycleActionLabel(action: WorkLifecycleAction): string {
  return ACTION_LABELS[action]
}

export function workLifecycleStatusLabel(status: WorkLifecycleStatus): string {
  return STATUS_LABELS[status]
}

export function createWorkLifecycleState(status: WorkLifecycleStatus): WorkLifecycleState {
  return { history: [], revision: 1, status }
}

export function normalizeWorkLifecycleState(
  value: unknown,
  fallbackStatus: WorkLifecycleStatus
): WorkLifecycleState {
  if (!isRecord(value)) return createWorkLifecycleState(fallbackStatus)
  const history = Array.isArray(value.history)
    ? value.history.filter(isTransitionReceipt).map(cloneTransitionReceipt)
    : []
  const revision =
    Number.isInteger(value.revision) && Number(value.revision) > 0
      ? Number(value.revision)
      : Math.max(1, ...history.map((receipt) => receipt.revision))
  return {
    history,
    revision,
    status: isWorkLifecycleStatus(value.status) ? value.status : fallbackStatus
  }
}

export function nextWorkLifecycleStatus(
  status: WorkLifecycleStatus,
  action: WorkLifecycleAction
): WorkLifecycleStatus | null {
  return TRANSITIONS[status][action] ?? null
}

export function canTransitionWorkLifecycle(
  state: Pick<WorkLifecycleState, 'status'>,
  action: WorkLifecycleAction
): boolean {
  return nextWorkLifecycleStatus(state.status, action) !== null
}

export function availableWorkLifecycleActions(
  state: Pick<WorkLifecycleState, 'status'>
): WorkLifecycleAction[] {
  return WORK_LIFECYCLE_ACTIONS.filter((action) => canTransitionWorkLifecycle(state, action))
}

export function transitionWorkLifecycle(
  itemId: string,
  state: WorkLifecycleState,
  input: TransitionWorkLifecycleInput
): WorkLifecycleTransitionResult {
  const to = nextWorkLifecycleStatus(state.status, input.action)
  if (!to) {
    return {
      ok: false,
      reason: `${workLifecycleActionLabel(input.action)} is unavailable from ${workLifecycleStatusLabel(state.status)}.`,
      state
    }
  }
  if (input.action === 'verify') {
    const reason = verificationFailure(input.evidence)
    if (reason) return { ok: false, reason, state }
  }

  const revision = state.revision + 1
  const receipt: WorkLifecycleTransitionReceipt = {
    action: input.action,
    actorId: input.actorId?.trim() || 'local-user',
    actorKind: input.actorKind ?? 'human',
    evidence: input.evidence ? structuredClone(input.evidence) : undefined,
    from: state.status,
    id: input.id ?? transitionId(itemId, revision),
    itemId,
    label: input.label?.trim() || workLifecycleActionLabel(input.action),
    occurredAt: input.now ?? new Date().toISOString(),
    revision,
    to
  }
  return {
    ok: true,
    receipt,
    state: {
      history: [...state.history, receipt],
      revision,
      status: to
    }
  }
}
