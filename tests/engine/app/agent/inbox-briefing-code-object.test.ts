import { expect, test } from 'bun:test'

import { createInboxBriefingCodeObjectDocument } from '@/app/code-object/inbox-briefing'

test('materializes an Inbox-owned briefing as a real preset-backed Code Object document', () => {
  const document = createInboxBriefingCodeObjectDocument({
    content: ['# Daily check', '', 'All systems are healthy.'].join('\n'),
    id: 'briefing:daily',
    title: 'Daily review briefing'
  })

  expect(document).toMatchObject({
    boardPermissions: [],
    component: 'user-code',
    definitionId: 'openpencil.inbox-briefing.briefing-daily',
    modality: 'document',
    name: 'Daily review briefing',
    presetId: 'briefing-report',
    props: {
      report: {
        summary: 'All systems are healthy.',
        title: 'Daily check',
        version: 1
      }
    },
    runtime: 'openpencil-code',
    surface: { background: 'surface', overflow: 'scroll' }
  })
})
