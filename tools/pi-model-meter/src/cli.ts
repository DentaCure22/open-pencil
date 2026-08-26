import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { checkUsageTurns } from './check'
import { defaultUsageLedgerPath, readUsageTurns } from './ledger'
import { DEFAULT_PROBE_MODELS, runProbes } from './probe'
import { formatUsageRollup, rollupUsageTurns } from './rollup'
import type { UsageProbeScenario } from './schema'

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function selectedScenarios(): UsageProbeScenario[] | undefined {
  const raw = argValue('--scenario')
  if (!raw || raw === 'all') return undefined
  if (raw === 'warmup' || raw === 'delay' || raw === 'size') return [raw]
  throw new Error(`Unknown scenario: ${raw}`)
}

function selectedModels() {
  const raw = argValue('--model')
  if (!raw) return DEFAULT_PROBE_MODELS
  const slash = raw.indexOf('/')
  if (slash <= 0) throw new Error('Use --model provider/model')
  return [{ id: raw, model: raw.slice(slash + 1), provider: raw.slice(0, slash) }]
}

async function main(): Promise<number> {
  const command = process.argv[2] ?? 'rollup'
  const ledgerPath = argValue('--log') ?? defaultUsageLedgerPath()
  const days = Number.parseInt(argValue('--days') ?? '7', 10)
  const sinceMs = Number.isFinite(days) ? Date.now() - days * 86_400_000 : undefined

  if (command === 'rollup') {
    const rows = rollupUsageTurns(await readUsageTurns(ledgerPath), sinceMs)
    process.stdout.write(formatUsageRollup(rows))
    return 0
  }

  if (command === 'check') {
    const fixturesOnly = process.argv.includes('--fixtures-only')
    const turns = fixturesOnly
      ? await readUsageTurns(argValue('--fixtures') ?? ledgerPath)
      : await readUsageTurns(ledgerPath)
    const failures = checkUsageTurns(turns)
    if (failures.length === 0) {
      process.stdout.write(`ok ${String(turns.length)} turns\n`)
      return 0
    }
    for (const failure of failures) {
      process.stdout.write(`${failure.code}: ${failure.message}\n`)
    }
    return 1
  }

  if (command === 'probe') {
    const cwd = argValue('--cwd') ?? path.join(tmpdir(), 'openpencil-pi-model-meter')
    const resultsPath = argValue('--out') ?? path.join(cwd, 'results.json')
    await mkdir(cwd, { recursive: true })
    const records = await runProbes({
      cwd,
      ledgerPath,
      models: selectedModels(),
      resultsPath,
      scenarios: selectedScenarios()
    })
    process.stdout.write(`${resultsPath}\n${String(records.length)} probe turns\n`)
    return 0
  }

  process.stderr.write('usage: bun src/cli.ts <rollup|check|probe> [--log path] [--days 7]\n')
  return 2
}

const code = await main()
process.exit(code)
