import type {
  LearningAttestation,
  ObservedExperienceFamilyFinalV2,
  ObservedExperienceFamilyScopeV2,
  ObservedSessionClaim,
  ObservedSessionDataPolicy,
  ObservedSessionProofMaterial,
  ObservedSessionTarget,
  ObservedSessionTaskInteraction
} from '@/app/workspace'

const PROOF_ALGORITHM = 'ECDSA-P256-SHA256' as const
const MIN_TASK_INTERACTIONS = 1
const MIN_SESSION_DURATION_MS = 3_000
const MAX_SESSION_DURATION_MS = 30 * 60 * 1_000

export type ObservedHumanSessionClaim = ObservedSessionClaim
export type ObservedHumanReviewClaim = Pick<
  ObservedSessionClaim,
  | 'actorId'
  | 'decisionReceiptId'
  | 'occurredAt'
  | 'recordedAt'
  | 'reviewDigest'
  | 'runId'
  | 'surfaceRunId'
> & { finalFamilyDigest?: string }

export type ObservedHumanSessionStartInput = {
  actorId: string
  dataPolicy: ObservedSessionDataPolicy
  fieldSessionId?: string
  scope?: ObservedExperienceFamilyScopeV2
  target: ObservedSessionTarget
}

export type ObservedHumanTaskInteractionInput = ObservedSessionTaskInteraction

export type ObservedHumanSessionProof = {
  algorithm: typeof PROOF_ALGORITHM
  authorityRef: string
  claim: ObservedHumanSessionClaim
  claimDigest: string
  interactionCount: number
  issuedAt: string
  proofDigest: string
  publicKey: JsonWebKey
  sessionId: string
  sessionStartedAt: string
  signature: string
  taskInteractions: ObservedSessionTaskInteraction[]
}

export type ObservedHumanSessionState = {
  actorId?: string
  dataPolicy?: ObservedSessionDataPolicy
  expiresAt?: string
  familyMemberCount?: number
  familyMembersUsed?: number
  fieldSessionId?: string
  interactionCount: number
  readyAt?: string
  sessionId?: string
  startedAt?: string
  status: 'aborted' | 'active' | 'consumed' | 'expired' | 'idle' | 'issued' | 'ready'
  scope?: ObservedExperienceFamilyScopeV2
  target?: ObservedSessionTarget
}

export type ObservedHumanSessionRuntime = {
  crypto: Crypto
  hasFocus(): boolean
  hasUserActivation(): boolean
  isAutomated(): boolean
  isVisible(): boolean
  now(): number
  onStateChange?(state: ObservedHumanSessionState): void
  schedule?(callback: () => void, delayMs: number): () => void
}

type ActiveSession = {
  actorId: string
  authorityRef: string
  dataPolicy: ObservedSessionDataPolicy
  fieldSessionId: string
  issuedProof?: ObservedHumanSessionProof
  privateKey: CryptoKey
  publicKeyJwk: JsonWebKey
  sessionId: string
  startedAt: string
  startedAtMs: number
  status: 'aborted' | 'active' | 'consumed' | 'expired' | 'issued'
  scope?: ObservedExperienceFamilyScopeV2
  target: ObservedSessionTarget
  taskInteractions: ObservedSessionTaskInteraction[]
}

function isObjectRecord(value: unknown): value is { [key: string]: unknown } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObjectRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = `${value.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat(
    (4 - (value.length % 4)) % 4
  )}`
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function digest(crypto: Crypto, value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const result = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${bytesToHex(new Uint8Array(result))}`
}

export async function observedHumanReviewDigest(value: unknown, crypto: Crypto): Promise<string> {
  return digest(crypto, canonicalJson(value))
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required for observed-session attestation`)
}

function isPositiveRevision(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function requireTarget(target: ObservedSessionTarget): void {
  for (const [label, reference] of [
    ['intent', target.intent],
    ['evidenceManifest', target.evidenceManifest],
    ['surfaceRun', target.surfaceRun]
  ] as const) {
    requireText(reference.objectId, `${label}.objectId`)
    if (!isPositiveRevision(reference.revision)) {
      throw new Error(`${label}.revision is required for observed-session attestation`)
    }
  }
  for (const [label, value] of Object.entries(target.artifact)) {
    if (typeof value === 'string') requireText(value, `artifact.${label}`)
  }
  if (
    !isPositiveRevision(target.artifact.boardRevision) ||
    !isPositiveRevision(target.artifact.boardSchemaVersion)
  ) {
    throw new Error('Exact artifact revisions are required for observed-session attestation')
  }
}

function sameReference(
  left: { objectId: string; revision: number },
  right: { objectId: string; revision: number }
): boolean {
  return left.objectId === right.objectId && left.revision === right.revision
}

function requireFamilyScope(
  scope: ObservedExperienceFamilyScopeV2,
  target: ObservedSessionTarget
): void {
  const family = scope.family
  if (
    !family.compositionId.trim() ||
    !family.recipeDigest.startsWith('fnv1a-') ||
    !family.familyDigest.startsWith('fnv1a-') ||
    family.surfaceCount < 1 ||
    family.surfaceCount !== family.members.length ||
    family.supports.length !== family.surfaceCount - 1 ||
    family.relations.length !== family.supports.length ||
    family.primary.surfaceIndex !== 0
  ) {
    throw new Error('Observed family scope must contain one complete bounded family')
  }
  const memberIds = new Set<string>()
  family.members.forEach((member, index) => {
    requireTarget({
      artifact: member.artifact,
      evidenceManifest: family.evidenceManifest,
      intent: family.intent,
      surfaceRun: member.surfaceRun
    })
    if (
      member.surfaceIndex !== index ||
      memberIds.has(member.surfaceRun.objectId) ||
      (index === 0 ? member.role !== 'primary' : member.role !== 'support')
    ) {
      throw new Error('Observed family scope has invalid ordered membership')
    }
    memberIds.add(member.surfaceRun.objectId)
  })
  if (
    !sameReference(target.surfaceRun, family.primary.surfaceRun) ||
    !sameReference(target.intent, family.intent) ||
    !sameReference(target.evidenceManifest, family.evidenceManifest) ||
    canonicalJson(target.artifact) !== canonicalJson(family.primary.artifact)
  ) {
    throw new Error('Observed family target must be the exact family primary')
  }
}

function isFullClaim(
  claim: ObservedHumanSessionClaim | ObservedHumanReviewClaim
): claim is ObservedHumanSessionClaim {
  return 'fieldSessionId' in claim
}

function reviewClaim(claim: ObservedHumanSessionClaim): ObservedHumanReviewClaim {
  return {
    actorId: claim.actorId,
    decisionReceiptId: claim.decisionReceiptId,
    occurredAt: claim.occurredAt,
    recordedAt: claim.recordedAt,
    reviewDigest: claim.reviewDigest,
    runId: claim.runId,
    surfaceRunId: claim.surfaceRunId
  }
}

function sameClaim(left: ObservedHumanSessionClaim, right: ObservedHumanSessionClaim): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function claimMatchesExpected(
  actual: ObservedHumanSessionClaim,
  expected: ObservedHumanSessionClaim | ObservedHumanReviewClaim
): boolean {
  if (isFullClaim(expected)) return sameClaim(actual, expected)
  const { finalFamilyDigest, ...baseExpected } = expected
  if (canonicalJson(reviewClaim(actual)) !== canonicalJson(baseExpected)) return false
  return (
    !finalFamilyDigest ||
    (actual.version === 2 && actual.finalFamily.familyDigest === finalFamilyDigest)
  )
}

function sameRevisionState(
  left: ObservedSessionTaskInteraction['after'],
  right: ObservedSessionTaskInteraction['before']
): boolean {
  return (
    left.artifactRevision === right.artifactRevision &&
    left.surfaceRevision === right.surfaceRevision
  )
}

function taskEventInvalid(
  interaction: ObservedSessionTaskInteraction,
  eventIds: ReadonlySet<string>
): boolean {
  return (
    !interaction.eventId.trim() ||
    eventIds.has(interaction.eventId) ||
    !['keydown', 'pointerdown'].includes(interaction.kind)
  )
}

function taskTargetInvalid(
  interaction: ObservedSessionTaskInteraction,
  target: ObservedSessionTarget,
  member?: ObservedExperienceFamilyScopeV2['family']['members'][number]
): boolean {
  return member
    ? interaction.frameId !== member.artifact.boardId
    : interaction.surfaceRunId !== target.surfaceRun.objectId ||
        interaction.frameId !== target.artifact.boardId
}

function taskRevisionInvalid(
  interaction: ObservedSessionTaskInteraction,
  expectedBefore: ObservedSessionTaskInteraction['before']
): boolean {
  return (
    !sameRevisionState(expectedBefore, interaction.before) ||
    !isPositiveRevision(interaction.after.artifactRevision) ||
    !isPositiveRevision(interaction.after.surfaceRevision) ||
    interaction.after.artifactRevision <= interaction.before.artifactRevision ||
    interaction.after.surfaceRevision <= interaction.before.surfaceRevision
  )
}

function taskTimeInvalid(
  interaction: ObservedSessionTaskInteraction,
  sessionStartedAt: string,
  issuedAt: string,
  previousOccurredAt: string
): boolean {
  return Boolean(
    !interaction.occurredAt ||
    interaction.occurredAt < sessionStartedAt ||
    interaction.occurredAt > issuedAt ||
    (previousOccurredAt && interaction.occurredAt < previousOccurredAt)
  )
}

function taskInteractionFailures(
  interactions: ObservedSessionTaskInteraction[],
  target: ObservedSessionTarget,
  sessionStartedAt: string,
  issuedAt: string,
  scope?: ObservedExperienceFamilyScopeV2
): string[] {
  const failures: string[] = []
  const eventIds = new Set<string>()
  const familyMembers = new Map(
    (scope?.family.members ?? []).map((member) => [member.surfaceRun.objectId, member])
  )
  const previousBySurface = new Map<string, ObservedSessionTaskInteraction>()
  interactions.forEach((interaction, index) => {
    const previousOccurredAt = index > 0 ? interactions[index - 1].occurredAt : ''
    const member = familyMembers.get(interaction.surfaceRunId)
    if (taskEventInvalid(interaction, eventIds)) {
      failures.push('task-event')
    }
    eventIds.add(interaction.eventId)
    if ((scope && !member) || taskTargetInvalid(interaction, target, member)) {
      failures.push('task-target')
    }
    const previousForSurface = previousBySurface.get(interaction.surfaceRunId)
    const expectedBefore = previousForSurface?.after ?? {
      artifactRevision: member?.artifact.boardRevision ?? target.artifact.boardRevision,
      surfaceRevision: member?.surfaceRun.revision ?? target.surfaceRun.revision
    }
    if (taskRevisionInvalid(interaction, expectedBefore)) {
      failures.push('task-revision-chain')
    }
    if (taskTimeInvalid(interaction, sessionStartedAt, issuedAt, previousOccurredAt)) {
      failures.push('task-time')
    }
    previousBySurface.set(interaction.surfaceRunId, interaction)
  })
  return [...new Set(failures)]
}

function finalFamilyFor(
  scope: ObservedExperienceFamilyScopeV2,
  interactions: ObservedSessionTaskInteraction[],
  familyDigest = scope.family.familyDigest
): ObservedExperienceFamilyFinalV2 {
  return {
    familyDigest,
    members: scope.family.members.map((member) => {
      const memberInteractions = interactions.filter(
        (interaction) => interaction.surfaceRunId === member.surfaceRun.objectId
      )
      const last = memberInteractions.at(-1)
      return {
        finalArtifactRevision: last?.after.artifactRevision ?? member.artifact.boardRevision,
        finalSurfaceRevision: last?.after.surfaceRevision ?? member.surfaceRun.revision,
        surfaceRunId: member.surfaceRun.objectId,
        taskInteractionCount: memberInteractions.length
      }
    })
  }
}

function proofMaterial(proof: ObservedHumanSessionProof): ObservedSessionProofMaterial {
  return {
    algorithm: proof.algorithm,
    claim: structuredClone(proof.claim),
    claimDigest: proof.claimDigest,
    publicKey: { ...proof.publicKey },
    signature: proof.signature,
    taskInteractions: proof.taskInteractions.map((interaction) => ({
      ...interaction,
      after: { ...interaction.after },
      before: { ...interaction.before }
    }))
  }
}

function proofIntegrityFailures(
  proof: ObservedHumanSessionProof,
  expected: ObservedHumanSessionClaim | ObservedHumanReviewClaim,
  values: {
    authorityFingerprint: string
    claimDigest: string
    proofDigest: string
    validSignature: boolean
  }
): string[] {
  return [
    String(proof.algorithm) !== PROOF_ALGORITHM ? 'algorithm' : '',
    !claimMatchesExpected(proof.claim, expected) ? 'claim' : '',
    !values.validSignature ? 'signature' : '',
    values.proofDigest !== proof.proofDigest ? 'digest' : '',
    values.claimDigest !== proof.claimDigest ? 'claim-digest' : '',
    proof.authorityRef !==
    `openpencil-local-observer-v${proof.claim.version === 2 ? 2 : 1}:${values.authorityFingerprint}`
      ? 'authority'
      : ''
  ].filter(Boolean)
}

function proofSessionFailures(
  proof: ObservedHumanSessionProof,
  taskInteractionDigest: string
): string[] {
  const failures = [
    !proof.sessionId ? 'session' : '',
    proof.claim.fieldSessionId ? '' : 'field-session',
    proof.claim.surfaceRunId !== proof.claim.target.surfaceRun.objectId ? 'surface-target' : '',
    proof.claim.taskInteractionDigest !== taskInteractionDigest ? 'task-digest' : '',
    proof.claim.taskInteractionCount !== proof.taskInteractions.length ? 'task-count' : '',
    proof.interactionCount !== proof.taskInteractions.length ? 'interactions' : '',
    proof.taskInteractions.length < MIN_TASK_INTERACTIONS ? 'task-interactions' : '',
    proof.claim.finalSurfaceRevision !==
    proof.taskInteractions.findLast(
      (interaction) => interaction.surfaceRunId === proof.claim.surfaceRunId
    )?.after.surfaceRevision
      ? 'final-surface-revision'
      : '',
    proof.claim.occurredAt < proof.sessionStartedAt ? 'decision-time' : '',
    ...taskInteractionFailures(
      proof.taskInteractions,
      proof.claim.target,
      proof.sessionStartedAt,
      proof.issuedAt,
      proof.claim.version === 2 ? proof.claim.scope : undefined
    )
  ].filter(Boolean)
  if (proof.claim.version === 2) {
    const expectedFinal = finalFamilyFor(
      proof.claim.scope,
      proof.taskInteractions,
      proof.claim.finalFamily.familyDigest
    )
    if (canonicalJson(expectedFinal) !== canonicalJson(proof.claim.finalFamily)) {
      failures.push('final-family')
    }
    if (expectedFinal.members.some((member) => member.taskInteractionCount < 1)) {
      failures.push('family-member-interactions')
    }
  }
  return [...new Set(failures)]
}

export async function verifyObservedHumanSessionProofCryptographically(
  proof: ObservedHumanSessionProof,
  expected: ObservedHumanSessionClaim | ObservedHumanReviewClaim,
  crypto: Crypto
): Promise<LearningAttestation> {
  const unsignedProof = {
    algorithm: proof.algorithm,
    authorityRef: proof.authorityRef,
    claim: proof.claim,
    claimDigest: proof.claimDigest,
    interactionCount: proof.interactionCount,
    issuedAt: proof.issuedAt,
    publicKey: proof.publicKey,
    sessionId: proof.sessionId,
    sessionStartedAt: proof.sessionStartedAt,
    signature: proof.signature,
    taskInteractions: proof.taskInteractions
  }
  const signedPayload = canonicalJson({
    algorithm: proof.algorithm,
    authorityRef: proof.authorityRef,
    claim: proof.claim,
    claimDigest: proof.claimDigest,
    interactionCount: proof.interactionCount,
    issuedAt: proof.issuedAt,
    publicKey: proof.publicKey,
    sessionId: proof.sessionId,
    sessionStartedAt: proof.sessionStartedAt,
    taskInteractions: proof.taskInteractions
  })
  const proofDigest = await digest(crypto, canonicalJson(unsignedProof))
  const claimDigest = await digest(crypto, canonicalJson(proof.claim))
  const taskInteractionDigest = await digest(crypto, canonicalJson(proof.taskInteractions))
  const authorityFingerprint = await digest(crypto, canonicalJson(proof.publicKey))
  let publicKey: CryptoKey
  try {
    publicKey = await crypto.subtle.importKey(
      'jwk',
      proof.publicKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
  } catch (error) {
    throw new Error(
      `Observed-session public key could not be imported: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  let validSignature: boolean
  try {
    validSignature = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      new Uint8Array(base64UrlToBytes(proof.signature)),
      new TextEncoder().encode(signedPayload)
    )
  } catch (error) {
    throw new Error(
      `Observed-session signature could not be checked: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const failures = [
    ...proofIntegrityFailures(proof, expected, {
      authorityFingerprint,
      claimDigest,
      proofDigest,
      validSignature
    }),
    ...proofSessionFailures(proof, taskInteractionDigest)
  ]
  if (failures.length > 0) {
    throw new Error(
      `Observed-session proof failed cryptographic or session verification: ${failures.join(', ')}`
    )
  }
  try {
    return {
      attestedAt: proof.issuedAt,
      attestedBy: proof.claim.actorId,
      authorityRef: proof.authorityRef,
      interactionCount: proof.interactionCount,
      kind: 'observed-session',
      proof: proofMaterial(proof),
      proofDigest: proof.proofDigest,
      sessionId: proof.sessionId,
      sessionStartedAt: proof.sessionStartedAt
    }
  } catch (error) {
    throw new Error(
      `Observed-session proof material could not be retained: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export async function verifyPersistedObservedSessionAttestation(
  attestation: LearningAttestation,
  expected: ObservedHumanSessionClaim | ObservedHumanReviewClaim,
  crypto: Crypto
): Promise<LearningAttestation> {
  if (
    attestation.kind !== 'observed-session' ||
    !attestation.proof ||
    !attestation.authorityRef ||
    !attestation.proofDigest ||
    !attestation.sessionId ||
    !attestation.sessionStartedAt ||
    !attestation.interactionCount
  ) {
    throw new Error('Observed-session attestation does not contain a complete durable proof')
  }
  return verifyObservedHumanSessionProofCryptographically(
    {
      algorithm: attestation.proof.algorithm,
      authorityRef: attestation.authorityRef,
      claim: attestation.proof.claim,
      claimDigest: attestation.proof.claimDigest,
      interactionCount: attestation.interactionCount,
      issuedAt: attestation.attestedAt,
      proofDigest: attestation.proofDigest,
      publicKey: attestation.proof.publicKey,
      sessionId: attestation.sessionId,
      sessionStartedAt: attestation.sessionStartedAt,
      signature: attestation.proof.signature,
      taskInteractions: attestation.proof.taskInteractions
    },
    expected,
    crypto
  )
}

export class ObservedHumanSessionAuthority {
  private cancelScheduledRefresh: (() => void) | null = null
  private session: ActiveSession | null = null

  constructor(private readonly runtime: ObservedHumanSessionRuntime) {}

  private stateFor(session: ActiveSession | null): ObservedHumanSessionState {
    if (!session) return { interactionCount: 0, status: 'idle' }
    const duration = this.runtime.now() - session.startedAtMs
    const expired = session.status === 'active' && duration > MAX_SESSION_DURATION_MS
    const usedMemberCount = new Set(
      session.taskInteractions.map((interaction) => interaction.surfaceRunId)
    ).size
    const requiredMemberCount = session.scope?.family.surfaceCount ?? 1
    const ready =
      session.status === 'active' &&
      session.taskInteractions.length >= MIN_TASK_INTERACTIONS &&
      usedMemberCount === requiredMemberCount &&
      duration >= MIN_SESSION_DURATION_MS &&
      duration <= MAX_SESSION_DURATION_MS
    let status: ObservedHumanSessionState['status'] = session.status
    if (expired) status = 'expired'
    else if (ready) status = 'ready'
    return {
      actorId: session.actorId,
      dataPolicy: session.dataPolicy,
      expiresAt: new Date(session.startedAtMs + MAX_SESSION_DURATION_MS).toISOString(),
      familyMemberCount: session.scope?.family.surfaceCount,
      familyMembersUsed: session.scope ? usedMemberCount : undefined,
      fieldSessionId: session.fieldSessionId,
      interactionCount: session.taskInteractions.length,
      readyAt: new Date(session.startedAtMs + MIN_SESSION_DURATION_MS).toISOString(),
      sessionId: session.sessionId,
      scope: session.scope ? structuredClone(session.scope) : undefined,
      startedAt: session.startedAt,
      status,
      target: structuredClone(session.target)
    }
  }

  state(): ObservedHumanSessionState {
    return this.stateFor(this.session)
  }

  private expireSessionIfNeeded(): boolean {
    const session = this.session
    if (
      session?.status === 'active' &&
      this.runtime.now() - session.startedAtMs > MAX_SESSION_DURATION_MS
    ) {
      session.status = 'expired'
      return true
    }
    return false
  }

  private clearScheduledRefresh(): void {
    this.cancelScheduledRefresh?.()
    this.cancelScheduledRefresh = null
  }

  private scheduleRefresh(): void {
    this.clearScheduledRefresh()
    const session = this.session
    if (session?.status !== 'active' || !this.runtime.schedule) return
    const duration = this.runtime.now() - session.startedAtMs
    const state = this.stateFor(session)
    const delay =
      state.status === 'active' &&
      session.taskInteractions.length >= MIN_TASK_INTERACTIONS &&
      duration < MIN_SESSION_DURATION_MS
        ? MIN_SESSION_DURATION_MS - duration
        : MAX_SESSION_DURATION_MS - duration + 1
    this.cancelScheduledRefresh = this.runtime.schedule(
      () => {
        this.cancelScheduledRefresh = null
        this.refresh()
      },
      Math.max(0, delay)
    )
  }

  private changed(): ObservedHumanSessionState {
    const state = this.state()
    this.runtime.onStateChange?.(state)
    this.scheduleRefresh()
    return state
  }

  refresh(): ObservedHumanSessionState {
    this.expireSessionIfNeeded()
    return this.changed()
  }

  async start(input: ObservedHumanSessionStartInput): Promise<ObservedHumanSessionState> {
    this.expireSessionIfNeeded()
    if (
      this.session &&
      !['aborted', 'consumed', 'expired'].includes(this.stateFor(this.session).status)
    ) {
      throw new Error('Finish or abort the current observed session before starting another')
    }
    requireText(input.actorId, 'actorId')
    requireTarget(input.target)
    if (input.scope) requireFamilyScope(input.scope, input.target)
    if (this.runtime.isAutomated()) {
      throw new Error('Automated browser environments cannot issue observed human sessions')
    }
    if (
      !this.runtime.hasUserActivation() ||
      !this.runtime.hasFocus() ||
      !this.runtime.isVisible()
    ) {
      throw new Error('Start an observed session from a focused visible user interaction')
    }
    const generated = await this.runtime.crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    )
    const [publicKeyJwk, privateBytes] = await Promise.all([
      this.runtime.crypto.subtle.exportKey('jwk', generated.publicKey),
      this.runtime.crypto.subtle.exportKey('pkcs8', generated.privateKey)
    ])
    const privateKey = await this.runtime.crypto.subtle.importKey(
      'pkcs8',
      privateBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    )
    const fingerprint = await digest(this.runtime.crypto, canonicalJson(publicKeyJwk))
    const startedAtMs = this.runtime.now()
    const fieldSessionId =
      input.fieldSessionId?.trim() || `field-session_${this.runtime.crypto.randomUUID()}`
    requireText(fieldSessionId, 'fieldSessionId')
    this.session = {
      actorId: input.actorId.trim(),
      authorityRef: `openpencil-local-observer-v${input.scope ? 2 : 1}:${fingerprint}`,
      dataPolicy: input.dataPolicy,
      fieldSessionId,
      privateKey,
      publicKeyJwk,
      sessionId: `human-session_${this.runtime.crypto.randomUUID()}`,
      scope: input.scope ? structuredClone(input.scope) : undefined,
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      status: 'active',
      target: structuredClone(input.target),
      taskInteractions: []
    }
    return this.changed()
  }

  recordTaskInteraction(input: ObservedHumanTaskInteractionInput): void {
    this.expireSessionIfNeeded()
    const session = this.session
    if (session?.status !== 'active') {
      throw new Error('No active observed session can accept task interactions')
    }
    if (this.runtime.isAutomated() || !this.runtime.hasFocus() || !this.runtime.isVisible()) {
      throw new Error('Task interaction was not observed in a focused human session')
    }
    requireText(input.eventId, 'eventId')
    requireText(input.frameId, 'frameId')
    requireText(input.surfaceRunId, 'surfaceRunId')
    requireText(input.occurredAt, 'occurredAt')
    if (!['keydown', 'pointerdown'].includes(input.kind)) {
      throw new Error('Task interaction kind must be pointerdown or keydown')
    }
    if (session.taskInteractions.some((interaction) => interaction.eventId === input.eventId)) {
      throw new Error(`Task interaction ${input.eventId} is already recorded`)
    }
    const failures = taskInteractionFailures(
      [...session.taskInteractions, input],
      session.target,
      session.startedAt,
      new Date(this.runtime.now()).toISOString(),
      session.scope
    )
    if (failures.length > 0) {
      throw new Error(`Task interaction does not match the bound session: ${failures.join(', ')}`)
    }
    session.taskInteractions.push(structuredClone(input))
    this.changed()
  }

  private requireReadySession(claim: ObservedHumanReviewClaim): ActiveSession {
    this.expireSessionIfNeeded()
    const session = this.session
    if (!session || this.state().status !== 'ready') {
      throw new Error(
        session?.scope
          ? 'Observed family session needs one applied interaction per member and three focused seconds'
          : 'Observed session needs one applied task interaction and three focused seconds'
      )
    }
    if (
      this.runtime.isAutomated() ||
      !this.runtime.hasFocus() ||
      !this.runtime.isVisible() ||
      claim.actorId !== session.actorId ||
      claim.surfaceRunId !== session.target.surfaceRun.objectId ||
      claim.occurredAt < session.startedAt
    ) {
      throw new Error('Observed session does not match the active human task')
    }
    return session
  }

  async issue(review: ObservedHumanReviewClaim): Promise<ObservedHumanSessionProof> {
    for (const [label, value] of Object.entries(review)) {
      if (typeof value === 'string') requireText(value, label)
    }
    const existing = this.session
    if (existing?.status === 'issued' && existing.issuedProof) {
      if (!claimMatchesExpected(existing.issuedProof.claim, review)) {
        throw new Error('Observed session already issued a proof for a different review')
      }
      return structuredClone(existing.issuedProof)
    }
    const session = this.requireReadySession(review)
    const taskInteractions = structuredClone(session.taskInteractions)
    const lastInteraction = taskInteractions.at(-1)
    if (!lastInteraction || review.occurredAt < lastInteraction.occurredAt) {
      throw new Error('The decided outcome must follow the observed task interactions')
    }
    if (session.scope && !review.finalFamilyDigest?.startsWith('fnv1a-')) {
      throw new Error('Observed family proof requires the exact final family digest')
    }
    const { finalFamilyDigest, ...reviewClaimFields } = review
    const commonClaim = {
      ...reviewClaimFields,
      dataPolicy: session.dataPolicy,
      fieldSessionId: session.fieldSessionId,
      target: structuredClone(session.target),
      taskInteractionCount: taskInteractions.length,
      taskInteractionDigest: await digest(this.runtime.crypto, canonicalJson(taskInteractions))
    }
    const primaryLastInteraction = taskInteractions.findLast(
      (interaction) => interaction.surfaceRunId === session.target.surfaceRun.objectId
    )
    if (!primaryLastInteraction) {
      throw new Error('Observed session requires an applied primary-surface interaction')
    }
    const claim: ObservedHumanSessionClaim = session.scope
      ? {
          ...commonClaim,
          finalFamily: finalFamilyFor(session.scope, taskInteractions, finalFamilyDigest),
          finalSurfaceRevision: primaryLastInteraction.after.surfaceRevision,
          scope: structuredClone(session.scope),
          version: 2
        }
      : {
          ...commonClaim,
          finalSurfaceRevision: primaryLastInteraction.after.surfaceRevision
        }
    const issuedAt = new Date(this.runtime.now()).toISOString()
    const claimDigest = await digest(this.runtime.crypto, canonicalJson(claim))
    const signedPayload = canonicalJson({
      algorithm: PROOF_ALGORITHM,
      authorityRef: session.authorityRef,
      claim,
      claimDigest,
      interactionCount: taskInteractions.length,
      issuedAt,
      publicKey: session.publicKeyJwk,
      sessionId: session.sessionId,
      sessionStartedAt: session.startedAt,
      taskInteractions
    })
    const signature = await this.runtime.crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      session.privateKey,
      new TextEncoder().encode(signedPayload)
    )
    const unsignedProof = {
      algorithm: PROOF_ALGORITHM,
      authorityRef: session.authorityRef,
      claim: structuredClone(claim),
      claimDigest,
      interactionCount: taskInteractions.length,
      issuedAt,
      publicKey: structuredClone(session.publicKeyJwk),
      sessionId: session.sessionId,
      sessionStartedAt: session.startedAt,
      signature: bytesToBase64Url(new Uint8Array(signature)),
      taskInteractions
    }
    session.issuedProof = {
      ...unsignedProof,
      proofDigest: await digest(this.runtime.crypto, canonicalJson(unsignedProof))
    }
    session.status = 'issued'
    this.changed()
    return structuredClone(session.issuedProof)
  }

  async verify(
    proof: ObservedHumanSessionProof,
    expected: ObservedHumanSessionClaim | ObservedHumanReviewClaim
  ): Promise<LearningAttestation> {
    const session = this.session
    if (
      !session ||
      !['consumed', 'issued'].includes(session.status) ||
      !session.issuedProof ||
      proof.proofDigest !== session.issuedProof.proofDigest ||
      !claimMatchesExpected(proof.claim, expected)
    ) {
      throw new Error('Observed-session proof is not the proof issued for this exact review')
    }
    return verifyObservedHumanSessionProofCryptographically(proof, expected, this.runtime.crypto)
  }

  commit(proofDigest: string): void {
    const session = this.session
    if (!session?.issuedProof || session.issuedProof.proofDigest !== proofDigest) {
      throw new Error('Observed-session proof cannot be committed')
    }
    if (session.status === 'consumed') return
    if (session.status !== 'issued') {
      throw new Error('Observed-session proof cannot be committed')
    }
    session.status = 'consumed'
    this.changed()
  }

  abort(): ObservedHumanSessionState {
    this.expireSessionIfNeeded()
    const session = this.session
    if (!session || !['active', 'issued'].includes(session.status)) {
      throw new Error('No live observed session can be aborted')
    }
    session.status = 'aborted'
    return this.changed()
  }
}
