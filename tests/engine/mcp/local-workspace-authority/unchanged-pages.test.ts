import { describe, expect, test } from 'bun:test'

import { restoreUnchangedAuthorityPages } from '#mcp/local-workspace-authority/unchanged-pages'

describe('unchanged Board pages', () => {
  test('restores retained page trees and drops the wire flag', () => {
    const previous = {
      nodes: [
        ['root', { childIds: ['patients', 'chart'], type: 'DOCUMENT' }],
        ['patients', { childIds: ['card'], name: 'Patients', type: 'CANVAS' }],
        ['card', { childIds: [], name: 'Card' }],
        ['chart', { childIds: ['tooth'], name: 'Dental Chart', type: 'CANVAS' }],
        ['tooth', { childIds: [], name: 'Tooth' }]
      ]
    }
    const incoming = {
      nodes: [
        ['root', { childIds: ['patients', 'chart'], type: 'DOCUMENT' }],
        ['patients', { childIds: ['card'], name: 'Patients moved', type: 'CANVAS' }],
        ['card', { childIds: [], name: 'Card moved' }]
      ],
      retainedPageIds: ['chart']
    }

    expect(restoreUnchangedAuthorityPages(incoming, previous)).toEqual({
      nodes: [
        ['root', { childIds: ['patients', 'chart'], type: 'DOCUMENT' }],
        ['patients', { childIds: ['card'], name: 'Patients moved', type: 'CANVAS' }],
        ['card', { childIds: [], name: 'Card moved' }],
        ['chart', { childIds: ['tooth'], name: 'Dental Chart', type: 'CANVAS' }],
        ['tooth', { childIds: [], name: 'Tooth' }]
      ]
    })
  })

  test('leaves ordinary commits alone', () => {
    const incoming = { nodes: [['root', { childIds: [] }]] }
    expect(restoreUnchangedAuthorityPages(incoming, { nodes: [['old', {}]] })).toBe(incoming)
  })
})
