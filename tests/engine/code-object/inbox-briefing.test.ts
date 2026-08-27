import { describe, expect, test } from 'bun:test'

import {
  BRIEFING_REPORT_CODE_OBJECT_SOURCE,
  codeObjectAgentPreset,
  createInboxBriefingReport,
  isInboxBriefingReport,
  preflightCodeObjectSource
} from '@open-pencil/core/code-object'

describe('Inbox briefing Code Object', () => {
  test('turns the scheduled worker response into a bounded report model', () => {
    const report = createInboxBriefingReport(
      [
        '# Morning check',
        '',
        'Three things are worth knowing.',
        '',
        '## Needs attention',
        '',
        '- **Fantasy draft tomorrow** — Starts at 7:15 PM CDT.',
        '- **Financial aid** — Accept or decline the pending loans.',
        '',
        '## Worth knowing',
        '',
        '- **CampusCare waiver approved** — The Fall fee was waived.'
      ].join('\n'),
      {
        generatedAt: '2026-08-26T22:55:00.000Z',
        title: 'Fallback title'
      }
    )

    expect(report).toEqual({
      generatedAt: '2026-08-26T22:55:00.000Z',
      sections: [
        {
          id: 'needs-attention',
          items: [
            {
              detail: 'Starts at 7:15 PM CDT.',
              id: 'needs-attention-fantasy-draft-tomorrow',
              title: 'Fantasy draft tomorrow'
            },
            {
              detail: 'Accept or decline the pending loans.',
              id: 'needs-attention-financial-aid',
              title: 'Financial aid'
            }
          ],
          title: 'Needs attention',
          tone: 'attention'
        },
        {
          id: 'worth-knowing',
          items: [
            {
              detail: 'The Fall fee was waived.',
              id: 'worth-knowing-campuscare-waiver-approved',
              title: 'CampusCare waiver approved'
            }
          ],
          title: 'Worth knowing',
          tone: 'neutral'
        }
      ],
      summary: 'Three things are worth knowing.',
      title: 'Morning check',
      version: 1
    })
    expect(isInboxBriefingReport(report)).toBe(true)
  })

  test('registers a valid scrollable document preset', async () => {
    const preset = codeObjectAgentPreset('briefing-report')

    expect(preset).toMatchObject({
      id: 'briefing-report',
      modality: 'document',
      surface: { background: 'surface', overflow: 'scroll' }
    })
    expect(preset.source).toBe(BRIEFING_REPORT_CODE_OBJECT_SOURCE)
    expect(await preflightCodeObjectSource(BRIEFING_REPORT_CODE_OBJECT_SOURCE)).toMatchObject({
      syntax: 'passed'
    })
  })

  test('promotes a legacy opening bold line into the document title', () => {
    const report = createInboxBriefingReport(
      [
        '**Check — Wed Aug 26, ~10:55 PM CDT**',
        '',
        'Gmail connected. No new mail since the prior check.',
        '',
        '**Needs attention**',
        '',
        "- **Fantasy draft tomorrow** — *Omar's Outrageous Team* starts at 7:15 PM CDT."
      ].join('\n'),
      { title: 'Morning Email Check Assistant' }
    )

    expect(report).toMatchObject({
      sections: [
        {
          items: [
            {
              detail: "Omar's Outrageous Team starts at 7:15 PM CDT.",
              title: 'Fantasy draft tomorrow'
            }
          ],
          title: 'Needs attention'
        }
      ],
      summary: 'Gmail connected. No new mail since the prior check.',
      title: 'Check — Wed Aug 26, ~10:55 PM CDT'
    })
  })
})
