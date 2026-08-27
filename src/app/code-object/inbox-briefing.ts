import {
  codeObjectAgentPreset,
  createInboxBriefingReport,
  type InboxBriefingReport
} from '@open-pencil/core/code-object'

import { createUserCodeObjectDocument, type UserCodeObjectDocument } from './model'

export type InboxBriefingDocumentInput = {
  content: string
  id: string
  report?: InboxBriefingReport
  title: string
}

export function createInboxBriefingCodeObjectDocument(
  input: InboxBriefingDocumentInput
): UserCodeObjectDocument {
  const preset = codeObjectAgentPreset('briefing-report')
  const report =
    input.report ??
    createInboxBriefingReport(input.content, {
      title: input.title.replace(/\s+briefing$/i, '').trim() || 'Scheduled briefing'
    })

  return createUserCodeObjectDocument({
    boardPermissions: [],
    definitionId: `openpencil.inbox-briefing.${input.id.replace(/[^a-zA-Z0-9._-]+/g, '-')}`,
    modality: preset.modality,
    name: input.title,
    presetId: preset.id,
    props: { report },
    source: preset.source,
    state: {},
    surface: preset.surface
  })
}
