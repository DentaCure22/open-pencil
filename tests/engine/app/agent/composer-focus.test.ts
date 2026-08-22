import { describe, expect, test } from 'bun:test'

import {
  applyRoutedComposerKey,
  isAgentComposerField,
  isAgentConversationViewport,
  shouldRouteKeyToAgentComposer,
  type RoutedComposerKey
} from '@/app/agent-chat/composer-focus'

function key(init: Partial<RoutedComposerKey> & Pick<RoutedComposerKey, 'key'>): RoutedComposerKey {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    metaKey: false,
    target: { tagName: 'DIV' } as EventTarget,
    ...init
  }
}

describe('agent composer focus', () => {
  test('routes printable keys from the transcript, not from the textarea', () => {
    expect(shouldRouteKeyToAgentComposer(key({ key: 'h' }))).toBe(true)
    const textarea = { tagName: 'TEXTAREA' } as EventTarget
    expect(isAgentComposerField(textarea)).toBe(true)
    expect(shouldRouteKeyToAgentComposer(key({ key: 'h', target: textarea }))).toBe(false)
  })

  test('leaves editor and IME keys on the Board', () => {
    expect(shouldRouteKeyToAgentComposer(key({ key: 'Escape' }))).toBe(false)
    expect(shouldRouteKeyToAgentComposer(key({ key: 'Tab' }))).toBe(false)
    expect(shouldRouteKeyToAgentComposer(key({ key: 'h', metaKey: true }))).toBe(false)
    expect(shouldRouteKeyToAgentComposer(key({ key: 'Dead' }))).toBe(false)
    expect(shouldRouteKeyToAgentComposer(key({ key: 'Enter' }))).toBe(false)
  })

  test('inserts the first routed character at the caret', () => {
    expect(applyRoutedComposerKey('ab', 'x', 1, 1)).toEqual({ caret: 2, value: 'axb' })
    expect(applyRoutedComposerKey('ab', 'x', 0, 2)).toEqual({ caret: 1, value: 'x' })
  })

  test('recognizes the conversation viewport as a focus trap', () => {
    const viewport = { dataset: { testId: 'ai-conversation-viewport' } } as EventTarget
    expect(isAgentConversationViewport(viewport)).toBe(true)
    expect(isAgentConversationViewport({ tagName: 'TEXTAREA' } as EventTarget)).toBe(false)
  })
})
