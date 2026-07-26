import { describe, expect, test } from 'bun:test'

describe('Narrated Trace editor surface contract', () => {
  test('keeps a direct feed and history without Trace assistant or recording controls', async () => {
    const [
      layers,
      panel,
      bindings,
      types,
      dock,
      keyboard,
      controller,
      history,
      headerExists,
      traceDockExists
    ] = await Promise.all([
      Bun.file('src/components/LayersPanel.vue').text(),
      Bun.file('src/components/narrated-trace/NarratedTracePanel.vue').text(),
      Bun.file('src/app/narrated-trace/bindings.ts').text(),
      Bun.file('src/app/narrated-trace/types.ts').text(),
      Bun.file('src/components/sidebar/BoardDock.vue').text(),
      Bun.file('src/app/shell/keyboard/registry.ts').text(),
      Bun.file('src/app/narrated-trace/controller.ts').text(),
      Bun.file('src/app/narrated-trace/history.ts').text(),
      Bun.file('src/components/narrated-trace/NarratedTraceHeader.vue').exists(),
      Bun.file('src/components/narrated-trace/TraceDockButton.vue').exists()
    ])

    expect(layers).toContain('left-panel-trace-tab')
    expect(layers).toContain('<NarratedTracePanel')
    expect(layers).not.toContain('assistant-handoff')
    expect(dock).toContain('board-dock-compact-layout')
    expect(dock).not.toContain('TraceDockButton')
    expect(dock).not.toContain('board-dock-trace-center')
    expect(traceDockExists).toBe(false)
    expect(panel).not.toContain('narrated-trace-panel-start')
    expect(panel).not.toContain('narrated-trace-panel-pause')
    expect(panel).not.toContain('narrated-trace-panel-stop')
    expect(panel).not.toContain('narrated-trace-history-resume')
    expect(panel).not.toContain('narrated-trace-copy-context')
    expect(panel).not.toContain('narrated-trace-copy-evidence')
    expect(panel).not.toContain('narrated-trace-send-assistant')
    expect(panel).not.toContain('clarification')
    expect(headerExists).toBe(false)
    expect(keyboard).not.toContain('toggleNarratedTraceRecording')
    expect(keyboard).toContain('showTracePanel')

    expect(panel).toContain('narrated-trace-history')
    expect(panel).toContain('narrated-trace-activity-feed')
    expect(panel).not.toContain('narrated-trace-timeline')
    expect(panel).not.toContain('narrated-trace-history-toggle')
    expect(panel).not.toContain('narrated-trace-history-record')
    expect(panel).toContain('narrated-trace-evidence-image')
    expect(history).toContain('narrated-trace/history-index')
    expect(history).toContain('DEFAULT_ACTIVITY_ITEM_LIMIT = 80')
    expect(bindings).toContain("editor.onEditorEvent('selection:changed'")
    expect(bindings).toContain("editor.onEditorEvent('tool:changed'")
    expect(bindings).toContain("editor.onEditorEvent('node:created'")
    expect(bindings).toContain("editor.onEditorEvent('node:updated'")
    expect(bindings).toContain("editor.onEditorEvent('node:deleted'")
    expect(bindings).toContain('COMPLETED_EDIT_IDLE_MS')
    expect(bindings).not.toContain("editor.onEditorEvent('viewport:changed'")
    expect(bindings).not.toContain("editor.onEditorEvent('page:changed'")
    expect(types).toContain('NARRATED_TRACE_ACTIVITY_KINDS')
    expect(controller).toContain('startNarratedTraceRecording')
  })

  test('preserves generic Chat without a Trace handoff surface', async () => {
    const [chat, input, message, mobileDrawer] = await Promise.all([
      Bun.file('src/components/ChatPanel.vue').text(),
      Bun.file('src/components/chat/ChatInput.vue').text(),
      Bun.file('src/components/chat/ChatMessage.vue').text(),
      Bun.file('src/components/MobileDrawer.vue').text()
    ])

    expect(chat).toContain('data-test-id="chat-panel"')
    expect(chat).toContain('<ChatInput')
    expect(input).toContain('data-test-id="chat-input"')
    expect(message).toContain('chat-text-bubble')
    expect(mobileDrawer).toContain('<ChatPanel')
    expect(chat).not.toContain('trace-handoff')
    expect(input).not.toContain('trace-handoff')
    expect(message).not.toContain('TraceHandoffMessageCard')
  })
})
