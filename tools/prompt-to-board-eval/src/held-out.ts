import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'
import { appendFile, open, readFile, rm } from 'node:fs/promises'

import {
  parseScenarioManifest,
  type PromptToBoardScenario,
  type ScenarioManifest,
  type ScenarioSplit
} from './scenario-manifest'

export const SEALED_HELD_OUT_BUNDLE_VERSION = 'prompt-to-board-sealed-held-out/v1' as const
export const OPTIMIZER_HELD_OUT_MANIFEST_VERSION = 'prompt-to-board-optimizer-held-out/v1' as const
export const HELD_OUT_REVEAL_LEDGER_VERSION = 'prompt-to-board-held-out-reveal-ledger/v1' as const

const ALGORITHM = 'aes-256-gcm' as const
const KEY_BYTES = 32
const IV_BYTES = 12
const LEDGER_CODE_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u
const PROTECTED_SPLITS = new Set<ScenarioSplit>(['held_out', 'adversarial', 'probe'])

export interface HeldOutScenarioMaterial {
  cohort_id: string
  fixture: unknown
  reserve_rank: number
  rubric: unknown
  scenario: PromptToBoardScenario
}

interface SealedHeldOutPayload {
  materials: HeldOutScenarioMaterial[]
  revision: number
  schema_version: typeof SEALED_HELD_OUT_BUNDLE_VERSION
}

export interface SealedHeldOutBundle {
  algorithm: typeof ALGORITHM
  auth_tag_base64: string
  bundle_id: string
  ciphertext_base64: string
  iv_base64: string
  revision: number
  scenario_index_hash: string
  schema_version: typeof SEALED_HELD_OUT_BUNDLE_VERSION
}

export interface OptimizerHeldOutScenario {
  cohort_id: string
  reserve_rank: number
  scenario_id: string
  split: ScenarioSplit
}

export interface OptimizerHeldOutManifest {
  bundle_id: string
  manifest_id: string
  revision: number
  scenario_index_hash: string
  scenarios: OptimizerHeldOutScenario[]
  schema_version: typeof OPTIMIZER_HELD_OUT_MANIFEST_VERSION
}

export interface HeldOutRevealLedgerRecord {
  action: 'reserve_promoted' | 'reveal_and_retire'
  actor_id: string
  bundle_id: string
  event_id: string
  observed_at_ms: number
  previous_record_hash: string | null
  reason: string
  record_hash: string
  replacement_scenario_id: string | null
  scenario_id: string
  schema_version: typeof HELD_OUT_REVEAL_LEDGER_VERSION
  sequence: number
}

export interface SealHeldOutBundleResult {
  bundle: SealedHeldOutBundle
  optimizer_manifest: OptimizerHeldOutManifest
}

export interface RevealHeldOutScenarioOptions {
  actorId: string
  bundle: SealedHeldOutBundle
  key: Uint8Array
  ledgerPath: string
  optimizerManifest: OptimizerHeldOutManifest
  reason: string
  scenarioId: string
}

export interface RevealedHeldOutScenario {
  ledger_record: HeldOutRevealLedgerRecord
  material: HeldOutScenarioMaterial
  scenario_manifest: ScenarioManifest
}

export interface PromoteHeldOutReserveOptions {
  actorId: string
  bundle: SealedHeldOutBundle
  ledgerPath: string
  optimizerManifest: OptimizerHeldOutManifest
  reason: string
  retiredScenarioId: string
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)])
  )
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function nonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string.`)
}

function ledgerCode(value: string, label: string): void {
  if (!LEDGER_CODE_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase machine-safe code.`)
  }
}

function assertKey(key: Uint8Array): void {
  if (key.byteLength !== KEY_BYTES) {
    throw new Error(`Held-out encryption key must be ${KEY_BYTES} bytes.`)
  }
}

function bundleAddressFields(bundle: Omit<SealedHeldOutBundle, 'bundle_id'>): object {
  return {
    algorithm: bundle.algorithm,
    auth_tag_base64: bundle.auth_tag_base64,
    ciphertext_base64: bundle.ciphertext_base64,
    iv_base64: bundle.iv_base64,
    revision: bundle.revision,
    scenario_index_hash: bundle.scenario_index_hash,
    schema_version: bundle.schema_version
  }
}

function expectedBundleId(bundle: Omit<SealedHeldOutBundle, 'bundle_id'>): string {
  return sha256(stableJson(bundleAddressFields(bundle)))
}

function validateMaterials(materials: HeldOutScenarioMaterial[], revision: number): void {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error('Held-out bundle revision must be a positive integer.')
  }
  if (materials.length === 0) throw new Error('Held-out bundle must contain scenarios.')

  parseScenarioManifest({
    manifest_id: 'sealed-held-out-source-validation',
    revision,
    scenarios: materials.map(({ scenario }) => scenario),
    schema_version: 'prompt-to-board-scenario-manifest/v1'
  })

  const ids = new Set<string>()
  const cohortRanks = new Set<string>()
  const primaryCohorts = new Set<string>()
  for (const material of materials) {
    nonEmpty(material.cohort_id, 'Held-out cohort_id')
    if (!PROTECTED_SPLITS.has(material.scenario.split)) {
      throw new Error(`Scenario ${material.scenario.scenario_id} is not in a protected split.`)
    }
    if (!Number.isInteger(material.reserve_rank) || material.reserve_rank < 0) {
      throw new Error('Held-out reserve_rank must be a non-negative integer.')
    }
    if (ids.has(material.scenario.scenario_id)) {
      throw new Error(`Duplicate held-out scenario_id: ${material.scenario.scenario_id}.`)
    }
    ids.add(material.scenario.scenario_id)
    const rankKey = `${material.cohort_id}\u0000${material.reserve_rank}`
    if (cohortRanks.has(rankKey)) {
      throw new Error(
        `Held-out cohort ${material.cohort_id} has duplicate rank ${material.reserve_rank}.`
      )
    }
    cohortRanks.add(rankKey)
    if (material.reserve_rank === 0) primaryCohorts.add(material.cohort_id)
  }
  for (const material of materials) {
    if (!primaryCohorts.has(material.cohort_id)) {
      throw new Error(`Held-out cohort ${material.cohort_id} has no rank-0 primary.`)
    }
  }
}

export function generateHeldOutEncryptionKey(): Uint8Array {
  return randomBytes(KEY_BYTES)
}

export function sealHeldOutBundle(
  materials: HeldOutScenarioMaterial[],
  revision: number,
  key: Uint8Array
): SealHeldOutBundleResult {
  assertKey(key)
  validateMaterials(materials, revision)
  const payload: SealedHeldOutPayload = {
    materials: structuredClone(materials),
    revision,
    schema_version: SEALED_HELD_OUT_BUNDLE_VERSION
  }
  const iv = randomBytes(IV_BYTES)
  const scenarioIndex = materials
    .map(({ cohort_id, reserve_rank, scenario }) => ({
      cohort_id,
      reserve_rank,
      scenario_id: scenario.scenario_id,
      split: scenario.split
    }))
    .sort((left, right) =>
      left.cohort_id === right.cohort_id
        ? left.reserve_rank - right.reserve_rank
        : left.cohort_id.localeCompare(right.cohort_id)
    )
  const scenarioIndexHash = sha256(stableJson(scenarioIndex))
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(stableJson(payload), 'utf8'), cipher.final()])
  const addressFields = {
    algorithm: ALGORITHM,
    auth_tag_base64: cipher.getAuthTag().toString('base64'),
    ciphertext_base64: ciphertext.toString('base64'),
    iv_base64: iv.toString('base64'),
    revision,
    scenario_index_hash: scenarioIndexHash,
    schema_version: SEALED_HELD_OUT_BUNDLE_VERSION
  } satisfies Omit<SealedHeldOutBundle, 'bundle_id'>
  const bundle: SealedHeldOutBundle = {
    ...addressFields,
    bundle_id: expectedBundleId(addressFields)
  }
  const optimizerManifest: OptimizerHeldOutManifest = {
    bundle_id: bundle.bundle_id,
    manifest_id: `optimizer-held-out:${bundle.bundle_id}`,
    revision,
    scenario_index_hash: scenarioIndexHash,
    scenarios: scenarioIndex,
    schema_version: OPTIMIZER_HELD_OUT_MANIFEST_VERSION
  }
  return { bundle, optimizer_manifest: optimizerManifest }
}

function parseBundle(bundle: SealedHeldOutBundle): void {
  if (bundle.schema_version !== SEALED_HELD_OUT_BUNDLE_VERSION) {
    throw new Error('Unsupported sealed held-out bundle schema.')
  }
  if (bundle.algorithm !== ALGORITHM) throw new Error('Unsupported held-out encryption algorithm.')
  if (bundle.bundle_id !== expectedBundleId(bundle)) {
    throw new Error('Sealed held-out bundle address does not match its contents.')
  }
}

function decryptBundle(bundle: SealedHeldOutBundle, key: Uint8Array): SealedHeldOutPayload {
  assertKey(key)
  parseBundle(bundle)
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(bundle.iv_base64, 'base64'))
    decipher.setAuthTag(Buffer.from(bundle.auth_tag_base64, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(bundle.ciphertext_base64, 'base64')),
      decipher.final()
    ]).toString('utf8')
    const payload = JSON.parse(plaintext) as SealedHeldOutPayload
    if (
      payload.schema_version !== SEALED_HELD_OUT_BUNDLE_VERSION ||
      payload.revision !== bundle.revision
    ) {
      throw new Error('Decrypted held-out payload metadata does not match its bundle.')
    }
    validateMaterials(payload.materials, payload.revision)
    return payload
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Decrypted held-out')) throw error
    throw new Error('Held-out bundle could not be authenticated and decrypted.')
  }
}

function recordHash(record: Omit<HeldOutRevealLedgerRecord, 'record_hash'>): string {
  return sha256(stableJson(record))
}

export async function readHeldOutRevealLedger(
  ledgerPath: string
): Promise<HeldOutRevealLedgerRecord[]> {
  let text: string
  try {
    text = await readFile(ledgerPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const records = text
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as HeldOutRevealLedgerRecord)
  let previous: HeldOutRevealLedgerRecord | undefined
  for (const record of records) {
    if (record.schema_version !== HELD_OUT_REVEAL_LEDGER_VERSION) {
      throw new Error('Held-out reveal ledger has an unsupported schema.')
    }
    if (record.sequence !== (previous?.sequence ?? 0) + 1) {
      throw new Error('Held-out reveal ledger sequence is invalid.')
    }
    if (record.previous_record_hash !== (previous?.record_hash ?? null)) {
      throw new Error('Held-out reveal ledger hash chain is invalid.')
    }
    const { record_hash: actualHash, ...hashInput } = record
    const expectedHash = recordHash(hashInput)
    const actualBytes = Buffer.from(actualHash, 'hex')
    const expectedBytes = Buffer.from(expectedHash, 'hex')
    if (
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      throw new Error('Held-out reveal ledger record hash is invalid.')
    }
    previous = record
  }
  return records
}

async function withLedgerLock<T>(ledgerPath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${ledgerPath}.lock`
  let lock
  try {
    lock = await open(lockPath, 'wx')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Held-out reveal ledger is busy; retry without revealing content.')
    }
    throw error
  }
  try {
    return await operation()
  } finally {
    await lock.close()
    await rm(lockPath, { force: true })
  }
}

async function appendLedgerRecord(
  ledgerPath: string,
  createInput: (
    records: HeldOutRevealLedgerRecord[]
  ) => Omit<
    HeldOutRevealLedgerRecord,
    'previous_record_hash' | 'record_hash' | 'schema_version' | 'sequence'
  >
): Promise<HeldOutRevealLedgerRecord> {
  return withLedgerLock(ledgerPath, async () => {
    const records = await readHeldOutRevealLedger(ledgerPath)
    const input = createInput(records)
    const previous = records.at(-1)
    const hashInput = {
      ...input,
      previous_record_hash: previous?.record_hash ?? null,
      schema_version: HELD_OUT_REVEAL_LEDGER_VERSION,
      sequence: (previous?.sequence ?? 0) + 1
    } satisfies Omit<HeldOutRevealLedgerRecord, 'record_hash'>
    const record: HeldOutRevealLedgerRecord = {
      ...hashInput,
      record_hash: recordHash(hashInput)
    }
    await appendFile(ledgerPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' })
    return record
  })
}

function assertManifestMatchesBundle(
  manifest: OptimizerHeldOutManifest,
  bundle: SealedHeldOutBundle
): void {
  if (manifest.schema_version !== OPTIMIZER_HELD_OUT_MANIFEST_VERSION) {
    throw new Error('Unsupported optimizer held-out manifest schema.')
  }
  if (manifest.bundle_id !== bundle.bundle_id || manifest.revision !== bundle.revision) {
    throw new Error('Optimizer held-out manifest does not match the sealed bundle.')
  }
  const actualIndexHash = sha256(stableJson(manifest.scenarios))
  if (
    manifest.scenario_index_hash !== bundle.scenario_index_hash ||
    actualIndexHash !== bundle.scenario_index_hash
  ) {
    throw new Error('Optimizer held-out manifest index does not match the sealed bundle.')
  }
}

function assertManifestMatchesPayload(
  manifest: OptimizerHeldOutManifest,
  payload: SealedHeldOutPayload
): void {
  const expected = payload.materials
    .map(({ cohort_id, reserve_rank, scenario }) => ({
      cohort_id,
      reserve_rank,
      scenario_id: scenario.scenario_id,
      split: scenario.split
    }))
    .sort((left, right) => left.scenario_id.localeCompare(right.scenario_id))
  const actual = structuredClone(manifest.scenarios).sort((left, right) =>
    left.scenario_id.localeCompare(right.scenario_id)
  )
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error('Optimizer held-out manifest descriptors do not match the sealed payload.')
  }
}

function eventId(): string {
  return randomBytes(16).toString('hex')
}

export async function revealHeldOutScenarioOnce(
  options: RevealHeldOutScenarioOptions
): Promise<RevealedHeldOutScenario> {
  ledgerCode(options.actorId, 'Held-out reveal actorId')
  ledgerCode(options.reason, 'Held-out reveal reason')
  assertManifestMatchesBundle(options.optimizerManifest, options.bundle)
  const descriptor = options.optimizerManifest.scenarios.find(
    ({ scenario_id }) => scenario_id === options.scenarioId
  )
  if (!descriptor) throw new Error(`Unknown held-out scenario: ${options.scenarioId}.`)
  const revealedMaterials: HeldOutScenarioMaterial[] = []

  const record = await appendLedgerRecord(options.ledgerPath, (records) => {
    if (
      records.some(
        (record) =>
          record.bundle_id === options.bundle.bundle_id &&
          record.scenario_id === options.scenarioId &&
          record.action === 'reveal_and_retire'
      )
    ) {
      throw new Error(`Held-out scenario ${options.scenarioId} has already been revealed.`)
    }
    if (
      descriptor.reserve_rank > 0 &&
      !records.some(
        (candidate) =>
          candidate.bundle_id === options.bundle.bundle_id &&
          candidate.action === 'reserve_promoted' &&
          candidate.replacement_scenario_id === options.scenarioId
      )
    ) {
      throw new Error(`Held-out reserve ${options.scenarioId} has not been promoted.`)
    }
    const payload = decryptBundle(options.bundle, options.key)
    assertManifestMatchesPayload(options.optimizerManifest, payload)
    const material =
      payload.materials.find(({ scenario }) => scenario.scenario_id === options.scenarioId) ?? null
    if (!material) throw new Error(`Sealed bundle is missing scenario ${options.scenarioId}.`)
    revealedMaterials.push(material)
    return {
      action: 'reveal_and_retire',
      actor_id: options.actorId,
      bundle_id: options.bundle.bundle_id,
      event_id: eventId(),
      observed_at_ms: Date.now(),
      reason: options.reason,
      replacement_scenario_id: null,
      scenario_id: options.scenarioId
    }
  })
  const material = revealedMaterials.at(0)
  if (!material) throw new Error('Held-out scenario was retired without revealing its material.')
  const scenarioManifest = parseScenarioManifest({
    manifest_id: `revealed:${options.bundle.bundle_id}:${options.scenarioId}`,
    revision: options.bundle.revision,
    scenarios: [material.scenario],
    schema_version: 'prompt-to-board-scenario-manifest/v1'
  })
  return { ledger_record: record, material, scenario_manifest: scenarioManifest }
}

export async function promoteHeldOutReserve(
  options: PromoteHeldOutReserveOptions
): Promise<HeldOutRevealLedgerRecord> {
  ledgerCode(options.actorId, 'Held-out promotion actorId')
  ledgerCode(options.reason, 'Held-out promotion reason')
  assertManifestMatchesBundle(options.optimizerManifest, options.bundle)
  const descriptors = options.optimizerManifest.scenarios
  const retired = descriptors.find(({ scenario_id }) => scenario_id === options.retiredScenarioId)
  if (!retired) throw new Error(`Unknown retired held-out scenario: ${options.retiredScenarioId}.`)

  return appendLedgerRecord(options.ledgerPath, (records) => {
    const wasRetired = records.some(
      (record) =>
        record.bundle_id === options.optimizerManifest.bundle_id &&
        record.scenario_id === options.retiredScenarioId &&
        record.action === 'reveal_and_retire'
    )
    if (!wasRetired) throw new Error('A held-out scenario must be revealed and retired first.')
    if (
      records.some(
        (record) =>
          record.bundle_id === options.optimizerManifest.bundle_id &&
          record.scenario_id === options.retiredScenarioId &&
          record.action === 'reserve_promoted'
      )
    ) {
      throw new Error(`Held-out scenario ${options.retiredScenarioId} already has a replacement.`)
    }
    const unavailable = new Set<string>()
    for (const record of records) {
      if (record.bundle_id !== options.optimizerManifest.bundle_id) continue
      unavailable.add(record.scenario_id)
      if (record.replacement_scenario_id) unavailable.add(record.replacement_scenario_id)
    }
    const replacement = descriptors
      .filter(
        (candidate) =>
          candidate.cohort_id === retired.cohort_id &&
          candidate.reserve_rank > retired.reserve_rank &&
          !unavailable.has(candidate.scenario_id)
      )
      .sort((left, right) => left.reserve_rank - right.reserve_rank)[0]
    if (!replacement) throw new Error(`Held-out cohort ${retired.cohort_id} has no reserve left.`)
    return {
      action: 'reserve_promoted',
      actor_id: options.actorId,
      bundle_id: options.optimizerManifest.bundle_id,
      event_id: eventId(),
      observed_at_ms: Date.now(),
      reason: options.reason,
      replacement_scenario_id: replacement.scenario_id,
      scenario_id: options.retiredScenarioId
    }
  })
}
