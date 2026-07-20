import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createSourceActionAdapter,
  sourceTargetRef,
  sourceWriteScope
} from '#mcp/source-action-adapter'
import type {
  SourceActionAdapter,
  SourceApplyRequest,
  SourceVerificationProfile
} from '#mcp/source-action-adapter'

const ORIGINAL_SOURCE = "export const value = () => 'v1'\n"
const UPDATED_SOURCE = "export const value = () => 'v2'\n"

const roots: string[] = []

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function profiles(runtimeExpectation = 'v2'): SourceVerificationProfile[] {
  return [
    {
      args: [
        '-e',
        "import { readFileSync } from 'node:fs'; if (!readFileSync('src/feature.mjs', 'utf8').includes(\"'v2'\")) process.exit(1)"
      ],
      command: process.execPath,
      id: 'focused-source-test',
      kind: 'test'
    },
    {
      args: [
        '-e',
        `const module = await import('./src/feature.mjs?runtime=' + Date.now()); if (module.value() !== '${runtimeExpectation}') process.exit(1)`
      ],
      command: process.execPath,
      id: 'runtime-behavior-probe',
      kind: 'runtime'
    }
  ]
}

async function fixture(runtimeExpectation = 'v2'): Promise<{
  adapter: SourceActionAdapter
  request: SourceApplyRequest
  root: string
  sourcePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'openpencil-source-action-'))
  roots.push(root)
  const sourcePath = join(root, 'src', 'feature.mjs')
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(sourcePath, ORIGINAL_SOURCE)
  const adapter = await createSourceActionAdapter({
    root,
    verificationProfiles: profiles(runtimeExpectation)
  })
  const relativePath = 'src/feature.mjs'
  const request: SourceApplyRequest = {
    authorization: {
      authorizedAt: '2026-07-14T19:00:00.000Z',
      authorizedBy: 'test-owner',
      expectedBeforeHash: digest(ORIGINAL_SOURCE),
      grantedScopes: [sourceWriteScope(relativePath)],
      payloadDigest: digest(UPDATED_SOURCE),
      proposalId: 'action-proposal_source-adapter',
      stepId: 'step-source-update',
      targetRef: sourceTargetRef(relativePath)
    },
    content: UPDATED_SOURCE,
    idempotencyKey: 'apply-source-adapter-v1',
    relativePath,
    verificationProfileIds: ['focused-source-test', 'runtime-behavior-probe']
  }
  return { adapter, request, root, sourcePath }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('Bounded source action adapter', () => {
  test('applies one exact authorized file, proves checks and runtime, then restores the preimage', async () => {
    const { adapter, request, sourcePath } = await fixture()
    const applied = await adapter.apply(request)

    expect(applied).toMatchObject({
      beforeHash: digest(ORIGINAL_SOURCE),
      afterHash: digest(UPDATED_SOURCE),
      authorityId: 'openpencil-local-source-adapter-v1',
      immutable: true,
      proposalId: request.authorization.proposalId,
      status: 'verified',
      targetRef: request.authorization.targetRef
    })
    expect(applied.checks.map((check) => [check.kind, check.passed])).toEqual([
      ['test', true],
      ['runtime', true]
    ])
    expect(applied.rollbackToken).toBeString()
    expect(await readFile(sourcePath, 'utf8')).toBe(UPDATED_SOURCE)
    if (!applied.rollbackToken) throw new Error('verified apply did not return a rollback token')

    const repeated = await adapter.apply(request)
    expect(repeated.receiptId).toBe(applied.receiptId)

    const rolledBack = await adapter.rollback({
      actorId: 'test-owner',
      grantedScopes: [sourceWriteScope(request.relativePath)],
      idempotencyKey: 'rollback-source-adapter-v1',
      reason: 'Restore the source after the bounded proof',
      rollbackToken: applied.rollbackToken
    })
    expect(rolledBack).toMatchObject({
      immutable: true,
      proposalId: request.authorization.proposalId,
      status: 'restored',
      result: {
        beforeHash: digest(UPDATED_SOURCE),
        afterHash: digest(ORIGINAL_SOURCE),
        status: 'restored'
      }
    })
    expect(await readFile(sourcePath, 'utf8')).toBe(ORIGINAL_SOURCE)
  })

  test('refuses stale hashes, missing exact scopes, and paths outside the root before writing', async () => {
    const stale = await fixture()
    await expect(
      stale.adapter.apply({
        ...stale.request,
        authorization: { ...stale.request.authorization, expectedBeforeHash: digest('stale') }
      })
    ).rejects.toThrow('preimage hash changed')
    expect(await readFile(stale.sourcePath, 'utf8')).toBe(ORIGINAL_SOURCE)

    const missingScope = await fixture()
    await expect(
      missingScope.adapter.apply({
        ...missingScope.request,
        authorization: { ...missingScope.request.authorization, grantedScopes: ['source:write'] }
      })
    ).rejects.toThrow('exact proposal, target, actor, or path scope')
    expect(await readFile(missingScope.sourcePath, 'utf8')).toBe(ORIGINAL_SOURCE)

    const escaped = await fixture()
    await expect(
      escaped.adapter.apply({ ...escaped.request, relativePath: '../feature.mjs' })
    ).rejects.toThrow('parent segments')
  })

  test('automatically restores the original source when runtime behavior fails', async () => {
    const { adapter, request, sourcePath } = await fixture('not-v2')
    const receipt = await adapter.apply(request)

    expect(receipt.status).toBe('rolled-back')
    expect(receipt.rollbackToken).toBeUndefined()
    expect(receipt.automaticRollback).toMatchObject({
      afterHash: digest(ORIGINAL_SOURCE),
      beforeHash: digest(UPDATED_SOURCE),
      status: 'restored'
    })
    expect(receipt.checks.find((check) => check.kind === 'runtime')?.passed).toBe(false)
    expect(await readFile(sourcePath, 'utf8')).toBe(ORIGINAL_SOURCE)
  })

  test('refuses rollback when another actor changed the file after verification', async () => {
    const { adapter, request, sourcePath } = await fixture()
    const receipt = await adapter.apply(request)
    if (!receipt.rollbackToken) throw new Error('verified apply did not return a rollback token')
    const intervening = "export const value = () => 'v3'\n"
    await writeFile(sourcePath, intervening)

    await expect(
      adapter.rollback({
        actorId: 'test-owner',
        grantedScopes: [sourceWriteScope(request.relativePath)],
        idempotencyKey: 'rollback-after-intervening-change',
        reason: 'This must not overwrite newer work',
        rollbackToken: receipt.rollbackToken
      })
    ).rejects.toThrow('source changed after the approved apply')
    expect(await readFile(sourcePath, 'utf8')).toBe(intervening)
  })
})
