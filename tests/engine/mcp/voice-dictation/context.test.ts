import { expect, test } from 'bun:test'

import { parseVoiceDictationContext } from '#mcp/voice-dictation/context'

test('voice context is reduced to bounded language data with clear scope priority', () => {
  const context = parseVoiceDictationContext({
    active: {
      conversationTitle: 'Smylr intake',
      recentPhrases: ['Open the Code Object'],
      terms: ['Smylr', 'OpenPencil']
    },
    global: { projectPaths: ['Dental / Patient portal', 17, 'Marketing'] },
    project: {
      childNames: ['Billing'],
      path: ['Dental', 'Patient portal'],
      todoTitles: ['Ship intake']
    }
  })
  expect(context).toEqual({
    active: {
      conversationTitle: 'Smylr intake',
      recentPhrases: ['Open the Code Object'],
      terms: ['Smylr', 'OpenPencil']
    },
    global: { projectPaths: ['Dental / Patient portal', 'Marketing'] },
    project: {
      childNames: ['Billing'],
      path: ['Dental', 'Patient portal'],
      todoTitles: ['Ship intake']
    }
  })
})

test('voice context rejects oversized input before creating a CLI session', () => {
  expect(() =>
    parseVoiceDictationContext({ active: { composerText: 'x'.repeat(25 * 1024) } })
  ).toThrow('Voice context is too large')
})
