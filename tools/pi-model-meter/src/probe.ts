import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { appendUsageTurn } from './ledger'
import { parsePiUsage } from './parse'
import {
  buildUsageTurnRecord,
  usageFromParsed,
  type UsageProbeScenario,
  type UsageTokens,
  type UsageTurnRecord
} from './schema'

export type ProbeModel = {
  id: string
  model: string
  provider: string
}

export const DEFAULT_PROBE_MODELS: ProbeModel[] = [
  { id: 'xai-auth/grok-4.6', model: 'grok-4.6', provider: 'xai-auth' },
  { id: 'antigravity/gemini-3-7-flash', model: 'gemini-3-7-flash', provider: 'antigravity' }
]

const SIZE_TARGETS = [4_000, 7_000, 12_000, 20_000, 24_000]
const DELAY_TARGET = 7_000
const DELAY_WAITS_MS = [4_000, 30_000]
const WARMUP_TURNS = 5
const PI_TIMEOUT_MS = 180_000

const PAD =
  'OpenPencil cache meter padding. Keep this prefix byte-stable across probe turns. Knowledge entry: architecture, layout, renderer, and Board session notes. '

export function paddedPrompt(targetTokens: number, suffix: string): string {
  const repeats = Math.max(1, Math.ceil((targetTokens * 4) / PAD.length))
  return `${PAD.repeat(repeats)}\n${suffix}`
}

function piBinary(): string {
  return (
    process.env.OPENPENCIL_PI_BIN?.trim() ||
    path.join(homedir(), '.local/share/pi-node/current/bin/pi')
  )
}

async function writeEmptyMcpConfig(cwd: string): Promise<void> {
  await mkdir(cwd, { recursive: true })
  await writeFile(
    path.join(cwd, 'pi-mcp.json'),
    `${JSON.stringify({ mcpServers: {}, settings: { freezeDirectTools: true } }, null, 2)}\n`
  )
}

async function spawnPi(args: string[], cwd: string): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(piBinary(), args, { cwd })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
    }, PI_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', () => {
      clearTimeout(timer)
      resolve({ stderr, stdout })
    })
  })
}

async function runPiTurn(input: {
  cwd: string
  model: ProbeModel
  prompt: string
  sessionDir?: string
  sessionId?: string
}): Promise<UsageTokens> {
  const args = [
    '-p',
    '--provider',
    input.model.provider,
    '--model',
    input.model.model,
    '--thinking',
    'low',
    '--no-skills',
    '--no-context-files',
    '--approve',
    '--mode',
    'json'
  ]
  args.push('--mcp-config', path.join(input.cwd, 'pi-mcp.json'))
  if (input.sessionDir && input.sessionId) {
    args.push('--session-dir', input.sessionDir, '--session-id', input.sessionId)
  } else {
    args.push('--no-session')
  }
  args.push(input.prompt)
  const { stdout } = await spawnPi(args, input.cwd)
  return usageFromParsed(parsePiUsage(stdout))
}

async function writeTurn(
  record: UsageTurnRecord,
  ledgerPath: string,
  results: UsageTurnRecord[]
): Promise<void> {
  results.push(record)
  await appendUsageTurn(record, ledgerPath)
}

export async function runWarmupProbe(input: {
  cwd: string
  ledgerPath: string
  model: ProbeModel
}): Promise<UsageTurnRecord[]> {
  await writeEmptyMcpConfig(input.cwd)
  const sessionDir = path.join(input.cwd, 'sessions', input.model.provider)
  await mkdir(sessionDir, { recursive: true })
  const sessionId = `meter-warmup-${input.model.provider}`
  const results: UsageTurnRecord[] = []
  const started = Date.now()
  let previousEnded = started
  for (let turn = 1; turn <= WARMUP_TURNS; turn += 1) {
    const tokens = await runPiTurn({
      cwd: input.cwd,
      model: input.model,
      prompt: `Reply with OK. Warmup turn ${String(turn)}.`,
      sessionDir,
      sessionId
    })
    const ended = Date.now()
    await writeTurn(
      buildUsageTurnRecord({
        gapMs: turn === 1 ? null : ended - previousEnded,
        modelId: input.model.id,
        scenario: 'warmup',
        source: 'probe',
        threadId: sessionId,
        tokens,
        turnIndex: turn,
        usageSource: 'pi-event',
        waitMs: ended - started
      }),
      input.ledgerPath,
      results
    )
    previousEnded = ended
  }
  return results
}

export async function runDelayProbe(input: {
  cwd: string
  ledgerPath: string
  model: ProbeModel
}): Promise<UsageTurnRecord[]> {
  await writeEmptyMcpConfig(input.cwd)
  const results: UsageTurnRecord[] = []
  const prompt = paddedPrompt(DELAY_TARGET, 'Reply with OK. Delay probe.')
  const tokens1 = await runPiTurn({ cwd: input.cwd, model: input.model, prompt })
  await writeTurn(
    buildUsageTurnRecord({
      modelId: input.model.id,
      scenario: 'delay',
      source: 'probe',
      targetPromptTokens: DELAY_TARGET,
      threadId: `delay-${input.model.provider}`,
      tokens: tokens1,
      turnIndex: 1,
      usageSource: 'pi-event',
      waitMs: 0
    }),
    input.ledgerPath,
    results
  )
  for (const [index, waitMs] of DELAY_WAITS_MS.entries()) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, waitMs)
    })
    const tokens = await runPiTurn({ cwd: input.cwd, model: input.model, prompt })
    await writeTurn(
      buildUsageTurnRecord({
        gapMs: waitMs,
        modelId: input.model.id,
        scenario: 'delay',
        source: 'probe',
        targetPromptTokens: DELAY_TARGET,
        threadId: `delay-${input.model.provider}`,
        tokens,
        turnIndex: index + 2,
        usageSource: 'pi-event',
        waitMs
      }),
      input.ledgerPath,
      results
    )
  }
  return results
}

export async function runSizeProbe(input: {
  cwd: string
  ledgerPath: string
  model: ProbeModel
}): Promise<UsageTurnRecord[]> {
  await writeEmptyMcpConfig(input.cwd)
  const results: UsageTurnRecord[] = []
  for (const target of SIZE_TARGETS) {
    const prompt = paddedPrompt(target, `Reply with OK. Size probe ${String(target)}.`)
    const first = await runPiTurn({ cwd: input.cwd, model: input.model, prompt })
    await writeTurn(
      buildUsageTurnRecord({
        modelId: input.model.id,
        scenario: 'size',
        source: 'probe',
        targetPromptTokens: target,
        threadId: `size-${input.model.provider}-${String(target)}`,
        tokens: first,
        turnIndex: 1,
        usageSource: 'pi-event',
        waitMs: 0
      }),
      input.ledgerPath,
      results
    )
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 30_000)
    })
    const second = await runPiTurn({ cwd: input.cwd, model: input.model, prompt })
    await writeTurn(
      buildUsageTurnRecord({
        gapMs: 30_000,
        modelId: input.model.id,
        scenario: 'size',
        source: 'probe',
        targetPromptTokens: target,
        threadId: `size-${input.model.provider}-${String(target)}`,
        tokens: second,
        turnIndex: 2,
        usageSource: 'pi-event',
        waitMs: 30_000
      }),
      input.ledgerPath,
      results
    )
  }
  return results
}

export async function runProbes(input: {
  cwd: string
  ledgerPath: string
  models?: ProbeModel[]
  resultsPath: string
  scenarios?: UsageProbeScenario[]
}): Promise<UsageTurnRecord[]> {
  const models = input.models ?? DEFAULT_PROBE_MODELS
  const scenarios = input.scenarios ?? ['warmup', 'delay', 'size']
  const records: UsageTurnRecord[] = []
  await writeEmptyMcpConfig(input.cwd)
  for (const model of models) {
    if (scenarios.includes('warmup')) {
      records.push(
        ...(await runWarmupProbe({ cwd: input.cwd, ledgerPath: input.ledgerPath, model }))
      )
    }
    if (scenarios.includes('delay')) {
      records.push(
        ...(await runDelayProbe({ cwd: input.cwd, ledgerPath: input.ledgerPath, model }))
      )
    }
    if (scenarios.includes('size')) {
      records.push(...(await runSizeProbe({ cwd: input.cwd, ledgerPath: input.ledgerPath, model })))
    }
  }
  await mkdir(path.dirname(input.resultsPath), { recursive: true })
  await writeFile(input.resultsPath, `${JSON.stringify({ records }, null, 2)}\n`)
  return records
}
