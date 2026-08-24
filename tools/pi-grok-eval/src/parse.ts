export type TokenUsage = {
  cacheRead: number
  cacheWrite: number
  input: number
  output: number
  reasoning: number
  total: number
}

export type TaskFooter = {
  code: string | null
  edit: string | null
  file: string | null
  lines: string | null
  name: string | null
  ok: boolean | null
  used: string | null
  write: string | null
}

export function emptyUsage(): TokenUsage {
  return { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, reasoning: 0, total: 0 }
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function parsePiUsage(stdout: string): TokenUsage {
  const usage = emptyUsage()
  for (const line of stdout.split('\n')) {
    if (!line.includes('"usage"') || !line.includes('totalTokens')) continue
    try {
      const event = JSON.parse(line) as {
        message?: { usage?: Record<string, number> }
        usage?: Record<string, number>
      }
      const raw = event.message?.usage ?? event.usage
      if (!raw) continue
      usage.input = Math.max(usage.input, asNumber(raw.input))
      usage.output = Math.max(usage.output, asNumber(raw.output))
      usage.cacheRead = Math.max(usage.cacheRead, asNumber(raw.cacheRead))
      usage.cacheWrite = Math.max(usage.cacheWrite, asNumber(raw.cacheWrite))
      usage.reasoning = Math.max(usage.reasoning, asNumber(raw.reasoning))
      usage.total = Math.max(usage.total, asNumber(raw.totalTokens))
    } catch {
      // Skip non-JSON chatter mixed into the stream.
    }
  }
  if (usage.total === 0) usage.total = usage.input + usage.output
  return usage
}

export function parseGrokUsage(stdout: string): TokenUsage {
  const trimmed = stdout.trim()
  if (!trimmed) return emptyUsage()
  try {
    const parsed = JSON.parse(trimmed) as {
      usage?: Record<string, number>
    }
    const raw = parsed.usage ?? {}
    const input = asNumber(raw.input_tokens)
    const output = asNumber(raw.output_tokens)
    return {
      cacheRead: asNumber(raw.cache_read_input_tokens),
      cacheWrite: asNumber(raw.cache_write_input_tokens),
      input,
      output,
      reasoning: asNumber(raw.reasoning_tokens),
      total: asNumber(raw.total_tokens) || input + output
    }
  } catch {
    return emptyUsage()
  }
}

export function parseCodexUsage(stdout: string): TokenUsage {
  const usage = emptyUsage()
  for (const line of stdout.split('\n')) {
    if (!line.includes('turn.completed') || !line.includes('input_tokens')) continue
    try {
      const event = JSON.parse(line) as {
        type?: string
        usage?: Record<string, number>
      }
      if (event.type !== 'turn.completed' || !event.usage) continue
      usage.input = asNumber(event.usage.input_tokens)
      usage.cacheRead = asNumber(event.usage.cached_input_tokens)
      usage.output = asNumber(event.usage.output_tokens)
      usage.reasoning = asNumber(event.usage.reasoning_output_tokens)
      usage.total = usage.input + usage.output
    } catch {
      // Skip non-JSON chatter mixed into the stream.
    }
  }
  return usage
}

export function parseGrokText(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout.trim()) as { text?: string }
    return typeof parsed.text === 'string' ? parsed.text : stdout
  } catch {
    return stdout
  }
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { text: string; type: string } => {
      return (
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: string }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
      )
    })
    .map((part) => part.text)
    .join('\n')
}

export function parsePiFinalText(stdout: string): string {
  let last = ''
  let streamed = ''
  for (const line of stdout.split('\n')) {
    if (
      !line.includes('"text":') &&
      !line.includes('"text_delta"') &&
      !line.includes('"text_end"') &&
      !line.includes('"agent_end"')
    ) {
      continue
    }
    try {
      const event = JSON.parse(line) as {
        assistantMessageEvent?: { content?: string; delta?: string; type?: string }
        message?: { content?: unknown; role?: string }
        messages?: Array<{ content?: unknown; role?: string }>
        type?: string
      }
      const messageText = textFromContent(event.message?.content)
      if (event.message?.role === 'assistant' && messageText) last = messageText
      if (event.type === 'agent_end' && Array.isArray(event.messages)) {
        for (const message of event.messages) {
          const text = textFromContent(message.content)
          if (message.role === 'assistant' && text) last = text
        }
      }
      const streamEvent = event.assistantMessageEvent
      if (streamEvent?.type === 'text_delta' && streamEvent.delta) streamed += streamEvent.delta
      if (streamEvent?.type === 'text_end' && streamEvent.content) last = streamEvent.content
    } catch {
      // Ignore partial stream lines.
    }
  }
  return last || streamed
}

export function parseFooter(text: string): TaskFooter {
  const pick = (label: string): string | null => {
    const match = new RegExp(`^${label}=(.*)$`, 'im').exec(text)
    const value = match?.[1]?.trim()
    return value ? value : null
  }
  const ok = pick('OK')
  return {
    code: pick('CODE'),
    edit: pick('EDIT'),
    file: pick('FILE'),
    lines: pick('LINES'),
    name: pick('NAME'),
    ok: ok === null ? null : /^(yes|ok|true)$/i.test(ok),
    used: pick('USED'),
    write: pick('WRITE')
  }
}
