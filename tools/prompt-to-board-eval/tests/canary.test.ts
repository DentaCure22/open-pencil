import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildEvaluatorCanarySummaries,
  EVALUATOR_CANARY_ROSTER,
  evaluateEvaluatorCanary,
  EvaluatorCanaryGateError,
  requireEvaluatorCanaryGate,
  runEvaluatorCanaryAttempt,
  writeEvaluatorCanaryAttempt
} from '../src/canary'

describe('evaluator canary gate', () => {
  test('predeclares and exactly classifies all six synthetic cases', () => {
    const report = evaluateEvaluatorCanary(buildEvaluatorCanarySummaries())
    expect(EVALUATOR_CANARY_ROSTER.map((entry) => entry.case_id)).toEqual([
      'strict-success',
      'unstructured-machine-output',
      'graph-correct-pixel-failure',
      'visible-semantic-failure',
      'durability-failure',
      'timeout-interruption'
    ])
    expect(report).toMatchObject({
      denominator: 6,
      expected_denominator: 6,
      gate_passed: true,
      scale_allowed: true,
      schema_version: 'prompt-to-board-evaluator-canary/v1'
    })
    expect(report.observations.map((entry) => entry.observed_classification)).toEqual([
      'strict_visible_pass',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'invalid'
    ])
    expect(report.observations.every((entry) => entry.passed)).toBe(true)
    expect(report.roster_sha256).toMatch(/^[a-f0-9]{64}$/u)
  })

  test('stops scaling when a classification or denominator drifts', () => {
    const summaries = buildEvaluatorCanarySummaries()
    const missingCase = evaluateEvaluatorCanary(summaries.slice(0, -1))
    expect(missingCase).toMatchObject({ denominator: 5, gate_passed: false, scale_allowed: false })
    expect(() => requireEvaluatorCanaryGate(missingCase)).toThrow(EvaluatorCanaryGateError)

    const changed = structuredClone(summaries)
    changed[0].valid = false
    changed[0].failures = ['unexpected_failure']
    const classificationDrift = evaluateEvaluatorCanary(changed)
    expect(classificationDrift.observations[0]).toMatchObject({
      observed_classification: 'invalid',
      passed: false
    })
    expect(() => requireEvaluatorCanaryGate(classificationDrift)).toThrow(
      'Evaluator canary stopped scaling: strict-success.'
    )
  })

  test('writes the first attempt before gating and refuses overwrite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-eval-canary-'))
    const path = join(directory, 'attempt-1.json')
    const failedReport = evaluateEvaluatorCanary(buildEvaluatorCanarySummaries().slice(0, -1))
    await writeEvaluatorCanaryAttempt(path, 'attempt-1', failedReport)
    const preserved = JSON.parse(await readFile(path, 'utf8'))
    expect(preserved).toMatchObject({
      attempt_id: 'attempt-1',
      denominator: 5,
      gate_passed: false,
      scale_allowed: false
    })
    await expect(writeEvaluatorCanaryAttempt(path, 'replacement', failedReport)).rejects.toThrow()
    expect(JSON.parse(await readFile(path, 'utf8')).attempt_id).toBe('attempt-1')
  })

  test('runs the fixed canary without touching a Board', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-eval-canary-run-'))
    const path = join(directory, 'attempt-1.json')
    const report = await runEvaluatorCanaryAttempt(path, 'attempt-1')
    expect(report.scale_allowed).toBe(true)
    expect(JSON.parse(await readFile(path, 'utf8')).attempt_id).toBe('attempt-1')
  })
})
