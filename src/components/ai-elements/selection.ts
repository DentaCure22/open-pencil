const MAX_SELECTION_LENGTH = 12_000

export function quotedChatSelection(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim().slice(0, MAX_SELECTION_LENGTH)
  if (!normalized) return ''
  return normalized
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n')
}

export function addSelectionToDraft(draft: string, selection: string): string {
  const quote = quotedChatSelection(selection)
  if (!quote) return draft
  const prefix = draft.trimEnd()
  return prefix ? `${prefix}\n\n${quote}\n\n` : `${quote}\n\n`
}
