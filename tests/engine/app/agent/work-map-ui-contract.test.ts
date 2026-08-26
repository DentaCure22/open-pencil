import { describe, expect, test } from 'bun:test'

describe('agent Work map UI contract', () => {
  test('keeps chats and project todos in one resilient hierarchy', async () => {
    const [client, panel] = await Promise.all([
      Bun.file('src/app/agent-chat/work-map.ts').text(),
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text()
    ])

    expect(client).toContain("'/agent-router/v1/pi/work-map'")
    expect(client).toContain("'/agent-router/v1/pi/work-map/apply'")
    expect(client).toContain("'/agent-router/v1/pi/work-map/todo-chats'")
    expect(client).toContain("op: 'place_chat'")
    expect(client).toContain("op: 'create_todo'")
    expect(client).toContain("op: 'update_todo'")

    expect(panel).toContain('Work map')
    expect(panel).toContain('Pinned')
    expect(panel).not.toContain('Global')
    expect(panel).toContain('Misc chats')
    expect(panel).not.toMatch(
      /<span v-else class="mr-1[^"]*tabular-nums[^"]*">\s*\{\{ miscThreads\.length \}\}/
    )
    expect(panel).not.toContain('Live chats')
    expect(panel).not.toContain('Project tasks')
    expect(panel).not.toMatch(/>\s+Tasks\s+<\/span>/)
    expect(panel).toContain('v-for="thread in entry.misc ? visibleMiscThreads : []"')
    expect(panel).not.toContain(
      'v-for="thread in entry.misc ? miscThreads : projectThreads(entry.project.id)"'
    )
    expect(panel).toContain("const workMapTodoStatuses = ['todo', 'in_motion']")
    expect(panel).toContain('Finished tasks are complete.')
    expect(panel).toContain('group/finished flex h-8')
    expect(panel).not.toMatch(
      /<span class="tabular-nums">\{\{\s*projectTodos\(entry\.project\.id, 'finished'\)\.length/
    )
    expect(panel).toContain(
      'group-hover/finished:opacity-100 group-focus-within/finished:opacity-100'
    )
    expect(panel).toContain(
      'opacity-0 transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100'
    )
    expect(panel).toContain('@click.stop="startNewConversation(entry.project.id)"')
    expect(panel).toContain("{ op: 'place_chat', project_id: projectId, thread_id: threadId }")
    expect(panel).toContain("dropWorkMapTodo($event, entry.project.id, 'finished')")
    expect(panel).not.toContain('v-if="projectTodos(entry.project.id, status).length"')
    expect(panel).not.toContain('v-if="projectTodos(entry.project.id, \'finished\').length"')
    expect(panel).toContain("view.value = 'list'\n  await loadWorkMap()")
    expect(panel).toContain('AppScrollAreaScrollbar')
    expect(panel).toContain('data-test-id="work-map-create-dialog"')
    expect(panel).toContain('data-test-id="agent-todo-brief"')
    expect(panel).toContain('@click="openWorkMapTodo(todo)"')
    expect(panel).toContain('data-test-id="agent-selected-plan"')
    expect(panel).not.toContain("? 'bg-hover/80'")
    expect(panel).toContain(
      'class="relative z-10 ml-8 flex min-h-8 cursor-grab items-center rounded-[7px] pr-2 pl-2'
    )
    expect(panel).not.toContain(
      'class="relative z-10 flex min-h-8 w-full cursor-grab items-center rounded-[7px] pr-2 pl-10'
    )
    expect(panel).not.toContain('type="checkbox"')
    expect(panel).not.toContain('work-map-todo-checkbox-')
    expect(panel).toContain('workMapStatusIconNames')
    expect(panel).toContain('workMapStatusIconNames[status]')
    expect(panel).toContain('workMapStatusIconNames.finished')
    expect(panel).toContain("finished: 'tick-square'")
    expect(panel).toContain("in_motion: 'activity'")
    expect(panel).toContain("todo: 'time-circle'")
    expect(panel).toContain("finished: 'text-[var(--color-success)]'")
    expect(panel).toContain("todo: 'text-[#f59e0b]'")
    expect(panel).not.toContain("needs_you: 'notification'")
    expect(panel).not.toContain("review: 'chat'")
    expect(panel).not.toContain('@/assets/work-map-status/generated-')
    expect(panel).not.toContain('generated-status-strip.png')
    expect(panel).toContain('after:bg-chrome-border/70')
    expect(panel).toContain('after:top-[33px] after:-bottom-[1px]')
    expect(panel).not.toContain('after:top-[30px] after:-bottom-1')
    expect(panel).not.toContain('after:-bottom-[18px]')
    expect(panel).toContain('class="pb-1"')
    expect(panel).not.toContain('class="ml-3 pb-1"')
    expect(panel).toContain("entry.depth ? 'ml-3.5' : ''")
    expect(panel).not.toContain("entry.depth ? 'ml-5' : ''")
    expect(panel).toContain('isWorkMapProjectOpen(entry.project.parentId)')
    expect(panel).toContain('class="ml-2"')
    expect(panel).toMatch(/:data-test-id="`work-map-project-content-\$\{entry\.project\.id\}`"/)
    expect(panel).toContain('class="min-h-0 overflow-hidden pt-0.5 pb-1"')
    expect(panel).toContain('transition-[grid-template-rows,opacity,transform] duration-250')
    expect(panel).toContain('grid-rows-[0fr] opacity-0')
    expect(panel).toContain('grid-rows-[1fr] translate-y-0 opacity-100')
    expect(panel).toContain('motion-reduce:transition-none')
    expect(panel).not.toContain('class="ml-2 pt-0.5 pb-1"')
    expect(panel).not.toContain('class="pt-0.5 pb-1"')
    expect(panel).not.toContain('class="ml-3 pt-0.5 pb-1 pl-1"')
    expect(panel).toContain('group/status flex h-8 items-center gap-2')
    expect(panel).toContain('v-if="status === \'todo\'"')
    expect(panel).toContain('@click.stop="addWorkMapTodo(entry.project)"')
    expect(panel).toContain(
      ":data-test-id=\"\n                      entry.misc ? 'work-map-misc-row'"
    )
    expect(panel).toContain('@click="toggleWorkMapProject(entry.project.id)"')
    expect(panel).toContain('@click.stop="toggleWorkMapProject(entry.project.id)"')
    expect(panel).toContain('<icon-lucide-folder-plus class="size-3.5 stroke-[1.7]" />')
    expect(panel).toContain('<IconlyIcon name="plus" class="size-3.5 stroke-[1.7]" />')
    expect(panel.indexOf(':data-test-id="`work-map-new-chat-')).toBeLessThan(
      panel.indexOf(':data-test-id="`work-map-add-subproject-')
    )
    expect(panel).not.toContain('icon-lucide-message-square-plus')
    expect(panel).not.toContain('border-l border-chrome-border/70')
    expect(panel).toContain('h-8 w-6 shrink-0 items-center justify-center')
    expect(panel).not.toContain('h-8 w-6 shrink-0 items-center justify-center bg-chrome')
    expect(panel).toContain('@/assets/work-map-project/workspace-tray-closed@3x.png')
    expect(panel).toContain('@/assets/work-map-project/workspace-tray-open@3x.png')
    expect(panel).toContain('? workMapProjectOpenIcon')
    expect(panel).toContain(': workMapProjectClosedIcon')
    expect(panel).toContain('class="size-5 shrink-0 object-contain"')
    expect(panel).toMatch(/:data-test-id="`work-map-empty-\$\{entry\.project\.id\}-\$\{status\}`"/)
    expect(panel).toContain('No tasks')
    expect(panel).not.toContain('class="mr-1 size-2 shrink-0 rounded-full"')
    expect(panel).not.toContain('window.prompt')
    expect(panel).toContain('const WORK_MAP_STATUS_INITIAL_COUNT = 5')
    expect(panel).toContain('const WORK_MAP_STATUS_PAGE_SIZE = 5')
    expect(panel).toContain('const WORK_MAP_MISC_INITIAL_COUNT = 15')
    expect(panel).toContain('const WORK_MAP_MISC_PAGE_SIZE = 10')
    expect(panel).toContain('visibleProjectTodos(entry.project.id, status)')
    expect(panel).toContain('data-test-id="work-map-show-more-misc"')
    expect(panel).toContain('Show more')
  })

  test('keeps Show more hover text-only', async () => {
    const panel = await Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text()

    expect(panel).toContain('text-muted/70 transition-colors hover:!text-surface')
    expect(panel).not.toContain('text-muted/70 hover:bg-hover hover:text-surface')
  })

  test('dismisses Work map search without stealing outside focus', async () => {
    const panel = await Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text()

    expect(panel).toContain('onClickOutside(')
    expect(panel).toContain('workMapSearchField')
    expect(panel).toContain('closeWorkMapSearch(false)')
    expect(panel).toContain('{ ignore: [workMapSearchToggle] }')
  })

  test('presents chats as clickable before they are grabbed', async () => {
    const panel = await Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text()

    expect(panel).toContain(
      'cursor-pointer items-center gap-2 overflow-hidden rounded-[7px] px-2 text-left hover:bg-hover'
    )
    expect(panel).toContain('pressedWorkMapThreadId === thread.id ||')
    expect(panel).toContain('draggedWorkMapThreadId === thread.nativeThreadId')
    expect(panel).toContain("? '!cursor-grabbing'")
  })

  test('keeps the Work map controls flat and chat runtime state trailing', async () => {
    const [editor, layers, panel, toolbar] = await Promise.all([
      Bun.file('src/views/EditorView.vue').text(),
      Bun.file('src/components/LayersPanel.vue').text(),
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/components/Toolbar/DesktopToolbar.vue').text()
    ])

    expect(panel).toContain('aria-label="Search work map"')
    expect(panel).toContain('type="text"')
    expect(panel).toContain('placeholder="Search work…"')
    expect(panel).toContain('data-test-id="work-map-search-toggle"')
    expect(panel).toContain('data-test-id="work-map-search-field"')
    expect(panel).toContain('transition-[width,opacity,transform] duration-200 ease-out')
    expect(panel.indexOf('data-test-id="work-map-search-toggle"')).toBeLessThan(
      panel.indexOf('data-test-id="agent-thread-new"')
    )
    expect(panel.indexOf('data-test-id="agent-thread-new"')).toBeLessThan(
      panel.indexOf('data-test-id="work-map-new-project"')
    )
    expect(panel).not.toContain('type="search"')
    expect(panel).not.toContain('aria-label="Clear work map search"')
    expect(panel).toContain('threadStateLabel(thread)')
    expect(panel).toContain('AgentThreadStatusIndicator')
    expect(panel).not.toContain('aria-label="Search tasks"')
    expect(panel).not.toContain('placeholder="Search tasks…"')
    expect(layers).toContain(
      'class="z-10 col-span-4 row-start-1 mx-1 mt-3 mb-1 grid grid-cols-4 gap-1 rounded-[12px] p-1"'
    )
    expect(layers).toContain('grid-rows-[3.5rem_auto_minmax(0,1fr)]')
    expect(layers).not.toContain('grid-rows-[3.25rem_auto_minmax(0,1fr)]')
    expect(layers).not.toContain('mr-11')
    expect(editor).toContain('data-sidebar-edge-hinge="true"')
    expect(editor).toContain(':style="leftSidebarResizeHandleStyle"')
    expect(editor).toContain('top-1/2')
    expect(editor).toContain('-translate-x-full')
    expect(editor).toContain('h-11 w-8 -translate-x-full')
    expect(editor).toContain('opacity-0 transition-[color,opacity]')
    expect(editor).toContain('hover:opacity-100')
    expect(editor).toContain('focus-visible:opacity-100')
    expect(editor).not.toContain('hover:bg-chrome-raised/95')
    expect(editor).not.toContain('top-1/2 z-50 flex h-8 w-5 -translate-x-1/2')
    expect(editor).toContain('-translate-y-1/2')
    expect(editor).not.toContain("style.top = '70px'")
    expect(editor).toContain('<icon-lucide-chevron-left class="size-3.5 stroke-[1.8]" />')
    expect(toolbar).toContain("sidebarTabOnly && sidebarOpen ? 'pointer-events-none'")
    expect(toolbar).toContain('v-if="embedded && (!sidebarTabOnly || !sidebarOpen)"')
    expect(layers).not.toContain('bg-chrome-control ring-chrome-control-border')
    expect(layers).not.toContain('border border-transparent')
    expect(layers).not.toContain('data-[state=active]:border-chrome-border')
    expect(layers).toContain("? 'bg-hover/70 text-surface'")
    expect(layers).toContain('shadow-none')
    expect(layers).not.toContain('shadow-sm')
  })
})
