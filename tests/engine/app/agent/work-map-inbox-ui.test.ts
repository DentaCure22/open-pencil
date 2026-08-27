import { expect, test } from 'bun:test'

test('uses the project open-close motion without disclosure arrows', async () => {
  const [botRow, surface, projectTree, scheduledSection, conversation, panel, briefing] =
    await Promise.all([
      Bun.file('src/components/agent-chat/WorkMapBotRow.vue').text(),
      Bun.file('src/components/agent-chat/AgentWorkMapSurface.vue').text(),
      Bun.file('src/components/agent-chat/WorkMapProjectTree.vue').text(),
      Bun.file('src/components/agent-chat/WorkMapScheduledSection.vue').text(),
      Bun.file('src/components/ai-elements/AiConversationSurface.vue').text(),
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/components/agent-chat/InboxBriefingObjectSurface.vue').text()
    ])
  const motionClasses = [
    'grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none',
    'grid-rows-[0fr] opacity-0',
    'grid-rows-[1fr] opacity-100'
  ]

  for (const className of motionClasses) {
    expect(surface).toContain(className)
    expect(projectTree).toContain(className)
  }
  expect(surface).toContain('data-test-id="work-map-inbox-toggle"')
  expect(surface).toContain(':aria-expanded="isWorkMapInboxOpen()"')
  expect(surface).toContain('@click="toggleWorkMapInbox"')
  expect(surface).toContain('data-test-id="work-map-inbox-unopened-count"')
  expect(surface.indexOf('data-test-id="work-map-inbox"')).toBeLessThan(
    surface.indexOf('<WorkMapProjectTree')
  )
  expect(surface).toContain('{{ item.title }}')
  expect(surface).not.toContain('{{ item.summary }}')
  expect(surface).toContain('openInboxBriefing(item)')
  expect(surface).toContain('archiveInboxItem(item)')
  expect(conversation).toContain('noun="briefing object"')
  expect(conversation).toContain('direct-label="Scheduled result"')
  expect(conversation).toContain('direct')
  expect(conversation).toContain("emit('open-linked-object', objectId)")
  expect(briefing).not.toContain('<AiMarkdown')
  expect(briefing).toContain('createInboxBriefingCodeObjectDocument')
  expect(briefing).toContain('runtime.renderCodeObject')
  expect(briefing).toContain('data-test-id="inbox-briefing-code-object-host"')
  expect(briefing).toContain('data-test-id="inbox-briefing-open-message"')
  expect(briefing).toContain('{{ title }}')
  expect(briefing).not.toContain('<icon-lucide-file-text')
  expect(briefing).not.toContain('uppercase">Briefing')
  expect(briefing).not.toContain('border-b')
  expect(panel).toContain('agentRightPanelState.value.objectTitle')
  expect(surface.indexOf('work-map-inbox-unopened-count')).toBeLessThan(
    surface.indexOf('work-map-inbox-content')
  )
  const receiptRows = surface.slice(
    surface.indexOf('v-for="item in workMapView.inbox.slice(0, 8)"'),
    surface.indexOf('v-if="!workMapView.inbox.length"')
  )
  expect(receiptRows).not.toContain('focus-within:ring')
  expect(receiptRows).not.toContain("item.status === 'completed'")
  expect(receiptRows).not.toContain('class="size-1.5 shrink-0 rounded-full"')
  expect(receiptRows).toContain('focus-visible:bg-hover')
  expect(surface).not.toContain('<icon-lucide-chevron-right')
  expect(botRow).not.toContain('<icon-lucide-chevron-right')
  expect(projectTree).not.toContain('<icon-lucide-chevron-right')
  expect(scheduledSection).not.toContain('<icon-lucide-chevron-right')
  expect(scheduledSection).toContain("routine.briefingObject ? 'text-accent' : 'text-muted'")
  expect(scheduledSection).toContain(
    'pointer-events-none flex size-6 shrink-0 items-center justify-center rounded-[5px] opacity-0'
  )
  expect(scheduledSection).toContain('group-hover/schedule:pointer-events-auto')
  expect(scheduledSection).not.toContain("'text-accent opacity-100'")
  expect(botRow).toContain('class="flex h-10 w-7 shrink-0 items-center justify-center"')
  expect(botRow).toContain('class="h-10 w-11"')
  expect(projectTree).toContain('class="flex h-10 w-7 shrink-0 items-center justify-center')
  expect(projectTree).toContain('class="h-10 w-11"')
})
