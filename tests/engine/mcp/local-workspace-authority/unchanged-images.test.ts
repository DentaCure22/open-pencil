import { describe, expect, test } from 'bun:test'

import { restoreUnchangedAuthorityImages } from '#mcp/local-workspace-authority/unchanged-images'

describe('unchanged Board images', () => {
  test('restores previous images and drops the wire flag', () => {
    const previous = {
      images: [['asset', { bytes: 12 }]],
      nodes: [['page', { name: 'Patients' }]]
    }
    const incoming = {
      images: [],
      imagesUnchanged: true,
      nodes: [['page', { name: 'Patients moved' }]]
    }

    expect(restoreUnchangedAuthorityImages(incoming, previous)).toEqual({
      images: previous.images,
      nodes: incoming.nodes
    })
  })

  test('leaves ordinary commits alone', () => {
    const incoming = { images: [['next', { bytes: 4 }]], nodes: [] }
    expect(restoreUnchangedAuthorityImages(incoming, { images: [['old', { bytes: 1 }]] })).toBe(
      incoming
    )
  })
})
