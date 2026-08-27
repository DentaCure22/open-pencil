import { piEventText, piToolOutputFailed } from './events'
import { closingTextFromAssistantMessage } from './providers/closing'
import type { PiSession } from './router-state'
import type { PiRpcRecord } from './rpc-process'
import { parseUsageTokens, usageTokensAreZero } from './usage-ledger'

const MAX_STATUS_TEXT = 160

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function safeStatusText(value: unknown): string {
  return piEventText(value)
    .replace(/(bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[=:]\s*)[^\s,"']+/gi,
      '$1[redacted]'
    )
    .trim()
    .slice(0, MAX_STATUS_TEXT)
}

function assistantMessage(event: PiRpcRecord): Record<string, unknown> | null {
  return isRecord(event.message) && event.message.role === 'assistant' ? event.message : null
}

function hasToolCall(message: Record<string, unknown>): boolean {
  return Boolean(
    Array.isArray(message.content) &&
    message.content.some((part) => isRecord(part) && part.type === 'toolCall')
  )
}

function captureToolOutcome(session: PiSession, event: PiRpcRecord): void {
  if (event.type !== 'tool_execution_end') return
  const output = piEventText(event.result)
  if (event.isError !== true && !piToolOutputFailed(output)) return
  const toolName = typeof event.toolName === 'string' ? event.toolName : 'Tool'
  session.lastToolError = safeStatusText(output) || `${toolName} failed.`
}

function captureSessionError(session: PiSession, event: PiRpcRecord): void {
  if (event.type === 'extension_error') {
    session.lastError = safeStatusText(event.error) || 'A Pi extension failed.'
    return
  }
  if (event.type === 'auto_retry_end' && event.success === false) {
    session.lastError = safeStatusText(event.finalError) || 'Pi exhausted its retries.'
  }
}

function captureTurnUsage(session: PiSession, event: PiRpcRecord): void {
  if (event.type !== 'message_end') return
  const message = assistantMessage(event)
  if (!message || !isRecord(message.usage)) return
  const tokens = parseUsageTokens(message.usage)
  const previous = session.lastTurnUsage
  session.lastTurnUsage = {
    source:
      previous?.source === 'pi-event' || !usageTokensAreZero(tokens) ? 'pi-event' : 'estimated',
    tokens: previous
      ? {
          cacheRead: previous.tokens.cacheRead + tokens.cacheRead,
          cacheWrite: previous.tokens.cacheWrite + tokens.cacheWrite,
          input: previous.tokens.input + tokens.input,
          output: previous.tokens.output + tokens.output,
          reasoning: previous.tokens.reasoning + tokens.reasoning
        }
      : tokens
  }
}

function captureAssistantOutcome(session: PiSession, event: PiRpcRecord): void {
  const message = assistantMessage(event)
  if (!message) return
  const stopReason = typeof message.stopReason === 'string' ? message.stopReason : ''
  const text = piEventText(message).trim()
  if (stopReason === 'error' || stopReason === 'aborted') {
    const label = stopReason === 'aborted' ? 'stopped' : 'failed'
    session.lastError = safeStatusText(message.errorMessage ?? text) || `Pi ${label}.`
    return
  }
  if (stopReason === 'toolUse' || hasToolCall(message)) return
  const closing = closingTextFromAssistantMessage(message)
  if (closing) session.finalResponse = closing
  else if (text) session.finalResponse = text
}

export function capturePiOutcome(session: PiSession, event: PiRpcRecord): void {
  captureToolOutcome(session, event)
  captureSessionError(session, event)
  captureTurnUsage(session, event)
  captureAssistantOutcome(session, event)
}

export function processExitDetail(code: number | null, signal: string | null): string {
  if (signal) return `Pi session exited before completion (${signal}).`
  if (code !== null) return `Pi session exited before completion (code ${String(code)}).`
  return 'Pi session exited before completion.'
}
