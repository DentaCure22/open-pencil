import { describe, expect, test } from 'bun:test'

describe('agent Work map UI contract', () => {
  test('keeps project chats categorized and loose chats under Chats', async () => {
    const [
      client,
      conversationActions,
      navigation,
      objectNavigation,
      panelShell,
      persistence,
      botRow,
      projectChats,
      projectTree,
      scheduledSection,
      surface,
      surfaceState,
      workMapBotIcon,
      workMapView
    ] = await Promise.all([
      Bun.file('src/app/agent-chat/work-map.ts').text(),
      Bun.file('src/app/agent-chat/panel-conversation-actions.ts').text(),
      Bun.file('src/app/agent-chat/work-map-navigation.ts').text(),
      Bun.file('src/app/agent-chat/panel-object-navigation.ts').text(),
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/app/agent-chat/work-map-persistence.ts').text(),
      Bun.file('src/components/agent-chat/WorkMapBotRow.vue').text(),
      Bun.file('src/components/agent-chat/WorkMapProjectChats.vue').text(),
      Bun.file('src/components/agent-chat/WorkMapProjectTree.vue').text(),
      Bun.file('src/components/agent-chat/WorkMapScheduledSection.vue').text(),
      Bun.file('src/components/agent-chat/AgentWorkMapSurface.vue').text(),
      Bun.file('src/app/agent-chat/work-map-surface-state.ts').text(),
      Bun.file('src/components/agent-chat/WorkMapBotIcon.vue').text(),
      Bun.file('src/app/agent-chat/work-map-view.ts').text()
    ])
    const panel = `${panelShell}\n${surface}\n${projectTree}\n${botRow}\n${projectChats}\n${scheduledSection}`

    expect(panelShell).toContain('<AgentWorkMapSurface')
    expect(surface).toContain('<WorkMapProjectTree')

    expect(client).toContain("'/agent-router/v1/pi/work-map'")
    expect(client).toContain("'/agent-router/v1/pi/work-map/apply'")
    expect(client).toContain("'/agent-router/v1/pi/work-map/todo-chats'")
    expect(client).toContain('/agent-router/v1/pi/work-map/routines/')
    expect(client).toContain("op: 'place_chat'")
    expect(client).toContain("op: 'create_todo'")
    expect(client).toContain("op: 'update_todo'")
    expect(client).toContain("op: 'archive_todo'")
    expect(client).toContain("op: 'restore_todo'")
    expect(client).toContain('setAgentWorkMapTodosArchivedForThread')

    expect(panel).toContain('Work map')
    expect(panel).not.toMatch(/>\s*Pinned\s*</)
    expect(panel).not.toMatch(/>\s*Global\s*</)
    expect(surface).toContain('data-test-id="work-map-global-bots"')
    expect(surface).not.toContain('work-map-new-global-bot')
    expect(panel).toContain('data-test-id="work-map-inbox"')
    expect(surface.indexOf('data-test-id="work-map-inbox"')).toBeLessThan(
      surface.indexOf('<WorkMapProjectTree')
    )
    expect(surface).toContain('data-test-id="work-map-inbox-toggle"')
    expect(surface).toContain('data-test-id="work-map-inbox-unopened-count"')
    expect(surface).toContain('class="ml-1 text-[12px] font-medium text-surface"')
    expect(surface).toContain('group/inbox-toggle flex h-11')
    expect(surface).toContain('ml-3 min-w-0 flex-1 truncate text-[15px]')
    expect(surface).not.toContain('bg-accent/15 px-1.5 py-0.5')
    expect(surface).toContain('data-test-id="work-map-inbox-content"')
    expect(surface).toContain('v-for="(item, itemIndex) in workMapView.inbox.slice(0, 8)"')
    expect(surface).toContain('group/inbox relative z-10 ml-8')
    expect(surface).toContain('itemIndex === Math.min(workMapView.inbox.length, 8) - 1')
    expect(surface).toContain(':aria-expanded="isWorkMapInboxOpen()"')
    expect(surface).toContain('@click="toggleWorkMapInbox"')
    expect(surface).toContain('unopened scheduled update')
    expect(surface).toMatch(
      /work-map-inbox-content[\s\S]*transition-\[grid-template-rows,opacity\][\s\S]*duration-300 ease-in-out/
    )
    expect(projectTree).not.toContain('work-map-project-bots-')
    expect(surface).not.toContain('WorkMapBotIcon')
    expect(projectTree).toContain('<WorkMapBotIcon')
    expect(projectTree).toContain(':variant="entry.avatarVariant"')
    expect(projectTree).toContain('data-work-map-directory="bot"')
    expect(surface).toContain('<WorkMapBotRow')
    expect(projectTree).not.toContain('<WorkMapBotRow')
    expect(botRow).toContain('<WorkMapBotIcon')
    expect(botRow).toContain(':variant="bot.avatarVariant"')
    expect(projectTree).toContain('class="h-10 w-11"')
    expect(projectTree).toContain('class="flex h-10 w-7 shrink-0')
    expect(projectTree).toContain('ml-3 min-w-0 truncate text-[15px]')
    expect(botRow).toContain('class="h-10 w-11"')
    expect(botRow).toContain('class="flex h-10 w-7 shrink-0')
    expect(botRow).toContain('ml-3 min-w-0 flex-1 truncate text-[15px]')
    expect(projectTree).toContain('text-[13px] font-medium text-surface')
    expect(projectTree).toContain('text-left text-[12.5px] text-surface')
    expect(botRow).toContain('px-2 text-[13px] font-medium text-surface')
    expect(botRow).toContain('text-left text-[12.5px] text-surface')
    expect(scheduledSection).toContain('px-2 text-[13px] font-medium text-surface')
    expect(scheduledSection).toContain('truncate text-[12px] leading-4 text-surface')
    expect(scheduledSection).toContain('truncate text-[10px] leading-3.5 text-muted/65')
    expect(botRow).toContain('name="activity" class="size-[16px]')
    expect(botRow).toContain('name="time-circle" class="size-[16px]')
    expect(scheduledSection).toContain('class="size-[16px]')
    expect(botRow).toContain(
      'class="group/bot relative z-10 flex h-11 w-full cursor-pointer items-center'
    )
    expect(botRow).toContain('data-work-map-directory="bot"')
    expect(botRow).toContain('work-map-bot-directory-content-')
    expect(projectTree).not.toMatch(/>\s*Bots\s*</)
    expect(workMapBotIcon).toContain('comparison-original-neutral/original.webp')
    expect(workMapBotIcon).toContain('approved-family/motion/mint-round.webp')
    expect(workMapBotIcon).toContain('approved-family/motion/ivory-twin-thruster.webp')
    expect(workMapBotIcon).toContain('approved-family/motion/coral-hover-puck.webp')
    expect(workMapBotIcon).toContain('approved-family/motion/graphite-utility.webp')
    expect(workMapBotIcon).toContain('approved-family/motion/orange-glider.webp')
    expect(workMapBotIcon).not.toContain('unit-v2')
    expect(workMapBotIcon).not.toContain('workMapBotMote')
    expect(workMapBotIcon).toContain('prefers-reduced-motion: reduce')
    expect(workMapBotIcon).toContain(':data-test-id="`work-map-bot-avatar-')
    expect(workMapBotIcon).toContain(':data-variant="normalizedVariant"')
    expect(workMapBotIcon).toContain('isAnimating ? asset.motion : asset.still')
    expect(workMapBotIcon).toContain('scale-[1.08]')
    expect(workMapBotIcon).toContain('crypto.getRandomValues(sample)')
    expect(workMapBotIcon).toContain('setTimeout(playMotion, idleMotionDelay())')
    expect(workMapBotIcon).not.toContain('@pointerenter="playMotion"')
    expect(surface).not.toMatch(/>\s*Bots\s*</)
    expect(projectTree).toContain('<WorkMapBotIcon')
    expect(surface).toContain('<icon-lucide-bot')
    expect(panel).not.toContain('<WorkMapRoutineDialog')
    expect(panel).not.toContain('work-map-routine-dialog')
    expect(botRow).toContain('work-map-bot-summary-')
    expect(botRow).toContain('>In motion</span>')
    expect(botRow).toContain('>Todo</span>')
    expect(botRow).toContain('<WorkMapScheduledSection')
    expect(scheduledSection).toContain('<span>Scheduled</span>')
    expect(scheduledSection).toContain('work-map-scheduled-item-')
    expect(scheduledSection).toContain("op: 'create_routine'")
    expect(scheduledSection).not.toContain('bots[0]')
    expect(projectTree).toContain(':schedule-bot="entry.directoryBot"')
    expect(botRow).toContain(':schedule-bot="bot"')
    expect(scheduledSection).toContain('create_briefing_object')
    expect(scheduledSection).toContain('Create a briefing object')
    expect(scheduledSection).toContain("op: 'update_routine'")
    expect(scheduledSection).toContain('work-map-toggle-briefing-')
    expect(scheduledSection).toContain("op: 'delete_routine'")
    expect(scheduledSection).not.toContain('draggable="true"')
    expect(surface).not.toContain('startNewBot(null)')
    expect(panel).toContain('startNewBot(entry.project.id)')
    expect(conversationActions).toContain('createBot: true')
    expect(navigation).toContain("op: 'mark_inbox_read'")
    expect(projectTree.indexOf('<WorkMapScheduledSection')).toBeLessThan(
      projectTree.indexOf('v-for="status in workMapTodoStatuses"')
    )
    expect(scheduledSection).toContain('No scheduled work')
    expect(scheduledSection).not.toContain('Start a chat to activate scheduling')
    expect(projectTree).not.toContain('work-map-project-chats-')
    expect(projectTree).not.toMatch(/>\s*Chats\s*</)
    expect(projectTree).toContain('<WorkMapProjectChats')
    expect(projectTree).toContain('v-if="status === \'in_motion\'"')
    expect(projectChats).toContain('work-map-project-in-motion-chats-')
    expect(panel).toContain('Chats')
    expect(workMapView).toContain('misc: WorkMapViewGroup<AgentConversationThread>')
    expect(panel).not.toMatch(
      /<span v-else class="mr-1[^"]*tabular-nums[^"]*">\s*\{\{ miscThreads\.length \}\}/
    )
    expect(panel).not.toContain('Live chats')
    expect(panel).not.toContain('Project tasks')
    expect(panel).not.toMatch(/>\s+Tasks\s+<\/span>/)
    expect(projectChats).toContain('in entry.threads.items"')
    expect(panel).toContain('v-for="thread in workMapView.misc.items"')
    expect(panel).not.toContain(
      'v-for="thread in entry.misc ? miscThreads : projectThreads(entry.project.id)"'
    )
    expect(surfaceState).toContain("const workMapTodoStatuses = ['todo', 'in_motion']")
    expect(panel).not.toContain('Finished tasks are complete.')
    expect(panel).not.toContain('group/finished')
    expect(panel).not.toContain('work-map-open-finished')
    expect(projectTree).not.toContain('startDirectoryConversation')
    expect(surface).toContain("beginCreateDrag($event, 'chat')")
    expect(projectTree).toContain('if (entry.directoryBot)')
    expect(projectTree).toContain('@click.stop="openDirectoryBot(entry)"')
    expect(projectTree).toContain('work-map-open-bot-chat-')
    expect(projectTree).toContain('work-map-project-toggle-')
    expect(projectTree).toContain('<icon-lucide-chevron-right')
    expect(projectTree).toContain(':aria-expanded="isWorkMapProjectOpen(entry.project.id)"')
    expect(projectTree).toContain(':aria-controls="`work-map-project-content-')
    expect(projectTree).toContain('group-hover/project:opacity-100')
    expect(persistence).toContain(
      "{ op: 'place_chat', project_id: projectId, thread_id: threadId }"
    )
    expect(panel).not.toContain("dropWorkMapTodo($event, entry.project.id, 'finished')")
    expect(panel).not.toContain('v-if="projectTodos(entry.project.id, status).length"')
    expect(panel).not.toContain('v-if="projectTodos(entry.project.id, \'finished\').length"')
    expect(panel).toContain("view.value = 'list'\n  await loadWorkMap()")
    expect(panel).toContain('AppScrollAreaScrollbar')
    expect(panel).toContain('data-test-id="work-map-create-dialog"')
    expect(panel).toContain(`data-test-id="\`work-map-todo-composer-\${entry.project.id}\`"`)
    expect(panel).toContain('v-model:attachments="workMapTodoComposerAttachments"')
    expect(panel).toContain('compact')
    expect(panel).toContain('@send="submitWorkMapTodo"')
    expect(panel).not.toContain('Save later work in')
    expect(panel).not.toContain("{ kind: 'todo'; projectId: string; projectName: string }")
    expect(panel).toContain('data-test-id="agent-todo-brief"')
    expect(panel).toContain('data-test-id="agent-todo-link"')
    expect(panel).toContain(':aria-label="`Open Todo: ')
    expect(panel).toContain('selectedTodoDraft.brief.goal')
    expect(panel).not.toContain('Todo ready')
    expect(panel).not.toContain('Evidence & references')
    expect(panel).not.toContain('Start here')
    expect(panel).toContain('initialAtBottom: !selectedTodoDraft')
    expect(panel).toContain('@click="openWorkMapTodo(todo)"')
    expect(panel).toContain('data-test-id="agent-selected-todo-object"')
    expect(objectNavigation).toContain("openAgentRightPanel('object'")
    expect(panel).toContain(':todo-draft="rightPanelTodoDraft"')
    expect(panel).not.toContain(':todo-pinned="rightPanelTodoPinned"')
    expect(client).toContain('openAgentWorkMapProjectPage')
    expect(client).toContain('body: JSON.stringify({ pageId: destination })')
    expect(panel).toContain(':label="`Reveal ')
    expect(panel).toContain('entry.project.name} on Board`"')
    expect(panel).toContain('work-map-reveal-project-')
    expect(panel).not.toContain('work-map-reveal-todo-')
    expect(panel).toContain('group/todo relative z-10')
    expect(panel).toContain('group-hover/todo:pointer-events-auto')
    expect(panel).toContain('group-hover/todo:opacity-100')
    expect(panel).toContain('group-hover/project:pointer-events-auto')
    expect(panel).toContain('group-hover/project:opacity-100')
    expect(workMapView).toContain('threadsFor(')
    expect(workMapView).toContain('miscThreadsFor(')
    expect(workMapView).not.toContain('miscView(')
    expect(panel).not.toContain("? 'bg-hover/80'")
    expect(panel).toContain(
      'class="group/todo relative z-10 ml-8 flex min-h-8 cursor-pointer items-center rounded-[7px] pr-2 pl-2'
    )
    expect(panel).not.toContain(
      'class="relative z-10 flex min-h-8 w-full cursor-grab items-center rounded-[7px] pr-2 pl-10'
    )
    expect(panel).not.toContain('work-map-todo-checkbox-')
    expect(panel).toContain('workMapStatusIconNames')
    expect(panel).toContain('workMapStatusIconNames[status]')
    expect(panel).not.toContain('workMapStatusIconNames.finished')
    expect(panel).not.toContain("finished: 'tick-square'")
    expect(surfaceState).toContain("in_motion: 'activity'")
    expect(surfaceState).toContain("todo: 'time-circle'")
    expect(panel).not.toContain("finished: 'text-[var(--color-success)]'")
    expect(surfaceState).toContain("todo: 'text-[#f59e0b]'")
    expect(panel).not.toContain("needs_you: 'notification'")
    expect(panel).not.toContain("review: 'chat'")
    expect(panel).not.toContain('@/assets/work-map-status/generated-')
    expect(panel).not.toContain('generated-status-strip.png')
    expect(workMapView).toContain('todo.archivedAt')
    expect(workMapView).toContain('isAgentConversationArchived(thread)')
    expect(panel).not.toContain('data-test-id="agent-thread-archive-toggle"')
    expect(panel).toContain('@archived-change="handleConversationArchivedChange"')
    expect(panel).not.toContain('after:bg-chrome-border/70')
    expect(panel).not.toContain('after:top-[33px] after:-bottom-[1px]')
    expect(panel).not.toContain('after:top-[30px] after:-bottom-1')
    expect(panel).not.toContain('after:-bottom-[18px]')
    expect(panel).toContain('class="pb-1"')
    expect(panel).not.toContain('class="ml-3 pb-1"')
    expect(panel).toContain("? 'ml-3.5 grid overflow-hidden")
    expect(panel).not.toContain("entry.depth ? 'ml-5' : ''")
    expect(workMapView).toContain('if (!context.query) return entries')
    expect(surfaceState).toContain('isWorkMapProjectOpen(entry.project.parentId)')
    expect(panel).toContain(':inert="entry.depth > 0 && !isWorkMapEntryVisible(entry)"')
    expect(panel).toContain('transition-[grid-template-rows,opacity]')
    expect(panel).toContain('pointer-events-none grid-rows-[0fr] opacity-0')
    expect(panel).toContain('class="ml-2"')
    expect(panel).toMatch(/:data-test-id="`work-map-project-content-\$\{entry\.project\.id\}`"/)
    expect(panel).toMatch(/<div class="min-h-0 overflow-hidden">\s*<div class="pt-0\.5 pb-1">/)
    const projectContentStart = panel.indexOf(':data-test-id="`work-map-project-content-')
    const projectContentEnd = panel.indexOf('</section>', projectContentStart)
    expect(projectContentStart).toBeGreaterThanOrEqual(0)
    expect(projectContentEnd).toBeGreaterThan(projectContentStart)
    expect(panel.slice(projectContentStart, projectContentEnd)).not.toContain(
      'class="min-h-0 overflow-hidden pt-0.5 pb-1"'
    )
    expect(panel).toContain('transition-[grid-template-rows,opacity] duration-300 ease-in-out')
    expect(panel).toContain('grid-rows-[0fr] opacity-0')
    expect(panel).toContain('grid-rows-[1fr] opacity-100')
    expect(panel).not.toContain('translate-y-1')
    expect(panel).toContain('motion-reduce:transition-none')
    expect(panel).not.toContain('class="ml-2 pt-0.5 pb-1"')
    expect(panel).toContain('class="pt-0.5 pb-1"')
    expect(panel).not.toContain('class="ml-3 pt-0.5 pb-1 pl-1"')
    expect(panel).toContain('group/status flex h-8 cursor-pointer items-center gap-2')
    expect(panel).toContain(
      'before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree'
    )
    expect(projectTree).toContain(':bots="entry.bots"')
    expect(projectTree).not.toContain('v-for="bot in entry.bots"')
    expect(projectTree).toContain(
      'group/status flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2'
    )
    expect(projectTree).toContain('class="size-[16px]"')
    expect(panel).toContain('v-for="(todo, todoIndex) in workMapTodoGroup(entry, status)')
    expect(panel).toContain('todoIndex ===')
    expect(panel).toContain(
      'v-if="status === \'todo\' && workMapTodoGroup(entry, status).remaining"'
    )
    expect(panel).toContain("status === 'in_motion' &&")
    expect(panel).toContain('entry.inMotion.remaining')
    expect(panel).toContain('@click.stop="showMoreProjectInMotion(entry.project.id)"')
    expect(projectChats).not.toContain('Show more')
    expect(panel).toContain("? 'after:h-2.5'")
    expect(panel).toContain('v-if="status === \'todo\'"')
    expect(panel).toContain('addWorkMapTodo(entry.project)')
    expect(panel).toContain('work-map-misc-row')
    expect(surface).toContain('group/misc relative flex h-11')
    expect(surface).not.toContain('<span aria-hidden="true" class="h-10 w-7 shrink-0" />')
    expect(surface).toContain('flex min-w-0 items-center gap-1.5 text-left text-[15px]')
    expect(surface).not.toContain('ml-3 flex min-w-0 items-center gap-1.5 text-left text-[15px]')
    expect(projectTree).not.toContain('@click="toggleWorkMapProject(entry.project.id)"')
    expect(projectTree).toContain('@click.stop="toggleWorkMapProject(entry.project.id)"')
    expect(projectTree).not.toContain('aria-label="Add sub-bot"')
    expect(projectTree).not.toContain(':data-test-id="`work-map-add-subproject-')
    expect(projectTree).not.toContain(':data-test-id="`work-map-new-chat-')
    expect(surface).not.toContain('data-test-id="work-map-create"')
    expect(surface).not.toContain('aria-label="Create Bot or chat"')
    expect(surface).not.toContain('data-test-id="work-map-create-menu"')
    expect(surface).toContain('data-test-id="work-map-new-project"')
    expect(surface).toContain('data-test-id="agent-thread-new"')
    expect(surface).toContain('aria-label="Add Bot"')
    expect(surface).toContain('aria-label="Add chat"')
    expect(surface).toContain("beginCreateDrag($event, 'bot')")
    expect(surface).toContain("beginCreateDrag($event, 'chat')")
    expect(surface).toContain('Drag to the Board or under a Bot')
    expect(surface).toContain('Drag to the Board, Chats, or a Bot')
    expect(panel).not.toContain(':data-test-id="`work-map-add-bot-')
    expect(panel).toContain('icon-lucide-message-square-plus')
    expect(panel).not.toContain('border-l border-chrome-border/70')
    expect(panel).toContain('h-8 w-6 shrink-0 items-center justify-center')
    expect(panel).not.toContain('h-8 w-6 shrink-0 items-center justify-center bg-chrome')
    expect(panel).not.toContain('@/assets/work-map-project/workspace-tray-closed@3x.png')
    expect(panel).not.toContain('@/assets/work-map-project/workspace-tray-open@3x.png')
    expect(surface).not.toContain('work-map-misc-icon-closed')
    expect(surface).not.toContain('work-map-misc-icon-open')
    expect(projectTree).not.toContain('workMapProjectClosedIcon')
    expect(projectTree).not.toContain('workMapProjectOpenIcon')
    expect(panel).not.toContain('workMapDirectoryClosedIcon')
    expect(panel).not.toContain('workMapDirectoryOpenIcon')
    expect(panel).toMatch(/:data-test-id="`work-map-empty-\$\{entry\.project\.id\}-\$\{status\}`"/)
    expect(panel).toContain('No working chats')
    expect(panel).toContain('No todos')
    expect(panel).not.toContain('class="mr-1 size-2 shrink-0 rounded-full"')
    expect(panel).not.toContain('window.prompt')
    expect(surfaceState).toContain('const WORK_MAP_STATUS_INITIAL_COUNT = 5')
    expect(surfaceState).toContain('const WORK_MAP_STATUS_PAGE_SIZE = 5')
    expect(surfaceState).toContain('const WORK_MAP_IN_MOTION_INITIAL_COUNT = 5')
    expect(surfaceState).toContain('export const WORK_MAP_IN_MOTION_PAGE_SIZE = 5')
    expect(surfaceState).toContain('const WORK_MAP_MISC_INITIAL_COUNT = 15')
    expect(surfaceState).toContain('export const WORK_MAP_MISC_PAGE_SIZE = 10')
    expect(panel).toContain('WORK_MAP_MISC_PAGE_SIZE')
    expect(panel).toContain('workMapTodoGroup(entry, status).remaining')
    expect(panel).toContain('entry.inMotion.remaining')
    expect(panel).toContain('data-test-id="work-map-show-more-misc"')
    expect(panel).toContain('Show more')
  })

  test('keeps Show more hover text-only', async () => {
    const panel = await Bun.file('src/components/agent-chat/AgentWorkMapSurface.vue').text()

    expect(panel).toMatch(/text-muted\/70 transition-colors[^"]*hover:!text-surface/)
    expect(panel).not.toContain('text-muted/70 hover:bg-hover hover:text-surface')
  })

  test('places one Show more boundary after every visible In motion row', async () => {
    const [projectChats, projectTree, surfaceState] = await Promise.all([
      Bun.file('src/components/agent-chat/WorkMapProjectChats.vue').text(),
      Bun.file('src/components/agent-chat/WorkMapProjectTree.vue').text(),
      Bun.file('src/app/agent-chat/work-map-surface-state.ts').text()
    ])
    const chatRows = projectTree.indexOf('<WorkMapProjectChats')
    const todoRows = projectTree.indexOf(
      'v-for="(todo, todoIndex) in workMapTodoGroup(entry, status).items"'
    )
    const showMore = projectTree.indexOf('work-map-show-more-in-motion-')

    expect(chatRows).toBeGreaterThanOrEqual(0)
    expect(todoRows).toBeGreaterThan(chatRows)
    expect(showMore).toBeGreaterThan(todoRows)
    expect(projectChats).not.toContain('Show more')
    expect(projectTree).toContain('entry.inMotion.remaining')
    expect(projectTree).toContain('@click.stop="showMoreProjectInMotion(entry.project.id)"')
    expect(projectTree).not.toContain('Show less')
    expect(projectTree).not.toContain('showLessProjectInMotion')
    expect(surfaceState).toContain('const WORK_MAP_IN_MOTION_INITIAL_COUNT = 5')
    expect(surfaceState).toContain('export const WORK_MAP_IN_MOTION_PAGE_SIZE = 5')
  })

  test('opens each project section independently and surfaces active work on its header', async () => {
    const [controller, projectChats, projectTree, scheduledSection, surfaceState] =
      await Promise.all([
        Bun.file('src/app/agent-chat/work-map-surface-controller.ts').text(),
        Bun.file('src/components/agent-chat/WorkMapProjectChats.vue').text(),
        Bun.file('src/components/agent-chat/WorkMapProjectTree.vue').text(),
        Bun.file('src/components/agent-chat/WorkMapScheduledSection.vue').text(),
        Bun.file('src/app/agent-chat/work-map-surface-state.ts').text()
      ])

    expect(surfaceState).toContain('function isWorkMapStatusOpen(')
    expect(surfaceState).toContain('function toggleWorkMapStatus(')
    expect(surfaceState).toContain('if (search.value.trim()) return true')
    expect(projectTree).toContain('work-map-status-toggle-')
    expect(projectTree).toContain(':aria-expanded="isWorkMapStatusOpen(entry.project.id, status)"')
    expect(projectTree).toContain('@click="toggleWorkMapStatus(entry.project.id, status)"')
    expect(projectTree).toContain('v-show="isWorkMapStatusOpen(entry.project.id, status)"')
    const statusHeader = projectTree.slice(
      projectTree.indexOf('work-map-status-toggle-'),
      projectTree.indexOf('work-map-status-content-')
    )
    expect(statusHeader).not.toContain('icon-lucide-chevron-right')
    expect(surfaceState).toContain('function isWorkMapScheduledOpen(')
    expect(surfaceState).toContain('function toggleWorkMapScheduled(')
    expect(scheduledSection).toContain('work-map-scheduled-toggle-')
    expect(scheduledSection).toContain(':aria-expanded="isWorkMapScheduledOpen(directoryId)"')
    expect(scheduledSection).toContain('@click="toggleWorkMapScheduled(directoryId)"')
    expect(scheduledSection).toContain('v-if="isWorkMapScheduledOpen(directoryId)"')
    expect(scheduledSection).not.toContain('icon-lucide-chevron-right')
    expect(scheduledSection).toContain('const launchingRoutineId = ref<string | null>(null)')
    expect(scheduledSection).toContain('function routineIsRunning(')
    expect(scheduledSection).toContain('@click="openRoutineChat(routine)"')
    expect(scheduledSection).toContain('Open scheduled chat:')
    expect(scheduledSection).toContain('<icon-lucide-loader-circle')
    expect(scheduledSection).toContain('animate-spin')
    expect(controller).toContain('function workMapInMotionActivityStatus(')
    expect(controller).toContain('if (status?.pulse) return status')
    expect(projectTree).toContain('workMapInMotionActivityStatus(entry)')
    expect(projectChats).toContain('<AgentThreadStatusIndicator')
  })

  test('dismisses Work map search without stealing outside focus', async () => {
    const surfaceState = await Bun.file('src/app/agent-chat/work-map-surface-state.ts').text()

    expect(surfaceState).toContain('onClickOutside(')
    expect(surfaceState).toContain('workMapSearchField')
    expect(surfaceState).toContain('closeWorkMapSearch(false)')
    expect(surfaceState).toContain('{ ignore: [workMapSearchToggle] }')
  })

  test('presents categorized Todo rows as clickable before they are grabbed', async () => {
    const panel = await Bun.file('src/components/agent-chat/WorkMapProjectTree.vue').text()
    const todoStart = panel.indexOf(':data-test-id="`work-map-todo-')
    const todoEnd = panel.indexOf('</button>', todoStart)
    expect(todoStart).toBeGreaterThanOrEqual(0)
    expect(todoEnd).toBeGreaterThan(todoStart)
    const todoControl = panel.slice(todoStart, todoEnd)

    expect(todoControl).not.toContain('pressedWorkMapThreadId === thread.id ||')
    expect(todoControl).not.toContain('draggedWorkMapThreadId === thread.nativeThreadId')
    expect(todoControl).toContain('pressedWorkMapTodoId === todo.id ||')
    expect(todoControl).toContain('draggedWorkMapTodoId === todo.id')
    expect(todoControl).toContain('@pointerdown="armWorkMapTodoPointerDrag(todo)"')
    expect(todoControl).toContain("? '!cursor-grabbing'")
  })

  test('makes the header creation controls draggable while preserving the selected-chat pointer', async () => {
    const [panelShell, surface] = await Promise.all([
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/components/agent-chat/AgentWorkMapSurface.vue').text()
    ])
    const panel = `${panelShell}\n${surface}`

    const createId = panel.indexOf('data-test-id="agent-thread-new"')
    const createStart = panel.lastIndexOf('<button', createId)
    const createEnd = panel.indexOf('</button>', createStart)
    expect(createStart).toBeGreaterThanOrEqual(0)
    expect(createEnd).toBeGreaterThan(createStart)
    const createControl = panel.slice(createStart, createEnd)
    expect(createControl).toContain('draggable="true"')
    expect(createControl).toContain('cursor-grab')
    expect(createControl).toContain('active:cursor-grabbing')

    const selectedStart = panel.indexOf('data-test-id="agent-selected-new"')
    const selectedEnd = panel.indexOf('</button>', selectedStart)
    expect(selectedStart).toBeGreaterThanOrEqual(0)
    expect(selectedEnd).toBeGreaterThan(selectedStart)
    const selectedControl = panel.slice(selectedStart, selectedEnd)
    expect(selectedControl).toContain('cursor-pointer')
    expect(selectedControl).toContain('active:cursor-grabbing')
  })

  test('keeps chat state labels accessible while rendering only actionable dots and spinners', async () => {
    const [
      archiveDialog,
      botRow,
      indicator,
      panelShell,
      projectChats,
      projectTree,
      styles,
      surface
    ] = await Promise.all([
      Bun.file('src/components/agent-chat/AgentConversationArchiveDialog.vue').text(),
      Bun.file('src/components/agent-chat/WorkMapBotRow.vue').text(),
      Bun.file('src/components/ai-elements/T3ThreadStatusIndicator.tsx').text(),
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/components/agent-chat/WorkMapProjectChats.vue').text(),
      Bun.file('src/components/agent-chat/WorkMapProjectTree.vue').text(),
      Bun.file('src/app.css').text(),
      Bun.file('src/components/agent-chat/AgentWorkMapSurface.vue').text()
    ])
    const panel = `${panelShell}\n${surface}\n${projectTree}\n${botRow}\n${projectChats}`

    expect(indicator).toContain(
      "status.pulse ? 't3-thread-status-spinner' : 't3-thread-status-dot'"
    )
    expect(indicator).not.toContain('<span>{status.label}</span>')
    expect(indicator).toContain('aria-label={status.label}')
    expect(styles).toContain('animation: t3-thread-status-spin 0.8s linear infinite')
    expect(panel).toContain('v-if="selectedThread && threadStatus(selectedThread)"')
    expect(panel).toContain('v-if="botThread(bot) && threadStatus(botThread(bot)!)"')
    expect(panel).toContain('workMapMiscActivityStatus()')
    expect(panel).toContain('workMapTodoThreadStatus(todo)')
    expect(panel).toMatch(/:data-test-id="`work-map-archive-todo-\$\{todo\.id\}`"/)
    expect(panel).toMatch(/:data-test-id="`work-map-archive-chat-\$\{thread\.id\}`"/)
    expect(panel).toContain('@click.stop="requestArchiveWorkMapTodo(todo)"')
    expect(panel.match(/@click\.stop="requestArchiveConversation\(thread\)"/g)).toHaveLength(2)
    expect(surface).toContain('<AgentConversationArchiveDialog')
    expect(surface).toContain('@confirm="confirmArchiveConversation"')
    expect(archiveDialog).toContain('data-test-id="agent-conversation-archive-dialog"')
    expect(archiveDialog).toContain('data-test-id="agent-conversation-archive-confirm"')
    expect(archiveDialog).toContain('Are you sure?')
    expect(archiveDialog).toContain('can be restored later')
  })

  test('keeps the Work map controls flat and chat runtime state trailing', async () => {
    const [editor, layers, panel, toolbar] = await Promise.all([
      Bun.file('src/views/EditorView.vue').text(),
      Bun.file('src/components/LayersPanel.vue').text(),
      Bun.file('src/components/agent-chat/AgentWorkMapSurface.vue').text(),
      Bun.file('src/components/Toolbar/DesktopToolbar.vue').text()
    ])

    expect(panel).toContain('aria-label="Search work map"')
    expect(panel).toContain('type="text"')
    expect(panel).toContain('placeholder="Search work…"')
    expect(panel).toContain('data-test-id="work-map-search-toggle"')
    expect(panel).toContain('data-test-id="work-map-search-field"')
    expect(panel).toContain(
      'transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none'
    )
    expect(panel).not.toContain('transition-[width,opacity,transform]')
    expect(panel.indexOf('data-test-id="work-map-search-toggle"')).toBeLessThan(
      panel.indexOf('data-test-id="agent-thread-new"')
    )
    expect(panel.indexOf('data-test-id="agent-thread-new"')).toBeLessThan(
      panel.indexOf('data-test-id="work-map-new-project"')
    )
    expect(panel).not.toContain('type="search"')
    expect(panel).not.toContain('aria-label="Clear work map search"')
    expect(panel).toContain('AgentThreadStatusIndicator')
    expect(panel).not.toContain('aria-label="Search tasks"')
    expect(panel).not.toContain('placeholder="Search tasks…"')
    expect(layers).toContain('data-test-id="left-panel-utility-area"')
    expect(layers).toContain(
      'class="relative flex min-h-0 grow basis-0 flex-col overflow-clip pb-1"'
    )
    expect(layers).not.toContain('<TabsRoot')
    expect(layers).not.toContain('<TabsList')
    expect(layers).not.toContain('grid-rows-[')
    expect(layers).not.toContain('mr-11')
    expect(editor).toContain('data-sidebar-edge-hinge="true"')
    expect(editor).toContain('data-sidebar-collapse-rail="true"')
    expect(editor).toContain(':style="leftSidebarCloseRailStyle"')
    expect(editor).toContain('absolute inset-y-0')
    expect(editor).toContain('w-5 cursor-pointer bg-transparent')
    expect(editor).toContain('const leftSidebarCloseRailStyle')
    expect(editor).not.toContain('leftSidebarEdgePercent.value}% + 20px')
    expect(editor).toContain('group-hover/sidebar-rail:opacity-100')
    expect(editor).not.toContain('group/sidebar-hinge')
    expect(editor).not.toContain("style.top = '70px'")
    expect(editor).toContain('<icon-lucide-chevron-left class="size-3.5 stroke-[1.8]" />')
    expect(toolbar).toContain(`:aria-hidden="sidebarTabOnly && sidebarOpen ? 'true' : undefined"`)
    expect(toolbar).toContain(':inert="sidebarTabOnly && sidebarOpen ? true : undefined"')
    expect(toolbar).toContain("'pointer-events-none opacity-0 duration-200 ease-in-out'")
    expect(toolbar).toContain('v-if="embedded && !sidebarTabOnly"')
    expect(layers).not.toContain('bg-chrome-control ring-chrome-control-border')
    expect(layers).not.toContain('border border-transparent')
    expect(layers).not.toContain('data-[state=active]:border-chrome-border')
    expect(layers).toContain(`v-show="openUtility === 'chats'"`)
    expect(layers).toContain(`v-show="openUtility === 'cache'"`)
    expect(layers).not.toContain('shadow-sm')
  })
})
