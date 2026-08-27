import { describe, expect, test } from 'bun:test'

import { createWorkMapTodoBrief } from '@/app/agent-chat/work-map-creation'

describe('Work Map creation', () => {
  test('turns uploaded evidence into a source-backed Todo brief', () => {
    const brief = createWorkMapTodoBrief(
      '',
      [
        {
          name: 'flow.png',
          path: '/uploads/flow.png',
          type: 'image/png',
          visual: {
            imagePaths: ['/uploads/flow.png'],
            kind: 'image',
            summary: 'Compact flow direction'
          }
        },
        { name: 'notes.txt', path: '/uploads/notes.txt', type: 'text/plain' }
      ],
      'Captured from the browser.'
    )

    expect(brief.goal).toBe('Review flow.png, notes.txt')
    expect(brief.context).toBe('Captured from the browser.')
    expect(brief.references).toEqual([
      {
        id: '/uploads/flow.png',
        kind: 'image',
        label: 'flow.png',
        note: 'Compact flow direction'
      },
      { id: '/uploads/notes.txt', kind: 'file', label: 'notes.txt' }
    ])
  })

  test('keeps an explicit goal when there are no attachments', () => {
    expect(createWorkMapTodoBrief('Refine the composer', []).goal).toBe('Refine the composer')
  })
})
