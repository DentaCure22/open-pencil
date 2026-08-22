import { describe, expect, test } from 'bun:test'

describe('Narrated Trace editor surface contract', () => {
  test('keeps a direct feed with toolbar mic controls and no Trace assistant handoff', async () => {
    const [
      layers,
      panel,
      desktopToolbar,
      annotationControls,
      mic,
      bindings,
      types,
      keyboard,
      history,
      headerExists,
      traceDockExists
    ] = await Promise.all([
      Bun.file('src/components/LayersPanel.vue').text(),
      Bun.file('src/components/narrated-trace/NarratedTracePanel.vue').text(),
      Bun.file('src/components/Toolbar/DesktopToolbar.vue').text(),
      Bun.file('src/components/narrated-trace/TraceAnnotationControls.vue').text(),
      Bun.file('src/app/narrated-trace/mic.ts').text(),
      Bun.file('src/app/narrated-trace/bindings.ts').text(),
      Bun.file('src/app/narrated-trace/types.ts').text(),
      Bun.file('src/app/shell/keyboard/registry.ts').text(),
      Bun.file('src/app/narrated-trace/history.ts').text(),
      Bun.file('src/components/narrated-trace/NarratedTraceHeader.vue').exists(),
      Bun.file('src/components/narrated-trace/TraceDockButton.vue').exists()
    ])

    expect(layers).toContain('left-panel-trace-tab')
    expect(layers).toContain('<NarratedTracePanel')
    expect(layers).not.toContain('assistant-handoff')
    expect(traceDockExists).toBe(false)
    expect(panel).not.toContain('narrated-trace-panel-start')
    expect(panel).not.toContain('narrated-trace-panel-pause')
    expect(panel).not.toContain('narrated-trace-panel-stop')
    expect(panel).not.toContain('narrated-trace-history-resume')
    expect(panel).not.toContain('narrated-trace-copy-context')
    expect(panel).not.toContain('narrated-trace-copy-evidence')
    expect(panel).not.toContain('narrated-trace-send-assistant')
    expect(panel).not.toContain('clarification')
    expect(panel).not.toContain('narrated-trace-mic-toggle')
    expect(panel).toContain('narrated-trace-mic-clear')
    expect(panel).toContain('narrated-trace-mic-turn-delete')
    expect(panel).toContain('v-if="isMicTranscript(item)"')
    expect(panel).toContain('removeNarratedTraceMicTurn(item.event.id)')
    expect(panel).toContain('narratedTraceMicTurns.value.map')
    expect(panel).toContain('watch(micTurnIds')
    expect(panel).toContain('!removed.has(eventId)')
    expect(desktopToolbar).toContain('<TraceAnnotationControls')
    expect(annotationControls).toContain('narrated-trace-mic-toggle')
    expect(annotationControls).toContain('toggleNarratedTraceMicPinned(store)')
    expect(mic).toContain('MIC_TURN_RETENTION_MS = 15 * 60_000')
    expect(mic).toContain('MIC_RESTART_DELAY_MS = 250')
    expect(mic).toContain('next.continuous = true')
    expect(mic).toContain('recognitionRestartTimer')
    expect(mic).not.toContain('MIC_LISTENING_LIMIT_MS')
    expect(mic).toContain('globalThis.performance.timeOrigin')
    expect(mic).not.toContain('getUserMedia')
    expect(mic).not.toContain('appendNarratedTraceEvent')
    expect(mic).not.toContain("from '@/app/cache'")
    expect(mic).toContain('saveNarratedTraceRecord')
    expect(history).not.toContain('narratedTraceMicTurns')
    expect(headerExists).toBe(false)
    expect(keyboard).toContain('showTracePanel')

    expect(panel).toContain('narrated-trace-history')
    expect(panel).toContain('narrated-trace-activity-feed')
    expect(panel).toContain('narrated-trace-retrieval-result')
    expect(panel).toContain('narrated-trace-retrieval-scope')
    expect(panel).toContain('narrated-trace-retrieval-spoken-turn')
    expect(panel).toContain('narrated-trace-retrieval-window')
    expect(panel).toContain('narrated-trace-retrieval-matched-by')
    expect(panel).toContain('narrated-trace-retrieval-events')
    expect(panel).toContain('narrated-trace-retrieval-event-target')
    expect(panel).toContain('retrievalSummary.eventCountLabel')
    expect(panel).toContain('retrievalSummary.eventSummaries')
    expect(panel).not.toContain('retrievalSummary.eventCount }} events')
    expect(panel).toContain('Human and agent changes, anchored to this Board')
    expect(panel).toContain('narrated-trace-row-details-toggle')
    expect(panel).not.toContain('narrated-trace-timeline')
    expect(panel).not.toContain('narrated-trace-history-toggle')
    expect(panel).not.toContain('narrated-trace-history-record')
    expect(panel).toContain('narrated-trace-evidence-image')
    expect(history).toContain('readLocalWorkspaceTraceSessionSummaries')
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
