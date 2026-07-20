import {
  ObservedHumanSessionAuthority,
  verifyPersistedObservedSessionAttestation,
  type ObservedHumanReviewClaim,
  type ObservedHumanSessionRuntime,
  type ObservedHumanSessionStartInput,
  type ObservedHumanTaskInteractionInput,
} from '@/app/human-sessions/authority'
import { describe, expect, test } from 'bun:test'

function runtime(overrides: Partial<ObservedHumanSessionRuntime> = {}) {
  let now = Date.parse('2026-07-14T20:00:00.000Z')
  let automated = false
  let nextScheduleId = 0
  const scheduled = new Map<number, { at: number; callback: () => void }>()
  const states: string[] = []
  const value: ObservedHumanSessionRuntime = {
    crypto,
    hasFocus: () => true,
    hasUserActivation: () => true,
    isAutomated: () => automated,
    isVisible: () => true,
    now: () => now,
    onStateChange: (state) => states.push(state.status),
    schedule: (callback, delayMs) => {
      const id = ++nextScheduleId
      scheduled.set(id, { at: now + delayMs, callback })
      return () => scheduled.delete(id)
    },
    ...overrides,
  }
  const nextDueTask = () => {
    let due: [number, { at: number; callback: () => void }] | undefined
    for (const entry of scheduled.entries()) {
      if (entry[1].at <= now && (!due || entry[1].at < due[1].at)) due = entry
    }
    return due
  }
  const runScheduled = () => {
    let due = nextDueTask()
    while (due) {
      scheduled.delete(due[0])
      due[1].callback()
      due = nextDueTask()
    }
  }
  return {
    advance: (milliseconds: number) => {
      now += milliseconds
      runScheduled()
    },
    runtime: value,
    setAutomated: (next: boolean) => {
      automated = next
    },
    states,
  }
}

function startInput(): ObservedHumanSessionStartInput {
  return {
    actorId: 'participant-01',
    dataPolicy: 'phi-free-declared-v1',
    fieldSessionId: 'field-session_participant-01',
    target: {
      artifact: {
        artifactId: 'surface-run_verified-session',
        boardId: 'html-board_verified-session',
        boardRevision: 3,
        boardSchemaVersion: 4,
        kind: 'html-board',
        sourceHash: 'fnv1a-field-session',
      },
      evidenceManifest: { objectId: 'evidence_verified-session', revision: 1 },
      intent: { objectId: 'intent_verified-session', revision: 1 },
      surfaceRun: { objectId: 'surface-run_verified-session', revision: 2 },
    },
  }
}

function taskInteraction(
  overrides: Partial<ObservedHumanTaskInteractionInput> = {}
): ObservedHumanTaskInteractionInput {
  return {
    after: { artifactRevision: 4, surfaceRevision: 3 },
    before: { artifactRevision: 3, surfaceRevision: 2 },
    eventId: 'task-event_focus-record',
    frameId: 'html-board_verified-session',
    kind: 'pointerdown',
    occurredAt: '2026-07-14T20:00:01.000Z',
    surfaceRunId: 'surface-run_verified-session',
    ...overrides,
  }
}

function reviewClaim(): ObservedHumanReviewClaim {
  return {
    actorId: 'participant-01',
    decisionReceiptId: 'decision-receipt_verified-session',
    occurredAt: '2026-07-14T20:00:03.000Z',
    recordedAt: '2026-07-14T20:00:04.000Z',
    reviewDigest: 'sha256:review-outcome',
    runId: 'verified-session-run',
    surfaceRunId: 'surface-run_verified-session',
  }
}

function familyStartInput(): ObservedHumanSessionStartInput {
  const primary = startInput().target
  const support = {
    artifact: {
      artifactId: 'surface-run_verified-support',
      boardId: 'html-board_verified-support',
      boardRevision: 5,
      boardSchemaVersion: 4,
      kind: 'html-board' as const,
      sourceHash: 'fnv1a-field-support',
    },
    formKind: 'evidence-brief' as const,
    instanceId: 'support-1',
    relation: { relationId: 'relation_verified-support', revision: 1 },
    rendererId: 'evidence-brief-v1',
    role: 'support' as const,
    surfaceIndex: 1,
    surfaceRun: { objectId: 'surface-run_verified-support', revision: 4 },
  }
  const family = {
    complete: true as const,
    compositionId: 'composition_verified-family',
    evidenceManifest: primary.evidenceManifest,
    familyDigest: 'fnv1a-start-family',
    intent: primary.intent,
    members: [
      {
        artifact: primary.artifact,
        formKind: 'record-explorer' as const,
        instanceId: 'primary-1',
        rendererId: 'record-explorer-v1',
        role: 'primary' as const,
        surfaceIndex: 0,
        surfaceRun: primary.surfaceRun,
      },
      support,
    ],
    primary: {
      artifact: primary.artifact,
      formKind: 'record-explorer' as const,
      instanceId: 'primary-1',
      rendererId: 'record-explorer-v1',
      role: 'primary' as const,
      surfaceIndex: 0,
      surfaceRun: primary.surfaceRun,
    },
    recipeDigest: 'fnv1a-family-recipe',
    relations: [support.relation],
    schemaVersion: 1 as const,
    supports: [support],
    surfaceCount: 2,
  }
  return {
    ...startInput(),
    scope: { family, kind: 'experience-family', schemaVersion: 1 },
  }
}

describe('Observed human session authority', () => {
  test('requires and signs trusted applied use of every exact family member', async () => {
    const environment = runtime()
    const authority = new ObservedHumanSessionAuthority(environment.runtime)
    const input = familyStartInput()
    const started = await authority.start(input)
    expect(started).toMatchObject({
      familyMemberCount: 2,
      familyMembersUsed: 0,
      status: 'active',
    })

    environment.advance(1_000)
    authority.recordTaskInteraction(taskInteraction())
    environment.advance(3_000)
    expect(authority.state()).toMatchObject({
      familyMembersUsed: 1,
      status: 'active',
    })
    await expect(
      authority.issue({
        ...reviewClaim(),
        finalFamilyDigest: 'fnv1a-final-family',
      })
    ).rejects.toThrow('one applied interaction per member')

    authority.recordTaskInteraction(
      taskInteraction({
        after: { artifactRevision: 6, surfaceRevision: 5 },
        before: { artifactRevision: 5, surfaceRevision: 4 },
        eventId: 'task-event_support',
        frameId: 'html-board_verified-support',
        occurredAt: '2026-07-14T20:00:04.000Z',
        surfaceRunId: 'surface-run_verified-support',
      })
    )
    expect(authority.state()).toMatchObject({
      familyMembersUsed: 2,
      status: 'ready',
    })
    const proof = await authority.issue({
      ...reviewClaim(),
      occurredAt: '2026-07-14T20:00:05.000Z',
      finalFamilyDigest: 'fnv1a-final-family',
    })
    expect(proof.authorityRef).toContain('openpencil-local-observer-v2:')
    expect(proof.claim).toMatchObject({
      finalFamily: {
        familyDigest: 'fnv1a-final-family',
        members: [
          {
            finalArtifactRevision: 4,
            finalSurfaceRevision: 3,
            surfaceRunId: 'surface-run_verified-session',
            taskInteractionCount: 1,
          },
          {
            finalArtifactRevision: 6,
            finalSurfaceRevision: 5,
            surfaceRunId: 'surface-run_verified-support',
            taskInteractionCount: 1,
          },
        ],
      },
      version: 2,
    })
    expect((await authority.verify(proof, proof.claim)).proofDigest).toBe(
      proof.proofDigest
    )
  })

  test('signs one exact PHI-free target with ordered applied task evidence', async () => {
    const environment = runtime()
    const authority = new ObservedHumanSessionAuthority(environment.runtime)

    const started = await authority.start(startInput())
    expect(started).toMatchObject({
      actorId: 'participant-01',
      fieldSessionId: 'field-session_participant-01',
      interactionCount: 0,
      status: 'active',
      target: startInput().target,
    })
    environment.advance(1_000)
    authority.recordTaskInteraction(taskInteraction())
    environment.advance(3_000)
    expect(authority.state()).toMatchObject({
      interactionCount: 1,
      status: 'ready',
    })
    expect(environment.states).toContain('ready')

    const proof = await authority.issue(reviewClaim())
    const attestation = await authority.verify(proof, proof.claim)
    const retriedProof = await authority.issue(reviewClaim())
    expect(retriedProof).toEqual(proof)
    expect(
      (await authority.verify(retriedProof, retriedProof.claim)).proofDigest
    ).toBe(proof.proofDigest)
    const serializedAttestation = JSON.stringify(attestation)
    expect(typeof serializedAttestation).toBe('string')
    const persistedAttestation = JSON.parse(
      serializedAttestation
    ) as typeof attestation
    const reverified = await verifyPersistedObservedSessionAttestation(
      persistedAttestation,
      proof.claim,
      crypto
    )
    expect(proof.claim).toMatchObject({
      dataPolicy: 'phi-free-declared-v1',
      fieldSessionId: 'field-session_participant-01',
      finalSurfaceRevision: 3,
      target: startInput().target,
      taskInteractionCount: 1,
    })
    expect(proof.claim.taskInteractionDigest).toMatch(/^sha256:/)
    expect(proof.taskInteractions).toEqual([taskInteraction()])
    expect(attestation.proof?.taskInteractions).toEqual([taskInteraction()])
    expect(reverified.proofDigest).toBe(proof.proofDigest)

    if (!persistedAttestation.proof)
      throw new Error('Expected durable proof material')
    const tamperedInteraction = {
      ...persistedAttestation,
      proof: {
        ...persistedAttestation.proof,
        taskInteractions: persistedAttestation.proof.taskInteractions.map(
          (interaction, index) =>
            index === 0
              ? { ...interaction, eventId: 'task-event_replayed' }
              : interaction
        ),
      },
    }
    await expect(
      verifyPersistedObservedSessionAttestation(
        tamperedInteraction,
        proof.claim,
        crypto
      )
    ).rejects.toThrow('cryptographic or session verification')

    const swappedTarget = {
      ...proof.claim,
      target: {
        ...proof.claim.target,
        surfaceRun: {
          ...proof.claim.target.surfaceRun,
          objectId: 'surface-run_other',
        },
      },
    }
    await expect(
      verifyPersistedObservedSessionAttestation(
        persistedAttestation,
        swappedTarget,
        crypto
      )
    ).rejects.toThrow('cryptographic or session verification')

    authority.commit(proof.proofDigest)
    authority.commit(proof.proofDigest)
    expect(authority.state().status).toBe('consumed')
    expect((await authority.verify(proof, proof.claim)).proofDigest).toBe(
      proof.proofDigest
    )
  })

  test('refuses automation, unscoped presence, cross-target events, and replayed event ids', async () => {
    const automated = runtime({ isAutomated: () => true })
    const blocked = new ObservedHumanSessionAuthority(automated.runtime)
    await expect(blocked.start(startInput())).rejects.toThrow(
      'Automated browser environments'
    )

    const environment = runtime()
    const authority = new ObservedHumanSessionAuthority(environment.runtime)
    await authority.start(startInput())
    environment.advance(4_000)
    await expect(authority.issue(reviewClaim())).rejects.toThrow(
      'one applied task interaction'
    )
    expect(() =>
      authority.recordTaskInteraction(
        taskInteraction({ surfaceRunId: 'surface-run_other' })
      )
    ).toThrow('task-target')

    authority.recordTaskInteraction(taskInteraction())
    expect(() => authority.recordTaskInteraction(taskInteraction())).toThrow(
      'already recorded'
    )
    const proof = await authority.issue(reviewClaim())
    await expect(
      authority.verify(proof, {
        ...reviewClaim(),
        surfaceRunId: 'surface-run_other',
      })
    ).rejects.toThrow('exact review')
    await expect(
      authority.verify(
        { ...proof, proofDigest: 'sha256:tampered' },
        proof.claim
      )
    ).rejects.toThrow('exact review')
    await expect(
      authority.issue({
        ...reviewClaim(),
        reviewDigest: 'sha256:changed-review',
      })
    ).rejects.toThrow('different review')
  })

  test('expires, aborts, and restarts without admitting stale task proof', async () => {
    const expiredEnvironment = runtime()
    const expiredAuthority = new ObservedHumanSessionAuthority(
      expiredEnvironment.runtime
    )
    const first = await expiredAuthority.start(startInput())
    await expect(expiredAuthority.start(startInput())).rejects.toThrow(
      'Finish or abort'
    )

    expiredEnvironment.advance(30 * 60 * 1_000 + 1)
    expect(expiredAuthority.state()).toMatchObject({
      expiresAt: '2026-07-14T20:30:00.000Z',
      status: 'expired',
    })
    expect(expiredEnvironment.states.at(-1)).toBe('expired')
    expect(() =>
      expiredAuthority.recordTaskInteraction(taskInteraction())
    ).toThrow('No active observed session')
    await expect(expiredAuthority.issue(reviewClaim())).rejects.toThrow(
      'one applied task'
    )
    const restarted = await expiredAuthority.start(startInput())
    expect(restarted.sessionId).not.toBe(first.sessionId)
    expect(restarted.status).toBe('active')

    const abortEnvironment = runtime()
    const abortAuthority = new ObservedHumanSessionAuthority(
      abortEnvironment.runtime
    )
    await abortAuthority.start(startInput())
    abortEnvironment.advance(1_000)
    abortAuthority.recordTaskInteraction(taskInteraction())
    abortEnvironment.advance(3_000)
    const proof = await abortAuthority.issue(reviewClaim())
    await expect(abortAuthority.start(startInput())).rejects.toThrow(
      'Finish or abort'
    )
    expect(abortAuthority.abort().status).toBe('aborted')
    await expect(abortAuthority.verify(proof, proof.claim)).rejects.toThrow(
      'exact review'
    )
    expect(() => abortAuthority.commit(proof.proofDigest)).toThrow(
      'cannot be committed'
    )
    expect((await abortAuthority.start(startInput())).status).toBe('active')
  })
})
