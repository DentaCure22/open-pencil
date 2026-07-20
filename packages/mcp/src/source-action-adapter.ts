import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { singleResolver } from './single-resolver'
import type {
  SourceActionAdapter,
  SourceActionAdapterOptions,
  SourceActionAuthorization,
  SourceApplyReceipt,
  SourceApplyRequest,
  SourceRollbackEvidence,
  SourceRollbackReceipt,
  SourceRollbackRequest,
  SourceVerificationEvidence,
  SourceVerificationProfile
} from './source-action-types'

export type {
  SourceActionAdapter,
  SourceActionAdapterOptions,
  SourceActionAuthorization,
  SourceApplyReceipt,
  SourceApplyRequest,
  SourceRollbackEvidence,
  SourceRollbackReceipt,
  SourceRollbackRequest,
  SourceVerificationEvidence,
  SourceVerificationKind,
  SourceVerificationProfile
} from './source-action-types'

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 20_000

type TransactionStatus = 'applied' | 'prepared' | 'rolled-back' | 'verified'

type PersistedTransaction = {
  afterHash: string
  applyReceipt?: SourceApplyReceipt
  backupFile: string
  beforeHash: string
  idempotencyDigest: string
  relativePath: string
  rollbackReceipt?: SourceRollbackReceipt
  scope: string
  status: TransactionStatus
  targetRef: string
  tokenHash: string
  version: 1
}

type ProcessResult = {
  exitCode: number | null
  resultDigest: string
  timedOut: boolean
  truncated: boolean
}

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function digestId(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObjectRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function isObjectRecord(value: unknown): value is { [key: string]: unknown } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stableDigest(value: unknown): string {
  return digest(canonicalJson(value))
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..')
}

function normalizeRelativePath(value: string): string {
  if (!value || isAbsolute(value) || value.includes('\\')) {
    throw new Error('Source path must be a non-empty portable relative path')
  }
  const normalized = value.replace(/^\.\//, '')
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Source path cannot contain empty, current, or parent segments')
  }
  return normalized
}

export function sourceWriteScope(relativePath: string): string {
  return `source:write:${normalizeRelativePath(relativePath)}`
}

export function sourceTargetRef(relativePath: string): string {
  return `source://${normalizeRelativePath(relativePath)}`
}

function requireUnique(values: string[], label: string): void {
  if (
    values.length === 0 ||
    new Set(values).size !== values.length ||
    values.some((value) => !value)
  ) {
    throw new Error(`${label} must contain unique values`)
  }
}

async function writeAtomic(path: string, value: string | Uint8Array, mode?: number): Promise<void> {
  const temporary = `${path}.openpencil-${randomUUID()}.tmp`
  await writeFile(temporary, value, mode === undefined ? undefined : { mode })
  if (mode !== undefined) await chmod(temporary, mode)
  await rename(temporary, path)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function runProcess(
  profile: SourceVerificationProfile,
  root: string,
  maxOutputBytes: number
): Promise<ProcessResult> {
  const cwd = resolve(root, profile.cwd ?? '.')
  if (!isInside(root, cwd)) throw new Error(`Verification profile ${profile.id} leaves the root`)
  const timeoutMs = Math.min(Math.max(profile.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), 120_000)
  return new Promise((resolveResult) => {
    const settle = singleResolver(resolveResult)
    const child = spawn(profile.command, profile.args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const output: Buffer[] = []
    let outputBytes = 0
    let timedOut = false
    let truncated = false
    const capture = (chunk: Buffer) => {
      if (outputBytes >= maxOutputBytes) {
        truncated = true
        return
      }
      const remaining = maxOutputBytes - outputBytes
      const captured = chunk.subarray(0, remaining)
      output.push(captured)
      outputBytes += captured.byteLength
      if (captured.byteLength < chunk.byteLength) truncated = true
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    child.once('error', (error) => {
      clearTimeout(timer)
      settle({
        exitCode: null,
        resultDigest: digest(error.message),
        timedOut,
        truncated
      })
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.once('close', (exitCode) => {
      clearTimeout(timer)
      settle({
        exitCode,
        resultDigest: digest(
          Buffer.concat([
            ...output,
            Buffer.from(`\nexit=${String(exitCode)};timeout=${String(timedOut)}`)
          ])
        ),
        timedOut,
        truncated
      })
    })
  })
}

async function requireRegularUtf8File(
  path: string,
  maxFileBytes: number
): Promise<{
  bytes: Buffer
  mode: number
}> {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Source target must be one existing regular file, not a link')
  }
  if (stat.size > maxFileBytes) throw new Error(`Source target exceeds ${maxFileBytes} bytes`)
  const bytes = await readFile(path)
  if (!Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) {
    throw new Error('Source target must be UTF-8 text')
  }
  return { bytes, mode: stat.mode }
}

function receiptWithDigest<T extends { receiptDigest: string }>(receipt: T): T {
  return { ...receipt, receiptDigest: stableDigest({ ...receipt, receiptDigest: '' }) }
}

export async function createSourceActionAdapter(
  options: SourceActionAdapterOptions
): Promise<SourceActionAdapter> {
  const root = await realpath(resolve(options.root))
  const stateRelative = normalizeRelativePath(
    options.stateDirectory ?? '.openpencil/source-actions'
  )
  const stateRoot = resolve(root, stateRelative)
  if (!isInside(root, stateRoot)) throw new Error('Source action state must stay inside the root')
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const profiles = new Map(options.verificationProfiles.map((profile) => [profile.id, profile]))
  const activePaths = new Set<string>()
  requireUnique(
    options.verificationProfiles.map((profile) => profile.id),
    'Verification profile IDs'
  )
  await Promise.all([
    mkdir(resolve(stateRoot, 'backups'), { recursive: true }),
    mkdir(resolve(stateRoot, 'idempotency'), { recursive: true }),
    mkdir(resolve(stateRoot, 'transactions'), { recursive: true })
  ])

  function paths(tokenHash: string, idempotencyDigest: string) {
    return {
      backup: resolve(stateRoot, 'backups', `${tokenHash}.bin`),
      idempotency: resolve(stateRoot, 'idempotency', `${idempotencyDigest}.json`),
      transaction: resolve(stateRoot, 'transactions', `${tokenHash}.json`)
    }
  }

  async function restore(
    transaction: PersistedTransaction,
    sourcePath: string,
    mode: number,
    reason: string
  ): Promise<SourceRollbackEvidence> {
    const backup = await readFile(resolve(stateRoot, transaction.backupFile))
    const current = await readFile(sourcePath)
    const currentHash = digest(current)
    if (currentHash !== transaction.afterHash) {
      throw new Error('Rollback refused because the source changed after the approved apply')
    }
    await writeAtomic(sourcePath, backup, mode)
    const restoredHash = digest(await readFile(sourcePath))
    if (restoredHash !== transaction.beforeHash) {
      throw new Error('Rollback verification failed: restored hash does not match the preimage')
    }
    return {
      afterHash: restoredHash,
      beforeHash: currentHash,
      reason,
      restoredAt: new Date().toISOString(),
      status: 'restored'
    }
  }

  async function idempotentApplyReceipt(key: string): Promise<SourceApplyReceipt | null> {
    const idempotencyDigest = digestId(key)
    const pointerPath = resolve(stateRoot, 'idempotency', `${idempotencyDigest}.json`)
    try {
      const pointer = await readJson<{ tokenHash: string }>(pointerPath)
      const transaction = await readJson<PersistedTransaction>(
        resolve(stateRoot, 'transactions', `${pointer.tokenHash}.json`)
      )
      if (!transaction.applyReceipt) throw new Error('Source transaction requires recovery')
      return transaction.applyReceipt
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      return null
    }
  }

  async function exactSourcePath(relativePath: string): Promise<string> {
    const sourcePath = resolve(root, relativePath)
    if (!isInside(root, sourcePath) || isInside(stateRoot, sourcePath)) {
      throw new Error('Source target is outside the writable source boundary')
    }
    const realSourcePath = await realpath(sourcePath)
    if (!isInside(root, realSourcePath) || realSourcePath !== sourcePath) {
      throw new Error('Source target must resolve directly inside the allowed root')
    }
    return sourcePath
  }

  function validateAuthorization(
    authorization: SourceActionAuthorization,
    scope: string,
    targetRef: string
  ): void {
    requireUnique(authorization.grantedScopes, 'Granted source scopes')
    const requiredText = [
      authorization.authorizedAt,
      authorization.authorizedBy,
      authorization.proposalId,
      authorization.stepId
    ]
    if (
      requiredText.some((value) => !value) ||
      authorization.targetRef !== targetRef ||
      !authorization.grantedScopes.includes(scope)
    ) {
      throw new Error(
        'Source apply lacks exact proposal, target, actor, or path scope authorization'
      )
    }
  }

  function verificationProfiles(ids: string[]): SourceVerificationProfile[] {
    requireUnique(ids, 'Verification profile IDs')
    const selected = ids.map((id) => {
      const profile = profiles.get(id)
      if (!profile) throw new Error(`Unknown verification profile ${id}`)
      return profile
    })
    const kinds = new Set(selected.map((profile) => profile.kind))
    if (!kinds.has('test') || !kinds.has('runtime')) {
      throw new Error('Source apply requires both focused test and runtime verification profiles')
    }
    return selected
  }

  async function prepareTransaction(input: {
    afterHash: string
    beforeHash: string
    bytes: Buffer
    idempotencyDigest: string
    relativePath: string
    scope: string
    targetRef: string
  }): Promise<{
    paths: ReturnType<typeof paths>
    rollbackToken: string
    transaction: PersistedTransaction
  }> {
    const rollbackToken = randomUUID()
    const tokenHash = digestId(rollbackToken)
    const transactionPaths = paths(tokenHash, input.idempotencyDigest)
    const transaction: PersistedTransaction = {
      afterHash: input.afterHash,
      backupFile: relative(stateRoot, transactionPaths.backup),
      beforeHash: input.beforeHash,
      idempotencyDigest: input.idempotencyDigest,
      relativePath: input.relativePath,
      scope: input.scope,
      status: 'prepared',
      targetRef: input.targetRef,
      tokenHash,
      version: 1
    }
    await writeFile(transactionPaths.backup, input.bytes, { flag: 'wx', mode: 0o600 })
    await writeJson(transactionPaths.transaction, transaction)
    await writeJson(transactionPaths.idempotency, { tokenHash })
    return { paths: transactionPaths, rollbackToken, transaction }
  }

  async function writeAuthorizedPayload(input: {
    afterHash: string
    bytes: Buffer
    mode: number
    path: string
    transaction: PersistedTransaction
    transactionPath: string
  }): Promise<void> {
    await writeAtomic(input.path, input.bytes, input.mode)
    const observedAfterHash = digest(await readFile(input.path))
    if (observedAfterHash !== input.afterHash) {
      throw new Error('Source apply verification failed: written hash does not match the payload')
    }
    input.transaction.status = 'applied'
    await writeJson(input.transactionPath, input.transaction)
  }

  async function runVerificationProfiles(
    selectedProfiles: SourceVerificationProfile[],
    receiptId: string,
    targetRef: string
  ): Promise<SourceVerificationEvidence[]> {
    const checks: SourceVerificationEvidence[] = []
    for (const profile of selectedProfiles) {
      const result = await runProcess(profile, root, maxOutputBytes)
      checks.push({
        command: [profile.command, ...profile.args].join(' '),
        evidenceRef: `source-action://${receiptId}/verification/${profile.id}`,
        exitCode: result.exitCode,
        id: profile.id,
        kind: profile.kind,
        observedAt: new Date().toISOString(),
        passed: result.exitCode === 0 && !result.timedOut,
        resultDigest: result.resultDigest,
        targetRef,
        timedOut: result.timedOut,
        truncated: result.truncated
      })
    }
    return checks
  }

  async function finishVerification(input: {
    checks: SourceVerificationEvidence[]
    mode: number
    sourcePath: string
    transaction: PersistedTransaction
  }): Promise<{
    automaticRollback?: SourceRollbackEvidence
    passed: boolean
  }> {
    const passed = input.checks.every((check) => check.passed)
    if (passed) {
      input.transaction.status = 'verified'
      return { passed }
    }
    const automaticRollback = await restore(
      input.transaction,
      input.sourcePath,
      input.mode,
      'Automatic rollback after failed source verification'
    )
    input.transaction.status = 'rolled-back'
    return { automaticRollback, passed }
  }

  async function applyUnlocked(request: SourceApplyRequest): Promise<SourceApplyReceipt> {
    if (!request.idempotencyKey) throw new Error('Source apply requires an idempotency key')
    const idempotencyDigest = digestId(request.idempotencyKey)
    const previousReceipt = await idempotentApplyReceipt(request.idempotencyKey)
    if (previousReceipt) return previousReceipt

    const relativePath = normalizeRelativePath(request.relativePath)
    const sourcePath = await exactSourcePath(relativePath)
    const scope = sourceWriteScope(relativePath)
    const targetRef = sourceTargetRef(relativePath)
    const authorization = request.authorization
    validateAuthorization(authorization, scope, targetRef)
    const nextBytes = Buffer.from(request.content, 'utf8')
    if (nextBytes.byteLength > maxFileBytes) {
      throw new Error(`Source payload exceeds ${maxFileBytes} bytes`)
    }
    const afterHash = digest(nextBytes)
    if (authorization.payloadDigest !== afterHash) {
      throw new Error('Source payload does not match the authorized digest')
    }
    const current = await requireRegularUtf8File(sourcePath, maxFileBytes)
    const beforeHash = digest(current.bytes)
    if (beforeHash !== authorization.expectedBeforeHash) {
      throw new Error('Source preimage hash changed after the proposal was authorized')
    }
    const selectedProfiles = verificationProfiles(request.verificationProfileIds)
    const prepared = await prepareTransaction({
      afterHash,
      beforeHash,
      bytes: current.bytes,
      idempotencyDigest,
      relativePath,
      scope,
      targetRef
    })
    await writeAuthorizedPayload({
      afterHash,
      bytes: nextBytes,
      mode: current.mode,
      path: sourcePath,
      transaction: prepared.transaction,
      transactionPath: prepared.paths.transaction
    })

    const receiptId = `source-apply_${digestId(
      `${authorization.proposalId}:${authorization.stepId}:${request.idempotencyKey}`
    ).slice(0, 24)}`
    const checks = await runVerificationProfiles(selectedProfiles, receiptId, targetRef)
    const verification = await finishVerification({
      checks,
      mode: current.mode,
      sourcePath,
      transaction: prepared.transaction
    })
    const baseReceipt: SourceApplyReceipt = {
      afterHash,
      appliedAt: new Date().toISOString(),
      authorityId: 'openpencil-local-source-adapter-v1',
      automaticRollback: verification.automaticRollback,
      beforeHash,
      checks,
      executionResult: {
        afterHash,
        beforeHash,
        status: 'applied',
        stepId: authorization.stepId,
        targetRef
      },
      idempotencyKey: request.idempotencyKey,
      immutable: true,
      proposalId: authorization.proposalId,
      receiptDigest: '',
      receiptId,
      relativePath,
      rollbackToken: verification.passed ? prepared.rollbackToken : undefined,
      status: verification.passed ? 'verified' : 'rolled-back',
      stepId: authorization.stepId,
      targetRef
    }
    prepared.transaction.applyReceipt = receiptWithDigest(baseReceipt)
    await writeJson(prepared.paths.transaction, prepared.transaction)
    return prepared.transaction.applyReceipt
  }

  async function apply(request: SourceApplyRequest): Promise<SourceApplyReceipt> {
    const relativePath = normalizeRelativePath(request.relativePath)
    if (activePaths.has(relativePath)) {
      throw new Error(`Source target ${relativePath} already has an active transaction`)
    }
    activePaths.add(relativePath)
    try {
      return await applyUnlocked({ ...request, relativePath })
    } finally {
      activePaths.delete(relativePath)
    }
  }

  async function rollback(request: SourceRollbackRequest): Promise<SourceRollbackReceipt> {
    if (!request.idempotencyKey || !request.reason || !request.actorId) {
      throw new Error('Source rollback requires actor, reason, and idempotency key')
    }
    const tokenHash = digestId(request.rollbackToken)
    const transactionPath = resolve(stateRoot, 'transactions', `${tokenHash}.json`)
    const transaction = await readJson<PersistedTransaction>(transactionPath)
    if (transaction.tokenHash !== tokenHash || !transaction.applyReceipt) {
      throw new Error('Source rollback token does not identify a completed apply')
    }
    if (transaction.rollbackReceipt) return transaction.rollbackReceipt
    if (transaction.status !== 'verified') {
      throw new Error('Only a currently verified source apply can be explicitly rolled back')
    }
    requireUnique(request.grantedScopes, 'Rollback granted scopes')
    if (!request.grantedScopes.includes(transaction.scope)) {
      throw new Error(`Source rollback is missing exact scope ${transaction.scope}`)
    }
    const sourcePath = resolve(root, transaction.relativePath)
    const current = await requireRegularUtf8File(sourcePath, maxFileBytes)
    const restored = await restore(transaction, sourcePath, current.mode, request.reason)
    const receiptId = `source-rollback_${digestId(
      `${transaction.applyReceipt.receiptId}:${request.idempotencyKey}`
    ).slice(0, 24)}`
    const baseReceipt: SourceRollbackReceipt = {
      actorId: request.actorId,
      authorityId: 'openpencil-local-source-adapter-v1',
      grantedScopes: [...request.grantedScopes],
      idempotencyKey: request.idempotencyKey,
      immutable: true,
      proposalId: transaction.applyReceipt.proposalId,
      reason: request.reason,
      receiptDigest: '',
      receiptId,
      restoredAt: restored.restoredAt,
      result: {
        afterHash: restored.afterHash,
        beforeHash: restored.beforeHash,
        status: 'restored',
        stepId: transaction.applyReceipt.stepId,
        targetRef: transaction.targetRef
      },
      status: 'restored',
      stepId: transaction.applyReceipt.stepId,
      targetRef: transaction.targetRef
    }
    transaction.rollbackReceipt = receiptWithDigest(baseReceipt)
    transaction.status = 'rolled-back'
    await writeJson(transactionPath, transaction)
    return transaction.rollbackReceipt
  }

  return { apply, rollback }
}
