import { describe, expect, test } from 'bun:test'

import { contextCommentPrompt } from '@/app/context-comment/prompt'
import type { ContextCommentDraft } from '@/app/context-comment/types'

const draft: ContextCommentDraft = {
  annotations: [
    {
      comment: 'remove this tag',
      id: 'annotation-1',
      x: 0.474,
      y: 0.222
    },
    {
      comment: 'this should be shorter',
      id: 'annotation-2',
      x: 0.23,
      y: 0.788
    }
  ],
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
    sourceHasTransparency: true,
    width: 480
  },
  captureContext: {
    boardBounds: { height: 200, width: 400, x: 100, y: 50 },
    screenBounds: { height: 400, width: 800, x: 240, y: 160 },
    viewport: { panX: 40, panY: 60, zoom: 2 }
  },
  captureSource: null,
  flow: 'screenshot',
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
  test('sends normalized screenshot comments and the live container selection', () => {
    const prompt = contextCommentPrompt(draft)

    expect(prompt).toStartWith(
      [
        'Image 1:',
        '1. (x: 47.4%, y: 22.2%) remove this tag',
        '2. (x: 23%, y: 78.8%) this should be shorter',
        '',
        'Additional instructions:',
        'center this please',
        '',
        'Board context:',
        'Crop (page space): x 100, y 50, width 400, height 200',
        'Viewport: panX 40, panY 60, zoom 2',
        'Comment points (page space):',
        '1. (x: 289.6, y: 94.4)',
        '2. (x: 192, y: 207.6)'
      ].join('\n')
    )
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
      annotations: [],
      capture: null,
      captureContext: null,
      flow: 'comment',
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

  test('turns image annotations into an edit request for the existing conversation', () => {
    const prompt = contextCommentPrompt({
      ...draft,
      destination: {
        action: 'follow-up',
        kind: 'agent-conversation',
        modelScope: 'task:thread-1',
        threadId: 'thread-1'
      },
      target: null
    })

    expect(prompt).toStartWith('Edit the attached image using the image editing tool.')
    expect(prompt).toContain('The source image has a transparent background.')
    expect(prompt).toContain('Preserve its alpha channel and keep the background transparent.')
    expect(prompt).toContain('Do not flatten it onto white, black, or any solid color')
    expect(prompt).toContain('1. (x: 47.4%, y: 22.2%) remove this tag')
    expect(prompt).toContain('Additional instructions:\ncenter this please')
    expect(prompt).not.toContain('Target:')
  })

  test('keeps an unsent image in the image-edit flow', () => {
    const prompt = contextCommentPrompt({
      ...draft,
      imageEdit: true,
      target: null
    })

    expect(prompt).toStartWith('Edit the attached image using the image editing tool.')
    expect(prompt).toContain('1. (x: 47.4%, y: 22.2%) remove this tag')
    expect(prompt).not.toContain('Target:')
  })

  test('does not add a transparency constraint for an opaque source image', () => {
    const prompt = contextCommentPrompt({
      ...draft,
      capture: draft.capture ? { ...draft.capture, sourceHasTransparency: false } : null,
      destination: {
        action: 'follow-up',
        kind: 'agent-conversation',
        modelScope: 'task:thread-1',
        threadId: 'thread-1'
      },
      target: null
    })

    expect(prompt).not.toContain('transparent background')
    expect(prompt).not.toContain('Preserve its alpha channel')
  })
})
