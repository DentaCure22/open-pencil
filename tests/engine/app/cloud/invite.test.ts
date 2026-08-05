import { describe, expect, test } from 'bun:test'

import { buildCofounderInviteUrl, readInviteToken } from '@/app/cloud/invite'

const TOKEN = 'a'.repeat(64)

describe('OpenPencil Cloud invites', () => {
  test('keeps only a valid one-time invite token', () => {
    expect(readInviteToken(`https://app.openpencil.dev/?invite=${TOKEN}`)).toBe(TOKEN)
    expect(readInviteToken('https://app.openpencil.dev/?invite=too-short')).toBeNull()
  })

  test('creates a clean root workspace URL', () => {
    expect(buildCofounderInviteUrl(TOKEN, 'https://app.openpencil.dev/share/room?old=1#x')).toBe(
      `https://app.openpencil.dev/?invite=${TOKEN}`
    )
  })
})
