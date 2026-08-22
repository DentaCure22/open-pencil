import { describe, expect, test } from 'bun:test'

import { contextCommentPrompt } from '@/app/context-comment/prompt'
import type { ContextCommentDraft } from '@/app/context-comment/types'

const draft: ContextCommentDraft = {
  capture: {
    annotation: {
      bounds: { height: 80, width: 160, x: 10, y: 20 },
      color: '#2563eb',
      kind: 'focus',
      points: [],
      strokeWidth: 2
    },
    capturedAtMs: 1_787_052_800_000,
    cropBounds: { height: 240, width: 480, x: 0, y: 0 },
    evidenceId: 'evidence-1',
    height: 240,
    mimeType: 'image/png',
    omissions: [],
    source: 'frame-snapshot',
    width: 480
  },
  id: 'comment-1',
  target: {
    frameId: 'frame-1',
    elementKind: 'container',
    hierarchy: {
      children: [
        { label: 'Search patients', stableId: 'container-search' },
        { label: 'Add patient', stableId: 'container-add-patient' }
      ],
      current: { label: 'Popover anchor', stableId: 'container-u-popover-anchor' },
      parent: { label: 'Header', stableId: 'container-header' }
    },
    kind: 'live-container',
    label: 'Popover anchor',
    live: {
      attrs: { 'data-slot': 'popover-anchor', id: 'patient-menu' },
      className: 'inline-flex h-9 items-center justify-center',
      layout: {
        display: 'flex',
        'justify-content': 'center',
        position: 'relative'
      },
      localRect: { height: 32, width: 120, x: 840, y: 12 },
      ownerPath: [
        {
          componentName: 'PopoverAnchor',
          filePath: 'src/components/ui/popover.tsx',
          lineNumber: 45
        },
        {
          componentName: 'PatientsList',
          filePath: 'src/features/patient-admin/components/patients-list.tsx',
          lineNumber: 91
        }
      ],
      parentLabel: 'Header',
      parentRect: { height: 48, width: 960, x: 0, y: 0 },
      role: 'button',
      tagName: 'button',
      text: 'Open',
      tokenHints: ['inline-flex', 'h-9']
    },
    path: ['Patients', 'Header', 'Popover anchor'],
    route: '/patients',
    scope: {
      documentId: 'document-1',
      documentName: 'Smylr',
      pageId: 'page-1',
      pageName: 'Dental Chart',
      workspaceId: 'workspace-1'
    },
    source: {
      componentName: 'PatientsList',
      filePath: 'src/features/patient-admin/components/patients-list.tsx',
      lineNumber: 91
    },
    stableIds: ['container-u-popover-anchor']
  },
  text: '  center this please  '
}

describe('context comment worker prompt', () => {
  test('sends the live container selection, not just a label', () => {
    const prompt = contextCommentPrompt(draft)

    expect(prompt).toStartWith('center this please')
    expect(prompt).toContain('Target: Popover anchor')
    expect(prompt).toContain('Route: /patients')
    expect(prompt).toContain('Board frame: frame-1')
    expect(prompt).toContain('Live id: container-u-popover-anchor')
    expect(prompt).toContain(
      'Element: button#patient-menu.inline-flex.h-9.items-center.justify-center [role=button]'
    )
    expect(prompt).toContain('Text: Open')
    expect(prompt).toContain('Bounds: 120×32 at 840,12 in Header 960×48 at 0,0')
    expect(prompt).toContain('Layout: display:flex; justify-content:center; position:relative')
    expect(prompt).toContain('- PopoverAnchor src/components/ui/popover.tsx:45')
    expect(prompt).toContain(
      '- PatientsList src/features/patient-admin/components/patients-list.tsx:91'
    )
    expect(prompt).toContain('Parent: Header')
    expect(prompt).toContain('Children: Search patients, Add patient')
    expect(prompt).toContain('Classes: inline-flex h-9 items-center justify-center')
    expect(prompt).not.toContain('Authority:')
    expect(prompt).not.toContain('Honesty rule')
    expect(prompt).not.toContain('do not grep')
  })

  test('uses the selected object when there is no live container', () => {
    const prompt = contextCommentPrompt({
      ...draft,
      capture: null,
      target: {
        ...draft.target,
        kind: 'selection',
        label: 'Worker 3',
        live: undefined,
        route: undefined,
        source: undefined,
        stableIds: ['0:1630']
      }
    })

    expect(prompt).toBe(
      'center this please\n\nTarget: Worker 3 (0:1630)\nId: 0:1630\nPath: Patients / Header / Popover anchor'
    )
  })

  test('leaves routing decisions out of the worker brief', () => {
    const prompt = contextCommentPrompt(draft)

    expect(prompt).not.toContain('continue or steer')
    expect(prompt).not.toContain('create one new visible task')
    expect(prompt).not.toContain('Preserve one writer')
  })
})
