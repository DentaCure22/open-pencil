export type RoutedComposerKey = {
  altKey?: boolean
  ctrlKey?: boolean
  isComposing?: boolean
  key: string
  metaKey?: boolean
  target: EventTarget | null
}

function targetTagName(target: EventTarget | null): string {
  if (!target || typeof target !== 'object' || !('tagName' in target)) return ''
  return String(target.tagName).toUpperCase()
}

function targetTestId(target: EventTarget | null): string | undefined {
  if (!target || typeof target !== 'object' || !('dataset' in target)) return undefined
  const dataset = target.dataset
  if (!dataset || typeof dataset !== 'object' || !('testId' in dataset)) return undefined
  const testId = dataset.testId
  return typeof testId === 'string' ? testId : undefined
}

export function isAgentComposerField(target: EventTarget | null): boolean {
  const tagName = targetTagName(target)
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tagName)) return true
  return Boolean(
    target &&
    typeof target === 'object' &&
    'isContentEditable' in target &&
    target.isContentEditable
  )
}

export function shouldRouteKeyToAgentComposer(event: RoutedComposerKey): boolean {
  if (isAgentComposerField(event.target)) return false
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  if (event.isComposing || event.key === 'Dead') return false
  if (event.key === 'Escape' || event.key === 'Tab') return false
  return event.key.length === 1
}

export function applyRoutedComposerKey(
  draft: string,
  key: string,
  selectionStart: number,
  selectionEnd: number
): { caret: number; value: string } {
  const start = Math.max(0, Math.min(selectionStart, draft.length))
  const end = Math.max(start, Math.min(selectionEnd, draft.length))
  return {
    caret: start + key.length,
    value: `${draft.slice(0, start)}${key}${draft.slice(end)}`
  }
}

export function isAgentConversationViewport(target: EventTarget | null): boolean {
  return targetTestId(target) === 'ai-conversation-viewport'
}
