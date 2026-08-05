import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEvalLog, dispatchedEvent, readEvalEvents } from '../src/io'
import { appendSemanticWitness } from '../src/semantic-witness'

const scenarioVersion = 'a'.repeat(64)
const target = {
  content_document_id: 'content-1',
  document_id: 'document-1',
  page_id: 'page-1',
  runtime_instance_id: 'runtime-1',
  workspace_id: 'workspace-1'
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-semantic-witness-'))
  const eventLogPath = join(directory, 'events.jsonl')
  const evidencePath = join(directory, 'semantic-review.json')
  const evidence = JSON.stringify({ checks: [{ criterion: 'requested content', passed: true }] })
  await writeFile(evidencePath, evidence, 'utf8')
  await createEvalLog(
    eventLogPath,
    dispatchedEvent('RUN-1', 'recorder-1', 1, 1, 'Build the requested artifact.', {
      campaign_roster_id: 'b'.repeat(64),
      config: { config_id: 'c'.repeat(64), measurement_class: 'open_ended_cold' },
      grader_version: 'semantic-grader/v1',
      rubric_id: 'intent-rubric',
      rubric_version: '2',
      scenario_fingerprint: scenarioVersion,
      scenario_id: 'SCENARIO-1',
      source_snapshot: {
        commit: 'abc',
        dirty: false,
        dirty_diff_hash: 'clean',
        dirty_files: []
      }
    })
  )
  return { directory, eventLogPath, evidence, evidencePath }
}

function options(eventLogPath: string, evidencePath: string) {
  return {
    eventLogPath,
    evidencePath,
    qualityGrade: 'pass',
    qualityPassed: true,
    reviewId: 'review-1',
    reviewedBy: 'semantic-reviewer/v1',
    rubricId: 'intent-rubric',
    rubricVersion: '2',
    scenarioId: 'SCENARIO-1',
    scenarioVersion,
    target
  }
}

describe('semantic quality witness', () => {
  test('appends hashed review evidence with exact scenario and rubric provenance', async () => {
    const { eventLogPath, evidence, evidencePath } = await fixture()
    const hash = await appendSemanticWitness(options(eventLogPath, evidencePath))
    expect(hash).toBe(createHash('sha256').update(evidence).digest('hex'))
    const events = await readEvalEvents(eventLogPath)
    expect(events.map(({ kind }) => kind)).toEqual(['run_dispatched', 'semantic_review_completed'])
    expect(events[1]?.data).toMatchObject({
      evidence_sha256: hash,
      quality_passed: true,
      rubric_id: 'intent-rubric',
      rubric_version: '2',
      scenario_id: 'SCENARIO-1',
      scenario_version: scenarioVersion,
      target
    })
    expect(await readFile(eventLogPath, 'utf8')).toContain(hash)
  })

  test('refuses stale provenance and replacement reviews', async () => {
    const { eventLogPath, evidencePath } = await fixture()
    await expect(
      appendSemanticWitness({
        ...options(eventLogPath, evidencePath),
        rubricVersion: 'stale'
      })
    ).rejects.toThrow('does not match dispatched provenance')
    await appendSemanticWitness(options(eventLogPath, evidencePath))
    await expect(appendSemanticWitness(options(eventLogPath, evidencePath))).rejects.toThrow(
      'append-once'
    )
  })
})
