import { describe, expect, test } from 'bun:test'

import {
  appendNarratedTraceEvent,
  beginNarratedTraceSession,
  buildNarratedTraceReviewSummary,
  buildNarratedContextMarkdown,
  compactNarratedTraceSession,
  finishNarratedTraceSession,
  narratedTraceSession,
  narratedTracePointsPath,
  removeNarratedTraceEventFromContext,
  restoreNarratedTraceEventToContext,
  isNarratedTraceSupportingEvent
} from '@/app/narrated-trace'
import type {
  NarratedTraceEvent,
  NarratedTraceEvidenceAnnotation,
  NarratedTraceSession
} from '@/app/narrated-trace'

function sampleSession(): NarratedTraceSession {
  return {
    contextDraft: [
      {
        editedText: 'Increase the patient header spacing.',
        included: true,
        removed: false,
        sourceEventId: 'speech'
      },
      { included: true, removed: false, sourceEventId: 'edit' },
      { included: true, removed: true, sourceEventId: 'noise' }
    ],
    durationMs: 31_000,
    events: [
      {
        atMs: 12_000,
        id: 'speech',
        kind: 'transcript',
        label: 'This needs more room.',
        text: 'This needs more room.'
      },
      {
        atMs: 16_000,
        changes: [{ after: 'space-5', before: 'space-3', property: 'padding' }],
        id: 'edit',
        kind: 'edit',
        label: 'Edited HeaderCard',
        target: {
          name: 'HeaderCard',
          path: ['DentalChart', 'PatientRecord', 'HeaderCard'],
          stableId: 'header-card'
        }
      },
      {
        atMs: 17_000,
        id: 'noise',
        kind: 'viewport',
        label: 'Changed canvas view'
      }
    ],
    id: 'trace-test',
    startedAt: '2026-07-12T12:00:00.000Z'
  }
}

function capturedSession(): NarratedTraceSession {
  const longPath = [
    'sidebar-inset',
    'ShellPageFrame',
    'DentalPatientRecord',
    'PatientHistoryPanel',
    'DataTable',
    'table-container',
    'table-header',
    'table-row',
    'table-head'
  ]
  return {
    contextDraft: [
      { included: true, removed: false, sourceEventId: 'frame-noise' },
      { included: true, removed: false, sourceEventId: 'cancellation' },
      { included: true, removed: false, sourceEventId: 'intent' },
      { included: true, removed: false, sourceEventId: 'table-edit' }
    ],
    durationMs: 55_000,
    events: [
      {
        atMs: 4000,
        changes: [
          {
            after: 'Dental Chart / Current Alternate 1',
            before: 'Dental Chart / Current Alternate 1',
            property: 'name'
          },
          {
            after: '[{"key":"status","value":"unmerged"}]',
            before: '[{"value":"unmerged","key":"status"}]',
            property: 'pluginData'
          }
        ],
        id: 'frame-noise',
        kind: 'edit',
        label: 'Edited Dental Chart / Current Alternate 1',
        target: {
          name: 'Dental Chart / Current Alternate 1',
          path: ['Document', 'Dental Chart', 'Dental Chart', 'Current Alternate 1'],
          stableId: '0:472'
        }
      },
      {
        atMs: 29_000,
        id: 'cancellation',
        kind: 'transcript',
        label: 'no no no move it back to where it was never mind',
        text: 'no no no move it back to where it was never mind'
      },
      {
        atMs: 40_000,
        id: 'intent',
        kind: 'transcript',
        label: 'I want to change the head of the table its radius corners',
        text: 'I want to change the head of the table its radius corners'
      },
      {
        atMs: 43_000,
        changes: [
          { after: '', property: 'tokens.add' },
          { after: '', property: 'tokens.remove' },
          { after: '8px', property: 'border-radius' }
        ],
        id: 'table-edit',
        kind: 'edit',
        label: 'Edited table-head',
        target: {
          name: 'table-head',
          path: longPath,
          stableId: 'container-2l-table-head'
        }
      }
    ],
    id: 'captured-trace',
    startedAt: '2026-07-12T21:28:26.992Z'
  }
}

describe('Narrated Trace context', () => {
  test('summarizes key outcomes while identifying supporting activity', () => {
    const events = [
      {
        atMs: 50_000,
        id: 'shape',
        kind: 'shape',
        label: 'Created Code Object',
        target: {
          name: 'Code Object',
          path: ['Page 1', 'Code Object'],
          stableId: 'code-object'
        }
      },
      {
        atMs: 51_000,
        id: 'selection',
        kind: 'selection',
        label: 'Selected Code Object'
      },
      {
        atMs: 145_000,
        id: 'ink',
        kind: 'ink',
        label: 'Drew an editable intent stroke'
      }
    ] satisfies NarratedTraceEvent[]

    expect(buildNarratedTraceReviewSummary(events)).toBe(
      'Created Code Object and marked the intended revision.'
    )
    expect(isNarratedTraceSupportingEvent(events[1])).toBe(true)
    expect(isNarratedTraceSupportingEvent(events[0])).toBe(false)
  })

  test('copies corrected text, semantic targets, and exact changes', () => {
    const session = sampleSession()
    session.title = 'Patient layout review'
    const markdown = buildNarratedContextMarkdown(session)

    expect(markdown).toContain('Trace: Patient layout review')
    expect(markdown).toContain('Increase the patient header spacing.')
    expect(markdown).toContain('- 00:12 — Increase the patient header spacing.')
    expect(markdown).not.toContain('This needs more room.')
    expect(markdown).toContain('DentalChart / PatientRecord / HeaderCard (header-card)')
    expect(markdown).toContain(
      'DentalChart / PatientRecord / HeaderCard.padding: space-3 -> space-5'
    )
  })

  test('omits removed context from the clipboard payload', () => {
    const markdown = buildNarratedContextMarkdown(sampleSession())

    expect(markdown).not.toContain('Changed canvas view')
  })

  test('removing context preserves the source event and can be restored', () => {
    beginNarratedTraceSession()
    const eventId = appendNarratedTraceEvent({
      kind: 'selection',
      label: 'C-selected HeaderCard'
    })
    expect(eventId).not.toBeNull()
    if (!eventId) return

    removeNarratedTraceEventFromContext(eventId)
    expect(narratedTraceSession.value?.events).toHaveLength(1)
    expect(
      narratedTraceSession.value?.contextDraft.find((entry) => entry.sourceEventId === eventId)
        ?.removed
    ).toBe(true)

    restoreNarratedTraceEventToContext(eventId)
    expect(
      narratedTraceSession.value?.contextDraft.find((entry) => entry.sourceEventId === eventId)
        ?.removed
    ).toBe(false)
    finishNarratedTraceSession()
  })

  test('coalesced edits retain the original before value', () => {
    beginNarratedTraceSession()
    appendNarratedTraceEvent(
      {
        atMs: 100,
        changes: [{ after: '12px', before: '8px', property: 'padding' }],
        kind: 'edit',
        label: 'Edited HeaderCard'
      },
      { coalesceKey: 'header-padding' }
    )
    appendNarratedTraceEvent(
      {
        atMs: 200,
        changes: [{ after: '16px', before: '12px', property: 'padding' }],
        kind: 'edit',
        label: 'Edited HeaderCard'
      },
      { coalesceKey: 'header-padding' }
    )

    expect(narratedTraceSession.value?.events).toHaveLength(1)
    expect(narratedTraceSession.value?.events[0]?.changes).toEqual([
      { after: '16px', before: '8px', property: 'padding' }
    ])
    finishNarratedTraceSession()
  })

  test('merges nearby browser speech fragments into readable thoughts', () => {
    beginNarratedTraceSession()
    appendNarratedTraceEvent(
      {
        atMs: 1000,
        kind: 'transcript',
        label: 'I want you to',
        text: 'I want you to'
      },
      { coalesceKey: 'transcript', coalesceWindowMs: 5000, mergeText: true }
    )
    appendNarratedTraceEvent(
      {
        atMs: 5000,
        kind: 'transcript',
        label: 'change the table header',
        text: 'change the table header'
      },
      { coalesceKey: 'transcript', coalesceWindowMs: 5000, mergeText: true }
    )
    appendNarratedTraceEvent(
      {
        atMs: 11_000,
        kind: 'transcript',
        label: 'make the corners round',
        text: 'make the corners round'
      },
      { coalesceKey: 'transcript', coalesceWindowMs: 5000, mergeText: true }
    )

    expect(narratedTraceSession.value?.events).toHaveLength(2)
    expect(narratedTraceSession.value?.events[0]?.text).toBe(
      'I want you to change the table header'
    )
    expect(narratedTraceSession.value?.events[0]?.durationMs).toBe(4000)
    finishNarratedTraceSession()
  })

  test('groups generated multi-layer refreshes into one bounded background moment', () => {
    beginNarratedTraceSession()
    for (let index = 0; index < 40; index += 1) {
      appendNarratedTraceEvent({
        atMs: 63_000,
        changes: [{ after: String(index + 1), before: String(index), property: 'width' }],
        kind: 'edit',
        label: `Edited generated layer ${index}`,
        target: {
          name: `Generated layer ${index}`,
          path: ['Document', `Generated layer ${index}`],
          stableId: `generated-${index}`
        }
      })
    }

    expect(narratedTraceSession.value?.events).toHaveLength(1)
    expect(narratedTraceSession.value?.events[0]).toMatchObject({
      groupedEventCount: 40,
      groupedTargetCount: 40,
      kind: 'sync',
      label: 'Grouped 40 canvas changes across 40 layers'
    })
    expect(narratedTraceSession.value?.contextDraft).toHaveLength(1)
    expect(buildNarratedContextMarkdown(narratedTraceSession.value)).toContain(
      'Grouped 40 canvas changes across 40 layers'
    )
    expect(buildNarratedContextMarkdown(narratedTraceSession.value)).not.toContain(
      'Generated layer 39.width'
    )
    finishNarratedTraceSession()
  })

  test('compacts legacy refresh noise without discarding curated moments', () => {
    const legacy = sampleSession()
    const generatedEvents = Array.from({ length: 24 }, (_, index) => ({
      atMs: 30_000,
      changes: [{ after: 'new', before: 'old', property: 'strokes' }],
      id: `legacy-generated-${index}`,
      kind: 'edit' as const,
      label: `Edited legacy layer ${index}`,
      target: {
        name: `Legacy layer ${index}`,
        path: ['Document', `Legacy layer ${index}`],
        stableId: `legacy-layer-${index}`
      }
    }))
    legacy.events.push(...generatedEvents)
    legacy.contextDraft.push(
      ...generatedEvents.map((event) => ({
        included: true,
        removed: false,
        sourceEventId: event.id
      }))
    )

    const compacted = compactNarratedTraceSession(legacy)
    expect(compacted.events).toHaveLength(4)
    expect(compacted.events.at(-1)).toMatchObject({
      groupedEventCount: 24,
      kind: 'sync'
    })
    expect(compacted.events[0]?.text).toBe('This needs more room.')
  })

  test('hard-caps copied context while preserving the earliest narrated intent', () => {
    const session = sampleSession()
    for (let index = 0; index < 220; index += 1) {
      const id = `annotated-moment-${index}`
      session.events.push({
        atMs: 20_000 + index,
        id,
        kind: 'transcript',
        label: `Supporting thought ${index} ${'detail '.repeat(120)}`,
        text: `Supporting thought ${index} ${'detail '.repeat(120)}`
      })
      session.contextDraft.push({
        included: true,
        note: `Clarification ${index} ${'note '.repeat(120)}`,
        removed: false,
        sourceEventId: id
      })
    }

    const markdown = buildNarratedContextMarkdown(session)

    expect(markdown).toContain('Increase the patient header spacing.')
    expect(markdown).toContain('Additional context omitted')
    expect(markdown.split('\n').length).toBeLessThanOrEqual(257)
    expect(new TextEncoder().encode(markdown).byteLength).toBeLessThanOrEqual(32_768)
  })

  test('cleans noisy real-session output and flags spoken cancellations', () => {
    const markdown = buildNarratedContextMarkdown(capturedSession())

    expect(markdown).not.toContain('pluginData')
    expect(markdown).not.toContain('tokens.add')
    expect(markdown).not.toContain('tokens.remove')
    expect(markdown).not.toContain('sidebar-inset')
    expect(markdown).toContain(
      '… / DataTable / table-container / table-header / table-row / table-head'
    )
    expect(markdown).toContain('## Review flags')
    expect(markdown).toContain('Possible cancellation')
    expect(markdown).toContain('table-head.border-radius: unknown -> 8px')
  })

  test('copies included evidence metadata without leaking cache keys or image bytes', () => {
    const session = sampleSession()
    session.contextDraft.push({ included: true, removed: false, sourceEventId: 'focus' })
    session.events.push({
      atMs: 20_000,
      evidence: {
        annotation: {
          bounds: { height: 40, width: 90, x: 100, y: 70 },
          color: '#8b5cf6',
          kind: 'focus',
          points: [
            { x: 100, y: 70 },
            { x: 145, y: 90 },
            { x: 190, y: 110 }
          ],
          strokeWidth: 24
        },
        cacheKey: 'narrated-trace/evidence/trace-test/evidence-focus',
        capturedAtMs: 20_000,
        cropBounds: { height: 120, width: 180, x: 60, y: 30 },
        evidenceId: 'evidence-focus',
        height: 120,
        mimeType: 'image/png',
        omissions: [{ bounds: { height: 20, width: 40, x: 10, y: 8 }, reason: 'patient-id' }],
        source: 'frame-snapshot',
        targetPath: ['DentalChart', 'PatientHeader'],
        targetStableId: 'patient-header',
        width: 180
      },
      id: 'focus',
      kind: 'screenshot',
      label: 'Focused PatientHeader'
    })

    const markdown = buildNarratedContextMarkdown(session)

    expect(markdown).toContain('## Visual evidence')
    expect(markdown).toContain('00:20 — focus trail with 3 points on DentalChart / PatientHeader')
    expect(markdown).toContain('evidence evidence-focus')
    expect(markdown).toContain('1 privacy region omitted')
    expect(markdown).not.toContain('narrated-trace/evidence')
    expect(markdown).not.toContain('data:image')
  })

  test('does not copy evidence removed during session review', () => {
    const session = sampleSession()
    session.contextDraft.push({ included: true, removed: true, sourceEventId: 'removed-focus' })
    session.events.push({
      atMs: 21_000,
      evidence: {
        annotation: {
          bounds: { height: 20, width: 20, x: 10, y: 10 },
          color: '#8b5cf6',
          kind: 'focus',
          points: [
            { x: 10, y: 10 },
            { x: 30, y: 30 }
          ],
          strokeWidth: 20
        },
        cacheKey: 'private-cache-key',
        capturedAtMs: 21_000,
        cropBounds: { height: 40, width: 40, x: 0, y: 0 },
        evidenceId: 'removed-evidence',
        height: 40,
        mimeType: 'image/png',
        omissions: [],
        source: 'canvas',
        width: 40
      },
      id: 'removed-focus',
      kind: 'screenshot',
      label: 'Removed focus evidence'
    })

    const markdown = buildNarratedContextMarkdown(session)

    expect(markdown).not.toContain('removed-evidence')
    expect(markdown).not.toContain('Removed focus evidence')
  })

  test('keeps legacy focus evidence viewable after the annotation format changes', () => {
    const session = sampleSession()
    const legacyAnnotation: NarratedTraceEvidenceAnnotation = {
      bounds: { height: 48, width: 48, x: 6, y: 6 },
      color: '#8b5cf6',
      kind: 'focus',
      points: [{ x: 30, y: 30 }],
      strokeWidth: 24
    }
    Reflect.deleteProperty(legacyAnnotation, 'points')
    session.contextDraft.push({ included: true, removed: false, sourceEventId: 'legacy-focus' })
    session.events.push({
      atMs: 22_000,
      evidence: {
        annotation: legacyAnnotation,
        cacheKey: 'legacy-focus-cache',
        capturedAtMs: 22_000,
        cropBounds: { height: 60, width: 60, x: 0, y: 0 },
        evidenceId: 'legacy-focus-evidence',
        height: 60,
        mimeType: 'image/png',
        omissions: [],
        source: 'canvas',
        width: 60
      },
      id: 'legacy-focus',
      kind: 'screenshot',
      label: 'Legacy focus capture'
    })

    expect(narratedTracePointsPath(undefined)).toBe('')
    expect(buildNarratedContextMarkdown(session)).toContain('00:22 — focus marker on Canvas')
  })
})
