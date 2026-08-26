import { describe, expect, test } from 'bun:test'

import { privacySafeLiveInspectorRoute } from '@/app/smylr-live-inspector/draft-cache'

describe('Smylr live-inspector draft cache', () => {
  test('keys drafts by path without credentials, query, or fragment data', () => {
    expect(
      privacySafeLiveInspectorRoute(
        'https://user:secret@app.example.com/patients/42?token=private#details'
      )
    ).toBe('/patients/42')
    expect(privacySafeLiveInspectorRoute('/patients/42?token=private')).toBe('/patients/42')
  })
})
