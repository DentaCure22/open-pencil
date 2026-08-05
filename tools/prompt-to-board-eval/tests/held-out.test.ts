import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  generateHeldOutEncryptionKey,
  promoteHeldOutReserve,
  readHeldOutRevealLedger,
  revealHeldOutScenarioOnce,
  sealHeldOutBundle,
  type HeldOutScenarioMaterial
} from '../src/held-out'

function material(
  scenarioId: string,
  reserveRank: number,
  prompt: string
): HeldOutScenarioMaterial {
  return {
    cohort_id: 'visual-layout-cohort',
    fixture: {
      board_seed: `private-fixture-${scenarioId}`,
      expected_region: { height: 320, width: 480, x: 120, y: 240 }
    },
    reserve_rank: reserveRank,
    rubric: {
      forbidden_overlap: true,
      private_label: `private-rubric-${scenarioId}`
    },
    scenario: {
      expected_outcome: 'artifact_success',
      lineage: {
        family_id: `family-${scenarioId}`,
        optimization_exposure: 'forbidden',
        origin: 'human',
        parent_scenario_ids: [],
        source_record_ids: [`source-${scenarioId}`],
        transform: null
      },
      modalities: ['native_card'],
      prompt,
      rubric: { rubric_id: 'held-out-test-rubric', version: '1' },
      scenario_id: scenarioId,
      session_mode: 'fresh',
      split: 'held_out',
      target_policy: {
        fixture_ref: `private-target-${scenarioId}`,
        kind: 'exact_fixture',
        target_substitution: 'forbidden'
      },
      visibility: 'required'
    }
  }
}

async function withTempDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-held-out-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

describe('sealed held-out protocol', () => {
  test('keeps prompt, fixture, rubric, target, and encryption key out of persisted artifacts', () => {
    const key = generateHeldOutEncryptionKey()
    const primary = material('HOLD-PRIMARY', 0, 'Build the confidential primary artifact')
    const reserve = material('HOLD-RESERVE', 1, 'Build the confidential reserve artifact')
    const { bundle, optimizer_manifest: optimizerManifest } = sealHeldOutBundle(
      [primary, reserve],
      1,
      key
    )

    const publicArtifacts = JSON.stringify({ bundle, optimizerManifest })
    for (const secret of [
      primary.scenario.prompt,
      reserve.scenario.prompt,
      'private-fixture-HOLD-PRIMARY',
      'private-rubric-HOLD-PRIMARY',
      'private-target-HOLD-PRIMARY',
      Buffer.from(key).toString('base64')
    ]) {
      expect(publicArtifacts).not.toContain(secret)
    }
    expect(optimizerManifest.scenarios).toEqual([
      {
        cohort_id: 'visual-layout-cohort',
        reserve_rank: 0,
        scenario_id: 'HOLD-PRIMARY',
        split: 'held_out'
      },
      {
        cohort_id: 'visual-layout-cohort',
        reserve_rank: 1,
        scenario_id: 'HOLD-RESERVE',
        split: 'held_out'
      }
    ])
  })

  test('authenticates bundle address, encryption key, and optimizer descriptors before reveal', async () => {
    await withTempDirectory(async (directory) => {
      const key = generateHeldOutEncryptionKey()
      const sealed = sealHeldOutBundle(
        [material('HOLD-PRIMARY', 0, 'A prompt the optimizer cannot inspect')],
        2,
        key
      )
      const base = {
        actorId: 'held-out-custodian',
        bundle: sealed.bundle,
        ledgerPath: join(directory, 'reveal.jsonl'),
        optimizerManifest: sealed.optimizer_manifest,
        reason: 'baseline_execution',
        scenarioId: 'HOLD-PRIMARY'
      }

      await expect(
        revealHeldOutScenarioOnce({ ...base, key: generateHeldOutEncryptionKey() })
      ).rejects.toThrow('authenticated and decrypted')
      await expect(
        revealHeldOutScenarioOnce({
          ...base,
          bundle: { ...sealed.bundle, ciphertext_base64: 'AAAA' },
          key
        })
      ).rejects.toThrow('address does not match')
      await expect(
        revealHeldOutScenarioOnce({
          ...base,
          key,
          optimizerManifest: {
            ...sealed.optimizer_manifest,
            scenarios: [
              {
                ...sealed.optimizer_manifest.scenarios[0],
                reserve_rank: 1
              } as (typeof sealed.optimizer_manifest.scenarios)[number]
            ]
          }
        })
      ).rejects.toThrow('index does not match')
      expect(await readHeldOutRevealLedger(base.ledgerPath)).toEqual([])
    })
  })

  test('reveals once, retires immediately, and returns a campaign-ready scenario manifest', async () => {
    await withTempDirectory(async (directory) => {
      const key = generateHeldOutEncryptionKey()
      const primary = material('HOLD-PRIMARY', 0, 'Build the one-time hidden artifact')
      const sealed = sealHeldOutBundle([primary], 3, key)
      const options = {
        actorId: 'held-out-custodian',
        bundle: sealed.bundle,
        key,
        ledgerPath: join(directory, 'reveal.jsonl'),
        optimizerManifest: sealed.optimizer_manifest,
        reason: 'baseline_execution',
        scenarioId: 'HOLD-PRIMARY'
      }

      const revealed = await revealHeldOutScenarioOnce(options)
      expect(revealed.material).toEqual(primary)
      expect(revealed.scenario_manifest.scenarios[0]?.scenario_id).toBe('HOLD-PRIMARY')
      expect(revealed.ledger_record).toMatchObject({
        action: 'reveal_and_retire',
        replacement_scenario_id: null,
        scenario_id: 'HOLD-PRIMARY',
        sequence: 1
      })
      await expect(revealHeldOutScenarioOnce(options)).rejects.toThrow('already been revealed')
      expect(await readHeldOutRevealLedger(options.ledgerPath)).toHaveLength(1)
    })
  })

  test('gates reserves behind ordered promotion and records replacement without revealing it', async () => {
    await withTempDirectory(async (directory) => {
      const key = generateHeldOutEncryptionKey()
      const sealed = sealHeldOutBundle(
        [
          material('HOLD-PRIMARY', 0, 'Hidden primary'),
          material('HOLD-RESERVE-1', 1, 'Hidden first reserve'),
          material('HOLD-RESERVE-2', 2, 'Hidden second reserve')
        ],
        4,
        key
      )
      const ledgerPath = join(directory, 'reveal.jsonl')
      const reveal = (scenarioId: string) =>
        revealHeldOutScenarioOnce({
          actorId: 'held-out-custodian',
          bundle: sealed.bundle,
          key,
          ledgerPath,
          optimizerManifest: sealed.optimizer_manifest,
          reason: 'campaign_execution',
          scenarioId
        })

      await expect(reveal('HOLD-RESERVE-1')).rejects.toThrow('has not been promoted')
      await reveal('HOLD-PRIMARY')
      const firstPromotion = await promoteHeldOutReserve({
        actorId: 'held-out-custodian',
        bundle: sealed.bundle,
        ledgerPath,
        optimizerManifest: sealed.optimizer_manifest,
        reason: 'primary_retired',
        retiredScenarioId: 'HOLD-PRIMARY'
      })
      expect(firstPromotion.replacement_scenario_id).toBe('HOLD-RESERVE-1')
      await expect(
        promoteHeldOutReserve({
          actorId: 'held-out-custodian',
          bundle: sealed.bundle,
          ledgerPath,
          optimizerManifest: sealed.optimizer_manifest,
          reason: 'duplicate_replacement_attempt',
          retiredScenarioId: 'HOLD-PRIMARY'
        })
      ).rejects.toThrow('already has a replacement')

      await reveal('HOLD-RESERVE-1')
      const secondPromotion = await promoteHeldOutReserve({
        actorId: 'held-out-custodian',
        bundle: sealed.bundle,
        ledgerPath,
        optimizerManifest: sealed.optimizer_manifest,
        reason: 'reserve_retired',
        retiredScenarioId: 'HOLD-RESERVE-1'
      })
      expect(secondPromotion.replacement_scenario_id).toBe('HOLD-RESERVE-2')
      expect(await readHeldOutRevealLedger(ledgerPath)).toHaveLength(4)
    })
  })

  test('detects append-only ledger tampering', async () => {
    await withTempDirectory(async (directory) => {
      const key = generateHeldOutEncryptionKey()
      const sealed = sealHeldOutBundle([material('HOLD-PRIMARY', 0, 'Hidden prompt')], 5, key)
      const ledgerPath = join(directory, 'reveal.jsonl')
      await revealHeldOutScenarioOnce({
        actorId: 'held-out-custodian',
        bundle: sealed.bundle,
        key,
        ledgerPath,
        optimizerManifest: sealed.optimizer_manifest,
        reason: 'baseline_execution',
        scenarioId: 'HOLD-PRIMARY'
      })
      const text = await readFile(ledgerPath, 'utf8')
      await writeFile(ledgerPath, text.replace('baseline_execution', 'edited_after_reveal'), 'utf8')
      await expect(readHeldOutRevealLedger(ledgerPath)).rejects.toThrow('record hash is invalid')
    })
  })

  test('serializes concurrent reveal attempts and appends exactly one retirement', async () => {
    await withTempDirectory(async (directory) => {
      const key = generateHeldOutEncryptionKey()
      const sealed = sealHeldOutBundle(
        [material('HOLD-PRIMARY', 0, 'One concurrent caller may receive this')],
        6,
        key
      )
      const ledgerPath = join(directory, 'reveal.jsonl')
      const options = {
        actorId: 'held_out_custodian',
        bundle: sealed.bundle,
        key,
        ledgerPath,
        optimizerManifest: sealed.optimizer_manifest,
        reason: 'concurrency_probe',
        scenarioId: 'HOLD-PRIMARY'
      }

      const attempts = await Promise.allSettled([
        revealHeldOutScenarioOnce(options),
        revealHeldOutScenarioOnce(options)
      ])
      expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
      expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1)
      expect(await readHeldOutRevealLedger(ledgerPath)).toHaveLength(1)
    })
  })
})
