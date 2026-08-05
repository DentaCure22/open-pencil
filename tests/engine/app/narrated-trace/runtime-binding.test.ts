import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import { narratedTraceRuntimeTabBindingForStore } from '@/app/narrated-trace'

describe('Narrated Trace runtime-tab binding', () => {
  test('stays opaque within one runtime-tab pair and rotates on either rebind', () => {
    const store = createEditorStore()
    const first = narratedTraceRuntimeTabBindingForStore(store, {
      documentTabId: 'tab-1',
      runtimeInstanceId: 'runtime:1'
    })
    const same = narratedTraceRuntimeTabBindingForStore(store, {
      documentTabId: 'tab-1',
      runtimeInstanceId: 'runtime:1'
    })
    const runtimeRebound = narratedTraceRuntimeTabBindingForStore(store, {
      documentTabId: 'tab-1',
      runtimeInstanceId: 'runtime:2'
    })
    const tabRebound = narratedTraceRuntimeTabBindingForStore(store, {
      documentTabId: 'tab-2',
      runtimeInstanceId: 'runtime:2'
    })

    expect(first).toStartWith('trace-runtime-tab:')
    expect(same).toBe(first)
    expect(runtimeRebound).not.toBe(first)
    expect(tabRebound).not.toBe(runtimeRebound)
  })

  test('fails closed when no current runtime-tab identity is available', () => {
    const store = createEditorStore()

    expect(narratedTraceRuntimeTabBindingForStore(store)).toBeUndefined()
  })
})
