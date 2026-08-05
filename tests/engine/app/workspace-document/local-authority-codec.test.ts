import { describe, expect, test } from 'bun:test'

import {
  decodeLocalWorkspaceDocument,
  encodeLocalWorkspaceDocument
} from '@/app/workspace-document/local-authority/codec'

describe('local workspace authority document codec', () => {
  test('round-trips nested binary Board data through JSON', () => {
    const source = {
      images: [['asset', new Uint8Array([0, 1, 127, 255])]],
      nodes: [
        [
          'node-1',
          {
            name: 'Dental Chart / Current',
            textPicture: new Uint8Array([8, 13, 21])
          }
        ]
      ]
    }

    const encoded = encodeLocalWorkspaceDocument(source)
    const transported = structuredClone(encoded)
    const decoded = decodeLocalWorkspaceDocument(transported)

    expect(decoded).toEqual(source)
  })

  test('matches JSON semantics for undefined object fields and array entries', () => {
    const source = {
      omitted: undefined,
      values: ['kept', undefined]
    }

    expect(encodeLocalWorkspaceDocument(source)).toEqual({
      values: ['kept', null]
    })
  })
})
