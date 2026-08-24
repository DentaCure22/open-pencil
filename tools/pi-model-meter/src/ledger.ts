import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { parseUsageTurnRecord, type UsageTurnRecord } from './schema'

const DEFAULT_LEDGER_FILE = 'turns.jsonl'

export function defaultUsageLedgerPath(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string {
  const override = env.OPENPENCIL_MODEL_METER_LOG?.trim()
  if (override) return path.resolve(override)
  return path.join(home, '.openpencil', 'model-meter', DEFAULT_LEDGER_FILE)
}

export async function readUsageTurns(filePath: string): Promise<UsageTurnRecord[]> {
  try {
    const text = await readFile(filePath, 'utf8')
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const record = parseUsageTurnRecord(JSON.parse(line) as unknown)
          return record ? [record] : []
        } catch {
          return []
        }
      })
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return []
    }
    throw error
  }
}

export async function appendUsageTurn(record: UsageTurnRecord, filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
}
