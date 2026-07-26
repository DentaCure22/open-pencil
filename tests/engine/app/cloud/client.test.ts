import { describe, expect, test } from 'bun:test'

import { isOpenPencilCloudOptedIn } from '@/app/cloud/client'

describe('OpenPencil Cloud configuration', () => {
  test('requires an explicit opt-in', () => {
    expect(isOpenPencilCloudOptedIn(undefined)).toBe(false)
    expect(isOpenPencilCloudOptedIn('false')).toBe(false)
    expect(isOpenPencilCloudOptedIn('1')).toBe(false)
    expect(isOpenPencilCloudOptedIn(' true ')).toBe(true)
    expect(isOpenPencilCloudOptedIn('TRUE')).toBe(true)
  })
})
