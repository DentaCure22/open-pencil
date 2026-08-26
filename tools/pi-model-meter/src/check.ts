import type { UsageTurnRecord } from './schema'

export type UsageCheckFailure = {
  code: 'drop-after-hit' | 'estimated-when-measured' | 'flat-while-growing' | 'miss-after-warmup'
  message: string
  record: UsageTurnRecord
}

const GEMINI_FLOOR = 4_096
const GROK_FLOOR = 1_024
const GEMINI_WAIT_MS = 30_000
const GROK_WARM_TURN = 3
const PLATEAU_GROWTH = 4_000

function isGemini(record: UsageTurnRecord): boolean {
  return record.provider.startsWith('antigravity') || record.model.includes('gemini')
}

function isGrok(record: UsageTurnRecord): boolean {
  return record.provider.startsWith('xai') || record.model.includes('grok')
}

function promptFloor(record: UsageTurnRecord): number {
  if (isGemini(record)) return GEMINI_FLOOR
  if (isGrok(record)) return GROK_FLOOR
  return GEMINI_FLOOR
}

function warmedEnough(record: UsageTurnRecord): boolean {
  if (isGemini(record)) return (record.waitMs ?? record.gapMs ?? 0) >= GEMINI_WAIT_MS
  if (isGrok(record)) return record.turnIndex >= GROK_WARM_TURN
  return record.turnIndex >= 2
}

function sameThread(left: UsageTurnRecord, right: UsageTurnRecord): boolean {
  return (
    left.threadId === right.threadId &&
    left.model === right.model &&
    left.provider === right.provider
  )
}

export function checkUsageTurns(turns: UsageTurnRecord[]): UsageCheckFailure[] {
  const failures: UsageCheckFailure[] = []
  const ordered = [...turns].sort((left, right) => {
    if (left.threadId !== right.threadId) return left.threadId.localeCompare(right.threadId)
    return left.turnIndex - right.turnIndex || left.at.localeCompare(right.at)
  })

  for (const [index, record] of ordered.entries()) {
    const previous = ordered.slice(0, index).findLast((candidate) => sameThread(candidate, record))

    if (record.cacheRead === 0 && previous && previous.cacheRead > 0) {
      failures.push({
        code: 'drop-after-hit',
        message: `${record.provider}/${record.model} cache dropped to 0 after ${String(previous.cacheRead)} on ${record.threadId}`,
        record
      })
    }

    if (
      record.cacheRead === 0 &&
      record.promptTokens >= promptFloor(record) &&
      warmedEnough(record)
    ) {
      failures.push({
        code: 'miss-after-warmup',
        message: `${record.provider}/${record.model} missed cache after warmup at ${String(record.promptTokens)} prompt tokens`,
        record
      })
    }

    if (
      previous &&
      record.promptTokens - previous.promptTokens > PLATEAU_GROWTH &&
      record.cacheRead > 0 &&
      previous.cacheRead > 0 &&
      record.cacheRead <= previous.cacheRead + 8
    ) {
      failures.push({
        code: 'flat-while-growing',
        message: `${record.provider}/${record.model} cache stayed at ${String(record.cacheRead)} while prompt grew by ${String(record.promptTokens - previous.promptTokens)}`,
        record
      })
    }

    if (
      record.usageSource === 'estimated' &&
      record.provider.startsWith('antigravity') &&
      ordered.some(
        (candidate) =>
          candidate.provider.startsWith('antigravity') && candidate.usageSource === 'agy-sqlite'
      )
    ) {
      failures.push({
        code: 'estimated-when-measured',
        message: `${record.provider}/${record.model} used estimated usage when Antigravity sqlite was available`,
        record
      })
    }
  }

  return failures
}
