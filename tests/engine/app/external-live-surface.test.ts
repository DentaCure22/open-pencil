import { beforeEach, describe, expect, test } from 'bun:test'

import type { BrowserElementSelection } from '@/app/browser-inspector/contracts'
import { acceptBrowserElementSelection, browserInspectorState } from '@/app/browser-inspector/state'
import { codeObjectDocument } from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'
import {
  externalLiveSurfaceCaptureGeometry,
  externalLiveSurfaceSourceFromSelection,
  parseExternalLiveSurfacePreview,
  parseExternalLiveSurfaceSource
} from '@/app/external-live-surface/contracts'
import { placeBrowserSelectionAsLiveSurface } from '@/app/external-live-surface/drop'

function selection(): BrowserElementSelection {
  return {
    capturedAt: '2026-08-22T12:00:00.000Z',
    element: {
      accessibleName: 'Patient search',
      attributes: { 'aria-label': 'Patient search' },
      bounds: { height: 40, width: 280, x: 220, y: 80 },
      classes: ['patient-search'],
      role: 'searchbox',
      selector: '[aria-label="Patient search"]',
      tag: 'input',
      text: ''
    },
    id: 'selection-1',
    page: {
      origin: 'https://example.com',
      title: 'Patients',
      url: 'https://example.com/patients'
    },
    session: {
      captureSessionId: 'capture-session-1',
      captureStartedAt: '2026-08-22T12:00:00.000Z',
      frameId: 0,
      sequence: 1,
      tabId: 12
    },
    snapshot: { dataUrl: 'data:image/png;base64,Y29udGV4dA==', height: 360, width: 640 },
    sourceWindow: {
      devicePixelRatio: 2,
      innerHeight: 800,
      innerWidth: 1_200,
      outerHeight: 900,
      outerWidth: 1_200,
      screenX: 40,
      screenY: 20
    },
    surfacePreview: {
      dataUrl: 'data:image/png;base64,c3VyZmFjZQ==',
      height: 80,
      width: 560
    }
  }
}

beforeEach(() => {
  browserInspectorState.activeSessionId = null
  browserInspectorState.annotationRequest = null
  browserInspectorState.error = null
  browserInspectorState.expandedSessionId = null
  browserInspectorState.pickerStatus = 'idle'
  browserInspectorState.sessions.splice(0)
})

describe('external live surfaces', () => {
  test('derives a bounded window-relative capture from Chrome geometry', () => {
    const source = externalLiveSurfaceSourceFromSelection(selection())
    expect(parseExternalLiveSurfaceSource(source)).toEqual(source)
    expect(externalLiveSurfaceCaptureGeometry(source)).toEqual({
      region: { height: 40, width: 280, x: 220, y: 180 },
      sourceWindow: { height: 900, width: 1_200, x: 40, y: 20 }
    })
    expect(parseExternalLiveSurfaceSource({ ...source, tabId: 1.5 })).toBeNull()
    expect(parseExternalLiveSurfacePreview(selection().surfacePreview)).toEqual(
      selection().surfacePreview
    )
  })

  test('places the exact selected pixels as one persisted Code Object', () => {
    const store = createEditorStore()
    const captured = selection()
    acceptBrowserElementSelection(captured)
    const frame = placeBrowserSelectionAsLiveSurface(store, 'capture-session-1', captured.id, {
      x: 500,
      y: 300
    })
    if (!frame) throw new Error('Live surface was not created')

    expect(frame).toMatchObject({ height: 40, name: 'Patient search · input', width: 280 })
    expect(frame.x).toBe(360)
    expect(frame.y).toBe(280)
    expect(codeObjectDocument(frame)).toMatchObject({
      captureSource: {
        kind: 'chrome-element',
        selectionId: 'selection-1',
        tabId: 12
      },
      component: 'external-live-surface',
      preview: captured.surfacePreview,
      state: { view: 'live' }
    })
    expect([...store.state.selectedIds]).toEqual([frame.id])
  })

  test('falls back to the annotated context preview for older captures', () => {
    const store = createEditorStore()
    const captured = selection()
    delete captured.surfacePreview
    acceptBrowserElementSelection(captured)
    const frame = placeBrowserSelectionAsLiveSurface(store, 'capture-session-1', captured.id, {
      x: 200,
      y: 100
    })
    expect(codeObjectDocument(frame)?.preview).toEqual(captured.snapshot)
  })
})
