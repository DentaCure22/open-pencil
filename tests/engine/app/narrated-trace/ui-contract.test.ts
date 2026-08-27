import { describe, expect, test } from 'bun:test'

describe('Narrated Trace editor surface contract', () => {
  test('keeps a direct feed with toolbar mic controls and no Trace assistant handoff', async () => {
    const [
      layers,
      panel,
      desktopToolbar,
      annotationControls,
      annotationOverlay,
      mic,
      bindings,
      types,
      keyboard,
      history,
      authorityClient,
      headerExists,
      traceDockExists
    ] = await Promise.all([
      Bun.file('src/components/LayersPanel.vue').text(),
      Bun.file('src/components/narrated-trace/NarratedTracePanel.vue').text(),
      Bun.file('src/components/Toolbar/DesktopToolbar.vue').text(),
      Bun.file('src/components/narrated-trace/TraceAnnotationControls.vue').text(),
      Bun.file('src/components/narrated-trace/NarratedTraceAnnotationOverlay.vue').text(),
      Bun.file('src/app/narrated-trace/mic.ts').text(),
      Bun.file('src/app/narrated-trace/bindings.ts').text(),
      Bun.file('src/app/narrated-trace/types.ts').text(),
      Bun.file('src/app/shell/keyboard/registry.ts').text(),
      Bun.file('src/app/narrated-trace/history.ts').text(),
      Bun.file('src/app/workspace-document/local-authority/client.ts').text(),
      Bun.file('src/components/narrated-trace/NarratedTraceHeader.vue').exists(),
      Bun.file('src/components/narrated-trace/TraceDockButton.vue').exists()
    ])

    expect(layers).not.toContain('left-panel-trace-tab')
    expect(layers).not.toContain('<NarratedTracePanel')
    expect(layers).toContain("openAgentRightPanel('activity')")
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
    expect(panel).toContain('removeNarratedTraceMicTurn(turnId)')
    expect(panel).toContain("item.event.origin?.kind === 'voice'")
    expect(panel).toContain('narratedTraceMicTurns.value.map')
    expect(panel).toContain('watch(micTurnIds')
    expect(panel).toContain('!removed.has(eventId)')
    expect(desktopToolbar).toContain('<TraceAnnotationControls')
    expect(annotationControls).toContain('narrated-trace-mic-toggle')
    expect(annotationControls).toContain('toggleNarratedTraceMicPinned(store)')
    expect(annotationOverlay).toContain('captureNarratedTraceEvidence')
    expect(annotationOverlay).not.toContain('getDisplayMedia')
    expect(mic).toContain('MIC_TURN_RETENTION_MS = 15 * 60_000')
    expect(mic).toContain('MIC_RESTART_DELAY_MS = 250')
    expect(mic).toContain('next.continuous = true')
    expect(mic).toContain('recognitionRestartTimer')
    expect(mic).not.toContain('MIC_LISTENING_LIMIT_MS')
    expect(mic).toContain('globalThis.performance.timeOrigin')
    expect(mic).not.toContain('getUserMedia')
    expect(mic).toContain('appendNarratedTraceEvent')
    expect(mic).toContain("kind: 'voice'")
    expect(mic).not.toContain("from '@/app/cache'")
    expect(mic).toContain('saveNarratedTraceRecord')
    expect(history).not.toContain('narratedTraceMicTurns')
    expect(headerExists).toBe(false)
    expect(keyboard).toContain('showTracePanel')

    expect(panel).toContain('narrated-trace-history')
    expect(panel).not.toContain('narrated-trace-session-tag')
    expect(panel).not.toContain('Rename Trace session tag')
    expect(panel).toContain('narrated-trace-activity-feed')
    expect(panel).not.toContain('before:bg-violet-400/50')
    expect(panel).not.toContain('shadow-[0_0_0_1px_rgb(167_139_250_/_0.7)]')
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
    expect(panel).not.toContain('Human and agent changes, anchored to this Board')
    expect(panel).not.toContain('<span>Trace activity</span>')
    expect(panel).not.toContain('activityPageLabel')
    expect(panel).toContain('narrated-trace-row-details-toggle')
    expect(panel).toContain('item.event.evidence || rowMetadata(item)')
    expect(panel).toContain('group-hover:pointer-events-auto')
    expect(panel).toContain(':aria-expanded="isExpanded(item.event.id)"')
    expect(panel).not.toContain('<span v-else>Details</span>')
    expect(panel).not.toContain('narrated-trace-timeline')
    expect(panel).not.toContain('narrated-trace-history-toggle')
    expect(panel).not.toContain('narrated-trace-history-record')
    expect(panel).toContain('narrated-trace-evidence-image')
    expect(panel).toContain('narrated-trace-evidence-overview-trigger')
    expect(panel).toContain('narrated-trace-evidence-overview')
    expect(panel).toContain('narrated-trace-evidence-capacity')
    expect(panel).toContain('Oldest unpinned images are removed first')
    expect(panel).toContain('border-chrome-border bg-chrome-raised')
    expect(panel).toContain('bg-chrome-detail')
    expect(panel).toContain('bg-component transition-[width]')
    expect(panel).toContain('text-[var(--color-success)]')
    expect(panel).not.toContain('bg-[#202126]')
    expect(panel).toContain("status === 'evicted'")
    expect(panel).toContain('Pinned to active task')
    expect(panel).toContain('narrated-trace-activity-pagination')
    expect(panel).toContain('narrated-trace-activity-older')
    expect(panel).toContain('narrated-trace-activity-newer')
    expect(panel).toContain('narrated-trace-activity-latest')
    expect(panel).toContain('narrated-trace-evidence-load')
    expect(panel).toContain('EAGER_EVIDENCE_PREVIEW_LIMIT = 12')
    expect(history).toContain('readLocalWorkspaceTraceSessionSummaries')
    expect(history).toContain('loadNarratedTraceActivityPage')
    expect(history).toContain('DEFAULT_ACTIVITY_ITEM_LIMIT = 80')
    expect(authorityClient).toContain('/trace/activity${serializedQuery')
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
