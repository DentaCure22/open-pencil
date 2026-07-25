import type { SceneGraph } from '@open-pencil/scene-graph'

import type {
  ExperienceProjectionPurpose,
  ObservedSessionTarget,
  ResolvedExperienceFamilyV1,
  WorkspaceObjectRevisionRef
} from '@/app/workspace'

export type PreparedFieldRunAttemptResult = 'aborted' | 'expired' | 'interrupted'

export type PreparedFieldRunAttempt = {
  endedAt?: string
  result?: PreparedFieldRunAttemptResult
  sessionId: string
  startedAt: string
}

export const DEFAULT_FIELD_CAMPAIGN_ID = 'intent-experience-field-proof-v1'
export const FIELD_CAMPAIGN_CAPACITY = 5 as const

export type FieldCampaignSlot = 1 | 2 | 3 | 4 | 5

export type PreparedFieldRunCampaign = {
  campaignId: string
  capacity: typeof FIELD_CAMPAIGN_CAPACITY
  schemaVersion: 1
  slot: FieldCampaignSlot
}

export type FieldCampaignState = {
  assignedSlots: Array<{
    preparedAt: string
    runCode: string
    slot: FieldCampaignSlot
  }>
  availableSlots: FieldCampaignSlot[]
  campaignId: string
  capacity: typeof FIELD_CAMPAIGN_CAPACITY
  schemaVersion: 1
}

type PreparedFieldRunCommon = {
  attempts: PreparedFieldRunAttempt[]
  boardId: string
  campaign?: PreparedFieldRunCampaign
  preparedAt: string
  projectionPageId: string
  projectionViewId: string
  purpose: ExperienceProjectionPurpose
  rootSurface: WorkspaceObjectRevisionRef
  runCode: string
  target: ObservedSessionTarget
  targetPageId: string
}

export type PreparedSingleSurfaceFieldRunV1 = PreparedFieldRunCommon & {
  scope?: never
  version: 1
}

export type PreparedFamilyFieldRunV2 = PreparedFieldRunCommon & {
  scope: {
    family: ResolvedExperienceFamilyV1
    kind: 'experience-family'
    schemaVersion: 1
  }
  version: 2
}

export type PreparedFieldRun = PreparedSingleSurfaceFieldRunV1 | PreparedFamilyFieldRunV2

export type PrepareFieldRunInput = Omit<
  PreparedFieldRunCommon,
  'attempts' | 'campaign' | 'preparedAt'
> & {
  campaign?: {
    campaignId?: string
    slot?: FieldCampaignSlot
  }
  preparedAt?: string
  scope?: PreparedFamilyFieldRunV2['scope']
}

const PLUGIN_ID = 'openpencil-field-runs'
const RUNS_KEY = 'prepared-runs-v1'
const LEDGER_RUN_LIMIT = 100
const ATTEMPT_LIMIT = 10
const PURPOSES = new Set<ExperienceProjectionPurpose>(['focus', 'compare', 'knowledge', 'review'])
const CAMPAIGN_SLOTS: FieldCampaignSlot[] = [1, 2, 3, 4, 5]

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isPositiveRevision(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function validCampaignId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(value)
}

function isCampaignSlot(value: unknown): value is FieldCampaignSlot {
  return Number.isInteger(value) && CAMPAIGN_SLOTS.includes(Number(value) as FieldCampaignSlot)
}

function isCampaign(value: unknown): value is PreparedFieldRunCampaign {
  return Boolean(
    isObjectRecord(value) &&
    value.schemaVersion === 1 &&
    value.capacity === FIELD_CAMPAIGN_CAPACITY &&
    typeof value.campaignId === 'string' &&
    validCampaignId(value.campaignId) &&
    isCampaignSlot(value.slot)
  )
}

function isReference(value: unknown): value is WorkspaceObjectRevisionRef {
  return Boolean(
    isObjectRecord(value) &&
    typeof value.objectId === 'string' &&
    value.objectId.length > 0 &&
    isPositiveRevision(value.revision)
  )
}

function isArtifact(value: unknown): value is ObservedSessionTarget['artifact'] {
  if (!isObjectRecord(value)) return false
  return Boolean(
    value.kind === 'html-board' &&
    typeof value.artifactId === 'string' &&
    value.artifactId.length > 0 &&
    typeof value.boardId === 'string' &&
    value.boardId.length > 0 &&
    isPositiveRevision(value.boardRevision) &&
    isPositiveRevision(value.boardSchemaVersion) &&
    typeof value.sourceHash === 'string' &&
    value.sourceHash.length > 0
  )
}

function isTarget(value: unknown): value is ObservedSessionTarget {
  if (!isObjectRecord(value) || !isObjectRecord(value.artifact)) return false
  return Boolean(
    isArtifact(value.artifact) &&
    isReference(value.evidenceManifest) &&
    isReference(value.intent) &&
    isReference(value.surfaceRun)
  )
}

function isFamilyHeader(value: Record<string, unknown>): boolean {
  return Boolean(
    value.complete === true &&
    value.schemaVersion === 1 &&
    typeof value.compositionId === 'string' &&
    value.compositionId &&
    typeof value.recipeDigest === 'string' &&
    value.recipeDigest.startsWith('fnv1a-') &&
    typeof value.familyDigest === 'string' &&
    value.familyDigest.startsWith('fnv1a-') &&
    isReference(value.intent) &&
    isReference(value.evidenceManifest) &&
    Number.isInteger(value.surfaceCount) &&
    Number(value.surfaceCount) > 0
  )
}

function isFamilyMember(value: unknown, index: number): boolean {
  if (
    !isObjectRecord(value) ||
    !isArtifact(value.artifact) ||
    !isReference(value.surfaceRun) ||
    value.surfaceIndex !== index ||
    typeof value.instanceId !== 'string' ||
    !value.instanceId ||
    typeof value.rendererId !== 'string' ||
    !value.rendererId ||
    typeof value.formKind !== 'string'
  ) {
    return false
  }
  if (value.role === 'primary') return true
  return Boolean(
    value.role === 'support' &&
    isObjectRecord(value.relation) &&
    typeof value.relation.relationId === 'string' &&
    value.relation.relationId &&
    isPositiveRevision(value.relation.revision)
  )
}

function isFamily(value: unknown): value is ResolvedExperienceFamilyV1 {
  if (!isObjectRecord(value) || !Array.isArray(value.members) || !isObjectRecord(value.primary)) {
    return false
  }
  if (!isFamilyHeader(value) || value.members.length !== value.surfaceCount) {
    return false
  }
  const membersValid = value.members.every(isFamilyMember)
  return Boolean(
    membersValid &&
    value.primary.role === 'primary' &&
    value.primary.surfaceIndex === 0 &&
    isReference(value.primary.surfaceRun) &&
    isArtifact(value.primary.artifact) &&
    Array.isArray(value.supports) &&
    value.supports.length === Number(value.surfaceCount) - 1 &&
    Array.isArray(value.relations) &&
    value.relations.length === value.supports.length
  )
}

function isPreparedFieldRunCommon(value: Record<string, unknown>): boolean {
  return Boolean(
    typeof value.runCode === 'string' &&
    validRunCode(value.runCode) &&
    typeof value.preparedAt === 'string' &&
    typeof value.targetPageId === 'string' &&
    typeof value.projectionPageId === 'string' &&
    typeof value.projectionViewId === 'string' &&
    typeof value.purpose === 'string' &&
    PURPOSES.has(value.purpose as ExperienceProjectionPurpose) &&
    typeof value.boardId === 'string' &&
    value.boardId.length > 0 &&
    isReference(value.rootSurface) &&
    isTarget(value.target) &&
    value.target.artifact.boardId === value.boardId &&
    (value.campaign === undefined || isCampaign(value.campaign)) &&
    Array.isArray(value.attempts) &&
    value.attempts.every(isAttempt)
  )
}

function isFamilyScope(value: unknown): value is PreparedFamilyFieldRunV2['scope'] {
  return Boolean(
    isObjectRecord(value) &&
    value.kind === 'experience-family' &&
    value.schemaVersion === 1 &&
    isFamily(value.family)
  )
}

function sameReference(
  left: WorkspaceObjectRevisionRef,
  right: WorkspaceObjectRevisionRef
): boolean {
  return left.objectId === right.objectId && left.revision === right.revision
}

function targetMatchesFamilyPrimary(run: {
  boardId: string
  rootSurface: WorkspaceObjectRevisionRef
  scope: PreparedFamilyFieldRunV2['scope']
  target: ObservedSessionTarget
}): boolean {
  const { family } = run.scope
  return Boolean(
    run.boardId === family.primary.artifact.boardId &&
    sameReference(run.rootSurface, family.primary.surfaceRun) &&
    sameReference(run.target.surfaceRun, family.primary.surfaceRun) &&
    sameReference(run.target.intent, family.intent) &&
    sameReference(run.target.evidenceManifest, family.evidenceManifest) &&
    JSON.stringify(run.target.artifact) === JSON.stringify(family.primary.artifact)
  )
}

function isAttempt(value: unknown): value is PreparedFieldRunAttempt {
  if (!isObjectRecord(value)) return false
  const ended = value.endedAt === undefined && value.result === undefined
  const completed =
    typeof value.endedAt === 'string' &&
    ['aborted', 'expired', 'interrupted'].includes(String(value.result))
  return Boolean(
    typeof value.sessionId === 'string' &&
    value.sessionId.length > 0 &&
    typeof value.startedAt === 'string' &&
    (ended || completed)
  )
}

function isPreparedFieldRun(value: unknown): value is PreparedFieldRun {
  if (!isObjectRecord(value)) return false
  if ((value.version !== 1 && value.version !== 2) || !isPreparedFieldRunCommon(value)) {
    return false
  }
  if (value.version === 1) return value.scope === undefined
  if (!isFamilyScope(value.scope)) return false
  return targetMatchesFamilyPrimary({
    boardId: value.boardId as string,
    rootSurface: value.rootSurface as WorkspaceObjectRevisionRef,
    scope: value.scope,
    target: value.target as ObservedSessionTarget
  })
}

function validRunCode(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(value)
}

function normalizedRunCode(value: string): string {
  const normalized = value.trim()
  if (!validRunCode(normalized)) {
    throw new Error('field_run_code_invalid: use 2-40 letters, numbers, hyphens, or underscores')
  }
  return normalized
}

function normalizedCampaignId(value?: string): string {
  const normalized = value?.trim() || DEFAULT_FIELD_CAMPAIGN_ID
  if (!validCampaignId(normalized)) {
    throw new Error('field_campaign_id_invalid: use 2-80 letters, numbers, hyphens, or underscores')
  }
  return normalized
}

function campaignAssignment(
  runs: PreparedFieldRun[],
  input?: PrepareFieldRunInput['campaign']
): PreparedFieldRunCampaign {
  const campaignId = normalizedCampaignId(input?.campaignId)
  const occupied = new Map(
    runs
      .filter((run) => run.campaign?.campaignId === campaignId)
      .map((run) => [run.campaign!.slot, run.runCode])
  )
  const requestedSlot = input?.slot
  if (requestedSlot !== undefined && !isCampaignSlot(requestedSlot)) {
    throw new Error(`field_campaign_slot_invalid: choose 1-${FIELD_CAMPAIGN_CAPACITY}`)
  }
  const slot = requestedSlot ?? CAMPAIGN_SLOTS.find((value) => !occupied.has(value))
  if (!slot) {
    throw new Error(
      `field_campaign_capacity_reached: ${campaignId} already has ${FIELD_CAMPAIGN_CAPACITY} immutable slots`
    )
  }
  const occupyingRun = occupied.get(slot)
  if (occupyingRun) {
    throw new Error(
      `field_campaign_slot_conflict: ${campaignId} slot ${slot} belongs to ${occupyingRun}`
    )
  }
  return {
    campaignId,
    capacity: FIELD_CAMPAIGN_CAPACITY,
    schemaVersion: 1,
    slot
  }
}

function rootPluginValue(graph: SceneGraph): string | undefined {
  return graph
    .getNode(graph.rootId)
    ?.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === RUNS_KEY)?.value
}

function writePreparedFieldRuns(graph: SceneGraph, runs: PreparedFieldRun[]): void {
  if (runs.length > LEDGER_RUN_LIMIT) {
    throw new Error(
      `field_run_ledger_capacity_reached: ${LEDGER_RUN_LIMIT} immutable runs are already stored`
    )
  }
  const campaignSlots = new Set<string>()
  for (const run of runs) {
    if (!run.campaign) continue
    const key = `${run.campaign.campaignId}:${run.campaign.slot}`
    if (campaignSlots.has(key)) {
      throw new Error(`field_campaign_slot_conflict: ${key}`)
    }
    campaignSlots.add(key)
  }
  const root = graph.getNode(graph.rootId)
  if (!root) throw new Error('field_run_document_root_missing')
  const pluginData = root.pluginData.filter(
    (entry) => !(entry.pluginId === PLUGIN_ID && entry.key === RUNS_KEY)
  )
  pluginData.push({
    key: RUNS_KEY,
    pluginId: PLUGIN_ID,
    value: JSON.stringify(
      runs.toSorted((left, right) => left.preparedAt.localeCompare(right.preparedAt))
    )
  })
  graph.updateNode(root.id, { pluginData })
}

function canonicalRunIdentity(
  run: Pick<PreparedFieldRun, Exclude<keyof PreparedFieldRun, 'attempts' | 'preparedAt'>>
): string {
  return JSON.stringify({
    boardId: run.boardId,
    campaign: run.campaign,
    projectionPageId: run.projectionPageId,
    projectionViewId: run.projectionViewId,
    purpose: run.purpose,
    rootSurface: run.rootSurface,
    runCode: run.runCode,
    scope: run.scope,
    target: run.target,
    targetPageId: run.targetPageId,
    version: run.version
  })
}

export function readPreparedFieldRuns(graph: SceneGraph): PreparedFieldRun[] {
  const serialized = rootPluginValue(graph)
  if (!serialized) return []
  try {
    const value = JSON.parse(serialized) as unknown
    return Array.isArray(value) ? value.filter(isPreparedFieldRun) : []
  } catch {
    return []
  }
}

export function getPreparedFieldRun(graph: SceneGraph, runCode: string): PreparedFieldRun | null {
  const normalized = normalizedRunCode(runCode)
  return readPreparedFieldRuns(graph).find((run) => run.runCode === normalized) ?? null
}

export function fieldCampaignState(
  graph: SceneGraph,
  campaignId = DEFAULT_FIELD_CAMPAIGN_ID
): FieldCampaignState {
  const normalized = normalizedCampaignId(campaignId)
  const assignedSlots = readPreparedFieldRuns(graph)
    .filter((run) => run.campaign?.campaignId === normalized)
    .map((run) => ({
      preparedAt: run.preparedAt,
      runCode: run.runCode,
      slot: run.campaign!.slot
    }))
    .toSorted((left, right) => left.slot - right.slot)
  const assigned = new Set(assignedSlots.map(({ slot }) => slot))
  return {
    assignedSlots,
    availableSlots: CAMPAIGN_SLOTS.filter((slot) => !assigned.has(slot)),
    campaignId: normalized,
    capacity: FIELD_CAMPAIGN_CAPACITY,
    schemaVersion: 1
  }
}

export function prepareFieldRun(
  graph: SceneGraph,
  input: PrepareFieldRunInput
): { created: boolean; run: PreparedFieldRun } {
  const planned = planPreparedFieldRun(graph, input)
  if (!planned.created) return planned
  writePreparedFieldRuns(graph, [...readPreparedFieldRuns(graph), planned.run])
  return { created: true, run: structuredClone(planned.run) }
}

export function planPreparedFieldRun(
  graph: SceneGraph,
  input: PrepareFieldRunInput
): { created: boolean; run: PreparedFieldRun } {
  const runs = readPreparedFieldRuns(graph)
  const runCode = normalizedRunCode(input.runCode)
  const existing = runs.find((candidate) => candidate.runCode === runCode)
  const requestedCampaignId = input.campaign?.campaignId
    ? normalizedCampaignId(input.campaign.campaignId)
    : undefined
  if (
    existing &&
    ((requestedCampaignId && requestedCampaignId !== existing.campaign?.campaignId) ||
      (input.campaign?.slot !== undefined && input.campaign.slot !== existing.campaign?.slot))
  ) {
    throw new Error(`field_run_code_conflict: ${runCode} already owns another campaign slot`)
  }
  const run: PreparedFieldRun = {
    ...structuredClone(input),
    attempts: [],
    campaign: existing ? existing.campaign : campaignAssignment(runs, input.campaign),
    preparedAt: input.preparedAt ?? new Date().toISOString(),
    runCode,
    version: input.scope ? 2 : 1
  } as PreparedFieldRun
  if (!isPreparedFieldRun(run)) throw new Error('field_run_target_invalid')
  if (existing) {
    if (canonicalRunIdentity(existing) !== canonicalRunIdentity(run)) {
      throw new Error(`field_run_code_conflict: ${run.runCode} already targets another experience`)
    }
    return { created: false, run: structuredClone(existing) }
  }
  return { created: true, run: structuredClone(run) }
}

export function recordFieldRunAttemptStarted(
  graph: SceneGraph,
  input: { runCode: string; sessionId: string; startedAt: string }
): { changed: boolean; run: PreparedFieldRun } {
  const runCode = normalizedRunCode(input.runCode)
  const runs = readPreparedFieldRuns(graph)
  const index = runs.findIndex((run) => run.runCode === runCode)
  if (index === -1) throw new Error(`field_run_not_found: ${runCode}`)
  const duplicate = runs
    .flatMap((run) => run.attempts)
    .find((attempt) => attempt.sessionId === input.sessionId)
  if (duplicate) {
    if (
      duplicate.startedAt !== input.startedAt ||
      runs[index].attempts.every((attempt) => attempt.sessionId !== input.sessionId)
    ) {
      throw new Error(`field_run_attempt_conflict: ${input.sessionId}`)
    }
    return { changed: false, run: structuredClone(runs[index]) }
  }
  if (runs[index].attempts.length >= ATTEMPT_LIMIT) {
    throw new Error(
      `field_run_attempt_capacity_reached: ${runCode} preserves all ${ATTEMPT_LIMIT} attempts`
    )
  }
  const attempts = runs[index].attempts
    .map((attempt) =>
      attempt.endedAt
        ? attempt
        : {
            ...attempt,
            endedAt: input.startedAt,
            result: 'interrupted' as const
          }
    )
    .concat({ sessionId: input.sessionId, startedAt: input.startedAt })
  runs[index] = { ...runs[index], attempts }
  writePreparedFieldRuns(graph, runs)
  return { changed: true, run: structuredClone(runs[index]) }
}

export function recordFieldRunAttemptEnded(
  graph: SceneGraph,
  input: {
    endedAt: string
    result: Exclude<PreparedFieldRunAttemptResult, 'interrupted'>
    runCode: string
    sessionId: string
  }
): { changed: boolean; run: PreparedFieldRun } {
  const runCode = normalizedRunCode(input.runCode)
  const runs = readPreparedFieldRuns(graph)
  const index = runs.findIndex((run) => run.runCode === runCode)
  if (index === -1) throw new Error(`field_run_not_found: ${runCode}`)
  const attemptIndex = runs[index].attempts.findIndex(
    (attempt) => attempt.sessionId === input.sessionId
  )
  if (attemptIndex === -1) throw new Error(`field_run_attempt_not_found: ${input.sessionId}`)
  const attempt = runs[index].attempts[attemptIndex]
  if (attempt.endedAt) {
    if (attempt.endedAt !== input.endedAt || attempt.result !== input.result) {
      throw new Error(`field_run_attempt_conflict: ${input.sessionId}`)
    }
    return { changed: false, run: structuredClone(runs[index]) }
  }
  const attempts = [...runs[index].attempts]
  attempts[attemptIndex] = {
    ...attempt,
    endedAt: input.endedAt,
    result: input.result
  }
  runs[index] = { ...runs[index], attempts }
  writePreparedFieldRuns(graph, runs)
  return { changed: true, run: structuredClone(runs[index]) }
}
