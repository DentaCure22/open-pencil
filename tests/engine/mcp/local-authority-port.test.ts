import { describe, expect, test } from 'bun:test'
import { createServer } from 'node:net'

import { assertLocalAuthorityPortAvailable } from '#mcp/local-authority-port'

describe('local authority port ownership', () => {
  test('fails before router initialization when another authority owns the port', async () => {
    const owner = createServer()
    await new Promise<void>((resolve, reject) => {
      owner.once('error', reject)
      owner.listen(0, '127.0.0.1', resolve)
    })
    const address = owner.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP test address')

    await expect(
      assertLocalAuthorityPortAvailable('127.0.0.1', address.port)
    ).rejects.toMatchObject({ code: 'EADDRINUSE' })

    await new Promise<void>((resolve, reject) => {
      owner.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  })
})
