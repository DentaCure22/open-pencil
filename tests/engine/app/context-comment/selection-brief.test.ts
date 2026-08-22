import { describe, expect, test } from 'bun:test'

import { liveSelectionFromNode } from '@/app/context-comment/selection-brief'
import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'

const parent: SmylrLiveContainerNode = {
  id: 'header',
  label: 'Header',
  rect: { height: 48, width: 960, x: 0, y: 0 }
}

const node: SmylrLiveContainerNode = {
  attrs: {
    'data-slot': 'popover-anchor',
    id: 'patient-menu',
    value: 'should-not-copy'
  },
  className: 'inline-flex h-9 items-center justify-center rounded-md',
  computedStyle: {
    display: 'flex',
    'justify-content': 'center',
    position: 'relative',
    color: '#111'
  },
  id: 'anchor',
  label: 'popover-anchor',
  rect: { height: 32, width: 120, x: 840, y: 12 },
  role: 'button',
  source: {
    componentName: 'PopoverAnchor',
    filePath: 'src/components/ui/popover.tsx',
    lineNumber: 45,
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
    ]
  },
  tagName: 'button',
  text: 'Open menu',
  tokenHints: ['inline-flex', 'h-9', 'rounded-md']
}

describe('live container selection brief', () => {
  test('keeps identity, layout, and the owner chain', () => {
    expect(liveSelectionFromNode(node, parent)).toEqual({
      attrs: { 'data-slot': 'popover-anchor', id: 'patient-menu' },
      className: 'inline-flex h-9 items-center justify-center rounded-md',
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
      text: 'Open menu',
      tokenHints: ['inline-flex', 'h-9', 'rounded-md']
    })
  })
})
