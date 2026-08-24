import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  readPublishedLocalAuthorityToken,
  resolveDevLocalAuthorityAuthToken
} from '../../../vite/local-workspace-authority'

describe('local workspace authority Vite plugin', () => {
  test('prefers an explicit dev token, then the published live token', () => {
    expect(
      resolveDevLocalAuthorityAuthToken(
        { OPENPENCIL_DEV_TOKEN: '  explicit-token  ' },
        () => 'published-token'
      )
    ).toBe('explicit-token')
    expect(resolveDevLocalAuthorityAuthToken({}, () => 'published-token')).toBe('published-token')
    expect(resolveDevLocalAuthorityAuthToken({}, () => null)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  test('reads a published agent-auth token when the file exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openpencil-authority-auth-'))
    try {
      expect(readPublishedLocalAuthorityToken(root)).toBeNull()
      await writeFile(
        join(root, 'agent-auth.json'),
        JSON.stringify({ token: 'live-token', port: 7602 }),
        'utf8'
      )
      expect(readPublishedLocalAuthorityToken(root)).toBe('live-token')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
