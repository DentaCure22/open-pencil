import { describe, expect, test } from 'bun:test'

import { cloudRequestErrorMessage, runCloudRequest } from '@/app/cloud/request'

describe('OpenPencil Cloud request deadline', () => {
  test('aborts a request and reports an actionable timeout', async () => {
    let aborted = false

    const request = runCloudRequest(
      (signal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true }
          )
        }),
      5
    )

    await expect(request).rejects.toThrow(
      'OpenPencil Cloud could not connect within 15 seconds. Wait a moment, then try again.'
    )
    expect(aborted).toBe(true)
  })

  test('turns retryable fetch failures into a useful message', () => {
    const error = new Error('Failed to fetch')
    error.name = 'AuthRetryableFetchError'

    expect(cloudRequestErrorMessage(error)).toBe(
      'OpenPencil Cloud could not reach its storage service. Wait a moment, then try again.'
    )
  })
})
