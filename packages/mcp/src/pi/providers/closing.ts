export type PiClosingFamily = 'antigravity' | 'cursor-xai' | 'openai-codex' | 'unknown'

type ClosingTextBlock = {
  phase?: 'commentary' | 'final_answer'
  text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function textSignaturePhase(value: unknown): ClosingTextBlock['phase'] | undefined {
  if (typeof value !== 'string' || !value.startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return undefined
    return parsed.phase === 'commentary' || parsed.phase === 'final_answer'
      ? parsed.phase
      : undefined
  } catch {
    return undefined
  }
}

function messageContent(message: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(message.content) ? message.content.filter(isRecord) : []
}

function hasToolCall(message: Record<string, unknown>): boolean {
  return messageContent(message).some((part) => part.type === 'toolCall')
}

export function closingTextBlocks(message: Record<string, unknown>): ClosingTextBlock[] {
  return messageContent(message).flatMap((part) => {
    if (part.type !== 'text' || typeof part.text !== 'string' || !part.text.trim()) return []
    const phase = textSignaturePhase(part.textSignature)
    return [{ ...(phase ? { phase } : {}), text: part.text.trim() }]
  })
}

export function piClosingFamily(provider?: string, modelId?: string): PiClosingFamily {
  const source = `${provider ?? ''}/${modelId ?? ''}`
  if (source.includes('openai-codex') || provider === 'openai' || provider === 'openai-codex') {
    return 'openai-codex'
  }
  if (source.includes('antigravity') || provider === 'antigravity') return 'antigravity'
  if (
    provider === 'cursor' ||
    provider === 'xai' ||
    provider === 'xai-auth' ||
    source.includes('cursor/') ||
    source.includes('xai-auth/') ||
    source.includes('xai/')
  ) {
    return 'cursor-xai'
  }
  return 'unknown'
}

function lastBlockText(
  blocks: readonly ClosingTextBlock[],
  predicate: (block: ClosingTextBlock) => boolean = () => true
): string {
  return [...blocks].reverse().find((block) => predicate(block) && block.text)?.text ?? ''
}

export function closingTextForFamily(
  _family: PiClosingFamily,
  blocks: readonly ClosingTextBlock[]
): string {
  return lastBlockText(blocks, (block) => block.phase === 'final_answer') || lastBlockText(blocks)
}

export function closingTextFromAssistantMessage(
  message: Record<string, unknown>,
  fallbackModelId?: string
): string {
  if (message.role !== 'assistant') return ''
  const stopReason = typeof message.stopReason === 'string' ? message.stopReason : ''
  if (stopReason === 'toolUse' || stopReason === 'error' || stopReason === 'aborted') return ''
  if (hasToolCall(message)) return ''
  const provider = typeof message.provider === 'string' ? message.provider : undefined
  const model = typeof message.model === 'string' ? message.model : undefined
  const responseModel =
    typeof message.responseModel === 'string' ? message.responseModel : undefined
  return closingTextForFamily(
    piClosingFamily(provider, model ?? responseModel ?? fallbackModelId),
    closingTextBlocks(message)
  )
}

export function isConfiguredClosingModel(modelId: string): boolean {
  return piClosingFamily(undefined, modelId) !== 'unknown'
}
