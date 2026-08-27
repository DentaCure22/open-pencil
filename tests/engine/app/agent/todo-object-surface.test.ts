import { describe, expect, test } from 'bun:test'

import { syncTodoCodeObjectTitle } from '@/app/agent-chat/todo-code-object'
import { appendAgentTodoBrief } from '@/app/agent-chat/work-map'

describe('Todo object surface', () => {
  test('uses one canonical title while preserving the editable HTML body', () => {
    const html = syncTodoCodeObjectTitle(
      '<!doctype html><html><head><title>Old</title></head><body><main><h1>Old</h1><p>Keep me.</p></main></body></html>',
      'Canonical Todo'
    )

    expect(html).toContain('<title>Canonical Todo</title>')
    expect(html).toContain('<h1 data-todo-title>Canonical Todo</h1>')
    expect(html).toContain('<p>Keep me.</p>')
    expect(html).toContain('data-openpencil-code-object="todo-document"')
  })

  test('appends dropped notes and references into the living document', () => {
    const next = appendAgentTodoBrief(
      {
        documentHtml:
          '<!doctype html><html><body><main><h1>Shape the flow</h1></main></body></html>',
        goal: 'Shape the flow'
      },
      {
        attachments: [{ name: 'flow.png', path: '/tmp/flow.png', type: 'image/png' }],
        text: 'Compare the compact direction.'
      }
    )

    expect(next.context).toBe('Compare the compact direction.')
    expect(next.references).toEqual([{ id: '/tmp/flow.png', kind: 'image', label: 'flow.png' }])
    expect(next.documentHtml).toContain('<section data-kind="added-note">')
    expect(next.documentHtml).toContain('Compare the compact direction.')
    expect(next.documentHtml).toContain('data-todo-reference="/tmp/flow.png"')
  })

  test('keeps the chat receipt compact and renders the Todo as an editable HTML document', async () => {
    const [editor, panel, workMap, surface] = await Promise.all([
      Bun.file('src/app/agent-chat/todo-document-editor.ts').text(),
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/components/agent-chat/WorkMapProjectTree.vue').text(),
      Bun.file('src/components/agent-chat/TodoObjectSurface.vue').text()
    ])

    expect(panel).toContain('data-test-id="agent-todo-link"')
    expect(panel).toContain('@click="openSelectedTodoObject"')
    expect(panel).not.toContain('Todo ready')
    expect(panel).not.toContain('Outcome ·')
    expect(surface).toContain('data-test-id="workspace-object-surface"')
    expect(surface).toContain('data-test-id="todo-object-related-chat"')
    expect(surface).toContain('data-test-id="todo-object-document"')
    expect(surface).toContain('data-test-id="todo-object-add-reference"')
    expect(surface).toContain('data-test-id="todo-object-reference-input"')
    expect(editor).toContain("document.body.contentEditable = 'true'")
    expect(editor).toContain('container-type: inline-size')
    expect(editor).toContain('max-width: 100%')
    expect(surface).toContain('sandbox="allow-same-origin"')
    expect(surface).toContain(':srcdoc="documentSrcdoc"')
    expect(surface).toContain('scheduleDocumentSave')
    expect(surface).toContain('@drop="dropContent"')
    expect(surface).toContain('aria-label="Open related chat"')
    expect(surface).toContain('aria-label="Add reference"')
    expect(surface).not.toContain('data-test-id="todo-object-edit"')
    expect(surface).not.toContain('data-test-id="todo-object-save"')
    expect(surface).not.toContain('<AiPromptInput')
    expect(surface).not.toContain('placeholder="Add text, files, images, or @references…"')
    expect(surface).not.toContain('data-test-id="todo-object-pin"')
    expect(surface).not.toContain('data-test-id="todo-object-board-action"')
    expect(surface).not.toContain('data-test-id="todo-object-primary-action"')
    expect(surface).not.toContain('Continue in chat')
    expect(workMap).toContain('work-map-reveal-project-')
    expect(workMap).toContain('revealWorkMapProject(entry.project)')
    expect(workMap).not.toContain('work-map-reveal-todo-')
    expect(surface).toContain('brief.documentHtml || legacyDocument(brief, canonicalTitle.value)')
    expect(surface).toContain('title: documentTitle()')
  })

  test('opens the chat from the row and the object from its separate row action', async () => {
    const [historyLifecycle, navigation, objectNavigation, panel, workMap, state] =
      await Promise.all([
        Bun.file('src/app/agent-chat/panel-history-lifecycle.ts').text(),
        Bun.file('src/app/agent-chat/work-map-navigation.ts').text(),
        Bun.file('src/app/agent-chat/panel-object-navigation.ts').text(),
        Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
        Bun.file('src/components/agent-chat/WorkMapProjectTree.vue').text(),
        Bun.file('src/app/agent-chat/right-panel.ts').text()
      ])

    expect(state).toContain("| 'object'")
    expect(state).toContain('objectThreadId?: string')
    expect(state).not.toContain('objectPinned')
    expect(state).not.toContain('setAgentRightPanelObjectPinned')
    expect(objectNavigation).toContain("openAgentRightPanel('object'")
    expect(objectNavigation).toContain('objectThreadId: thread.nativeThreadId')
    expect(workMap).toContain('@drop="dropContentOnTodo($event, todo)"')
    expect(panel).toContain(':todo-thread-id="rightPanelTodoThread?.nativeThreadId ?? \'\'"')
    const openChat = navigation.slice(
      navigation.indexOf('async function openWorkMapTodo'),
      navigation.indexOf('async function openWorkMapTodoObject')
    )
    const openObject = navigation.slice(
      navigation.indexOf('async function openWorkMapTodoObject'),
      navigation.indexOf('async function refreshWorkMap')
    )
    expect(openChat).toContain('await options.selectThread(thread)')
    expect(openObject).not.toContain('selectThread')
    expect(openObject).toContain('options.openTodoObject(todo, thread)')
    expect(workMap).toContain('work-map-open-todo-object-')
    expect(workMap).toContain('<IconlyIcon name="document" class="size-3.5 stroke-[1.6]" />')
    expect(workMap).toContain('@click.stop="openWorkMapTodoObject(todo)"')
    expect(workMap).toContain('group-hover/todo:opacity-100')
    expect(workMap).toContain(`:aria-label="\`Open Todo chat: \${workMapTodoTitle(todo)}\`"`)
    expect(panel).not.toContain("sendRightPanelTodoPrompt('Start work on this Todo.')")
    expect(panel).not.toContain('Create and place the Plan Code Object for this Todo on the Board')
    expect(historyLifecycle).toContain("knownThreadStates.get(thread.id) === 'running'")
    expect(historyLifecycle).toContain('if (todoWorkSettled) void options.loadWorkMap()')
    expect(panel).not.toContain('openSelectedTodoObject() {\n  void submitFollowUp')
  })
})
