import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { executeCampaign, parseCampaignRunPlans } from './campaign'
import { auditCampaignTruthFiles } from './campaign-audit'
import { runEvaluatorCanaryAttempt } from './canary'
import { parseEvaluationConfiguration, visibleProofSafetyTimeoutMs } from './evaluation-config'
import { appendEvalEvent, readEvalEvents } from './io'
import { summarizeEvalRun } from './measurements'
import { recordCodexRun } from './recorder'
import { parseScenarioManifest } from './scenario-manifest'
import { parseEvalEvent, parseEvalRunMetadata, parseEvalTarget } from './schema'
import { appendSemanticWitness } from './semantic-witness'
import { finalizeVisibleRun } from './visible-finalizer'
import { appendPixelWitness } from './witness'

function required(value: string | undefined, flag: string): string {
  if (!value?.trim()) throw new Error(`${flag} is required.`)
  return value
}

function sandboxMode(
  value: string | undefined
): 'danger-full-access' | 'read-only' | 'workspace-write' {
  if (value === 'danger-full-access') return value
  if (value === 'read-only') return value
  return 'workspace-write'
}

function positiveInteger(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} must be a positive integer.`)
  }
  return parsed
}

const [command, ...rawArgs] = process.argv.slice(2)

if (command === 'canary') {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      'attempt-id': { type: 'string' },
      output: { type: 'string' }
    },
    strict: true
  })
  const report = await runEvaluatorCanaryAttempt(
    required(values.output, '--output'),
    required(values['attempt-id'], '--attempt-id')
  )
  process.stdout.write(`${JSON.stringify(report)}\n`)
} else if (command === 'campaign') {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      'allow-pending-visible-proof': { type: 'boolean' },
      codex: { type: 'string' },
      cwd: { type: 'string' },
      ephemeral: { type: 'boolean' },
      manifest: { type: 'string' },
      'max-concurrency': { type: 'string' },
      'openpencil-repo': { type: 'string' },
      'output-dir': { type: 'string' },
      'output-schema': { type: 'string' },
      'recorder-id': { type: 'string' },
      results: { type: 'string' },
      roster: { type: 'string' },
      runs: { type: 'string' },
      sandbox: { type: 'string' },
      'skip-git-repo-check': { type: 'boolean' },
      'straight-through': { type: 'boolean' }
    },
    strict: true
  })
  const manifest = parseScenarioManifest(
    JSON.parse(await readFile(required(values.manifest, '--manifest'), 'utf8'))
  )
  const runs = parseCampaignRunPlans(
    JSON.parse(await readFile(required(values.runs, '--runs'), 'utf8'))
  )
  const results = await executeCampaign({
    allowPendingVisibleProof: values['allow-pending-visible-proof'] === true,
    codexBinary: values.codex ?? '/Applications/ChatGPT.app/Contents/Resources/codex',
    cwd: required(values.cwd, '--cwd'),
    ephemeral: values.ephemeral === true,
    manifest,
    maxConcurrency: positiveInteger(values['max-concurrency'], '--max-concurrency', 1),
    openPencilRepo: values['openpencil-repo'],
    outputDir: required(values['output-dir'], '--output-dir'),
    outputSchemaPath: values['output-schema'],
    recorderId: required(values['recorder-id'], '--recorder-id'),
    rosterPath: values.roster,
    runs,
    sandbox: sandboxMode(values.sandbox),
    skipGitRepoCheck: values['skip-git-repo-check'] === true,
    straightThrough: values['straight-through'] === true
  })
  const resultsPath = required(values.results, '--results')
  await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  })
  const counts = Object.fromEntries(
    ['finalized', 'recorded', 'pending_proof', 'failed', 'skipped'].map((status) => [
      status,
      results.filter((result) => result.status === status).length
    ])
  )
  process.stdout.write(`${JSON.stringify({ counts, results_path: resultsPath })}\n`)
  if (counts.failed || counts.skipped) process.exitCode = 2
  else if (counts.pending_proof) process.exitCode = 3
} else if (command === 'audit-campaign') {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      output: { type: 'string' },
      results: { type: 'string' },
      roster: { type: 'string' }
    },
    strict: true
  })
  const report = await auditCampaignTruthFiles(
    required(values.roster, '--roster'),
    required(values.results, '--results')
  )
  const outputPath = required(values.output, '--output')
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  })
  process.stdout.write(
    `${JSON.stringify({ gate_passed: report.gate_passed, output_path: outputPath })}\n`
  )
  if (!report.gate_passed) process.exitCode = 2
} else if (command === 'record') {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      codex: { type: 'string' },
      config: { type: 'string' },
      cwd: { type: 'string' },
      ephemeral: { type: 'boolean' },
      events: { type: 'string' },
      'openpencil-repo': { type: 'string' },
      'output-schema': { type: 'string' },
      'prompt-file': { type: 'string' },
      'recorder-id': { type: 'string' },
      'rubric-id': { type: 'string' },
      'rubric-version': { type: 'string' },
      'roster-id': { type: 'string' },
      'resume-thread-id': { type: 'string' },
      'run-id': { type: 'string' },
      sandbox: { type: 'string' },
      'scenario-fingerprint': { type: 'string' },
      'scenario-id': { type: 'string' },
      'skip-git-repo-check': { type: 'boolean' },
      stderr: { type: 'string' }
    },
    strict: true
  })
  const eventLogPath = required(values.events, '--events')
  const configuration = parseEvaluationConfiguration(
    JSON.parse(await readFile(required(values.config, '--config'), 'utf8'))
  )
  const prompt = await readFile(required(values['prompt-file'], '--prompt-file'), 'utf8')
  const sandbox = sandboxMode(values.sandbox)
  const exitCode = await recordCodexRun({
    campaignRosterId: required(values['roster-id'], '--roster-id'),
    codexBinary: values.codex ?? '/Applications/ChatGPT.app/Contents/Resources/codex',
    configuration,
    cwd: required(values.cwd, '--cwd'),
    ephemeral: values.ephemeral === true,
    eventLogPath,
    openPencilRepo: values['openpencil-repo'],
    outputSchemaPath: values['output-schema'],
    prompt,
    recorderId: required(values['recorder-id'], '--recorder-id'),
    rubricId: required(values['rubric-id'], '--rubric-id'),
    rubricVersion: required(values['rubric-version'], '--rubric-version'),
    resumeThreadId: values['resume-thread-id'],
    runId: required(values['run-id'], '--run-id'),
    sandbox,
    scenarioFingerprint: required(values['scenario-fingerprint'], '--scenario-fingerprint'),
    scenarioId: required(values['scenario-id'], '--scenario-id'),
    skipGitRepoCheck: values['skip-git-repo-check'] === true,
    stderrPath: values.stderr ?? `${eventLogPath}.stderr.log`
  })
  process.exitCode = exitCode
} else if (command === 'append') {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      events: { type: 'string' },
      'event-file': { type: 'string' }
    },
    strict: true
  })
  const event = parseEvalEvent(
    JSON.parse(await readFile(required(values['event-file'], '--event-file'), 'utf8'))
  )
  await appendEvalEvent(required(values.events, '--events'), event)
} else if (command === 'summarize') {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      events: { type: 'string' },
      metadata: { type: 'string' },
      output: { type: 'string' }
    },
    strict: true
  })
  const events = await readEvalEvents(required(values.events, '--events'))
  const metadata = parseEvalRunMetadata(
    JSON.parse(await readFile(required(values.metadata, '--metadata'), 'utf8'))
  )
  const summary = summarizeEvalRun(events, metadata)
  await writeFile(required(values.output, '--output'), `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  })
  if (!summary.valid) process.exitCode = 2
} else if (command === 'finalize-visible') {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      config: { type: 'string' },
      events: { type: 'string' },
      output: { type: 'string' },
      target: { type: 'string' }
    },
    strict: true
  })
  const configuration = parseEvaluationConfiguration(
    JSON.parse(await readFile(required(values.config, '--config'), 'utf8'))
  )
  const target = parseEvalTarget(
    JSON.parse(await readFile(required(values.target, '--target'), 'utf8'))
  )
  const result = await finalizeVisibleRun({
    appendEvidence: async () => undefined,
    eventLogPath: required(values.events, '--events'),
    expectedConfigId: configuration.config_id,
    expectedTarget: target,
    safetyTimeoutMs: visibleProofSafetyTimeoutMs(configuration)
  })
  const outputPath = required(values.output, '--output')
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  })
  process.stdout.write(`${JSON.stringify({ output_path: outputPath, released: true })}\n`)
} else if (command === 'semantic-witness') {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      events: { type: 'string' },
      evidence: { type: 'string' },
      'quality-grade': { type: 'string' },
      'quality-passed': { type: 'boolean' },
      'review-id': { type: 'string' },
      'reviewed-by': { type: 'string' },
      'rubric-id': { type: 'string' },
      'rubric-version': { type: 'string' },
      'scenario-id': { type: 'string' },
      'scenario-version': { type: 'string' },
      target: { type: 'string' }
    },
    strict: true
  })
  const target = JSON.parse(await readFile(required(values.target, '--target'), 'utf8'))
  const hash = await appendSemanticWitness({
    eventLogPath: required(values.events, '--events'),
    evidencePath: required(values.evidence, '--evidence'),
    qualityGrade: required(values['quality-grade'], '--quality-grade'),
    qualityPassed: values['quality-passed'] === true,
    reviewId: required(values['review-id'], '--review-id'),
    reviewedBy: required(values['reviewed-by'], '--reviewed-by'),
    rubricId: required(values['rubric-id'], '--rubric-id'),
    rubricVersion: required(values['rubric-version'], '--rubric-version'),
    scenarioId: required(values['scenario-id'], '--scenario-id'),
    scenarioVersion: required(values['scenario-version'], '--scenario-version'),
    target
  })
  process.stdout.write(`${hash}\n`)
} else if (command === 'pixel-witness') {
  const { values } = parseArgs({
    args: rawArgs,
    options: {
      events: { type: 'string' },
      'mapping-error-ms': { type: 'string' },
      'quality-grade': { type: 'string' },
      'quality-passed': { type: 'boolean' },
      'reviewed-by': { type: 'string' },
      screenshot: { type: 'string' },
      target: { type: 'string' },
      'visible-at-ms': { type: 'string' }
    },
    strict: true
  })
  const target = JSON.parse(await readFile(required(values.target, '--target'), 'utf8'))
  const visibleAtMs = values['visible-at-ms']
    ? Number.parseInt(values['visible-at-ms'], 10)
    : undefined
  const mappingErrorMs = values['mapping-error-ms']
    ? Number.parseFloat(values['mapping-error-ms'])
    : undefined
  const hash = await appendPixelWitness({
    eventLogPath: required(values.events, '--events'),
    mappingErrorMs,
    qualityGrade: required(values['quality-grade'], '--quality-grade'),
    qualityPassed: values['quality-passed'] === true,
    reviewedBy: required(values['reviewed-by'], '--reviewed-by'),
    screenshotPath: required(values.screenshot, '--screenshot'),
    target,
    visibleAtMs
  })
  process.stdout.write(`${hash}\n`)
} else {
  throw new Error(
    'Use canary, campaign, audit-campaign, record, append, finalize-visible, pixel-witness, semantic-witness, or summarize.'
  )
}
