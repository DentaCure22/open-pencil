import { describe, expect, test } from 'bun:test'

describe('project workspace surfaces', () => {
  test('uses one translucent dark surface across both sidebar shells and headers', async () => {
    const [styles, editor, workspace, diffSurface] = await Promise.all([
      Bun.file('src/app.css').text(),
      Bun.file('src/views/EditorView.vue').text(),
      Bun.file('src/components/ai-elements/T3RightPanelWorkspace.tsx').text(),
      Bun.file('src/components/ai-elements/T3DiffSurface.tsx').text()
    ])
    const darkTheme = styles.slice(
      styles.indexOf('@theme'),
      styles.indexOf("html[data-theme='light']")
    )

    expect(darkTheme).toContain('--color-sidebar: rgb(8 8 9 / 0.94);')
    expect(darkTheme).toContain('--color-sidebar-header: rgb(9 9 10);')
    expect(darkTheme).toContain('--color-agent-surface: #242424;')
    expect(editor).toContain('bg-sidebar')
    expect(workspace).toContain('bg-sidebar')
    expect(diffSurface).toContain('bg-agent-surface')
    expect(workspace).toContain('[--color-agent-surface:transparent]')
    expect(workspace).toContain(
      'border-chrome-border bg-chrome-raised shadow-chrome-menu pointer-events-auto fixed z-[90]'
    )
    expect(workspace).toContain('createPortal(')
    expect(workspace).toContain('document.body')
    expect(workspace).toContain('window.innerWidth - ADD_SURFACE_MENU_VIEWPORT_INSET * 2')
    expect(workspace).toContain('!addMenu.current?.contains(target)')
  })

  test('keeps Work Map on the left and mounts project tools in the T3 workspace', async () => {
    const leftPanel = await Bun.file('src/components/LayersPanel.vue').text()
    const [chatPanel, workMap] = await Promise.all([
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/components/agent-chat/WorkMapProjectTree.vue').text()
    ])
    const workMapNavigation = await Bun.file('src/app/agent-chat/work-map-navigation.ts').text()
    const workspace = await Bun.file('src/components/ai-elements/T3RightPanelWorkspace.tsx').text()
    const bridge = await Bun.file('src/components/ai-elements/AiRightPanelWorkspace.vue').text()

    expect(leftPanel).toContain('<AgentChatsPanel />')
    expect(leftPanel).not.toContain('Sidebar utilities')
    expect(leftPanel).not.toContain('left-panel-layers-tab')
    expect(leftPanel).not.toContain('left-panel-assets-tab')
    expect(leftPanel).not.toContain('left-panel-trace-tab')

    expect(workMap).toContain('work-map-bot-directory-icon-')
    expect(workMap).toContain('work-map-reveal-project-')
    expect(workMap).not.toContain('work-map-project-layers-')
    expect(workMapNavigation).toContain("openAgentRightPanel('layers'")
    expect(chatPanel).toContain(':requested-surface="agentRightPanelState.surface"')
    expect(chatPanel).toContain(':open="agentRightPanelState.open"')
    expect(chatPanel).not.toContain("agentRightPanelState.surface !== 'diff'")
    expect(chatPanel).toContain(':show-reopen="!agentRightPanelState.open"')
    expect(chatPanel).toContain('@open="reopenRightPanel"')

    expect(workspace).toContain("kind: 'layers'")
    expect(workspace).toContain("kind: 'assets'")
    expect(workspace).toContain("kind: 'object'")
    expect(workspace).toContain("kind: 'activity'")
    expect(workspace).toContain('t3-right-panel-object-host')
    expect(workspace).toContain('t3-right-panel-layers-host')
    expect(workspace).toContain('t3-right-panel-assets-host')
    expect(workspace).toContain('t3-right-panel-activity-host')
    expect(workspace).toContain('data-test-id="open-right-panel"')
    expect(workspace).toContain('!narrow && (props.showReopen || props.open)')
    expect(workspace).toContain('data-test-id="right-sidebar-toggle-motion"')
    expect(workspace).toContain('aria-label="Open right sidebar"')
    expect(workspace).toContain('top-1/2 right-3')
    expect(workspace).toContain('h-11 w-7')
    expect(workspace).toContain('rounded-[11px] backdrop-blur-xl')
    expect(workspace).toContain('transition-opacity motion-reduce:transition-none')
    expect(workspace).toContain("props.open ? 'pointer-events-none opacity-0")
    expect(workspace).toContain('rounded-[10px] border')
    expect(workspace).toContain('<PanelRightOpen')
    expect(workspace).toContain(
      'transition-[translate,opacity,width,left] duration-300 ease-in-out'
    )
    expect(workspace).not.toContain('transition-[transform,opacity,width,left]')
    expect(workspace).toContain('data-test-id="close-right-panel-hinge"')
    expect(workspace).toContain('data-right-sidebar-hinge="true"')
    expect(workspace).toContain('data-sidebar-collapse-rail="true"')
    expect(workspace).toContain('aria-label="Close right panel"')
    expect(workspace).toContain('right: width + 12')
    expect(workspace).toContain('fixed inset-y-0')
    expect(workspace).toContain('w-5 cursor-pointer bg-transparent')
    expect(workspace).toContain('group-hover/right-sidebar-rail:opacity-100')
    expect(workspace).not.toContain('group/right-sidebar-hinge')
    expect(workspace).toContain('<ChevronRight')
    expect(workspace).not.toContain('PanelRightClose')
    expect(workspace).not.toContain('Maximize diff panel')
    expect(workspace).not.toContain('border-border/40 relative flex h-10')
    expect(workspace).toContain('className="relative flex h-11 min-h-11')
    expect(workspace).toContain('data-test-id="t3-right-panel-tabs-scroll"')
    expect(workspace).toContain('min-w-0 flex-1 items-center gap-1 overflow-x-auto')
    expect(workspace).toContain('data-test-id="t3-right-panel-add-slot"')
    expect(workspace).toContain('bg-sidebar sticky right-0 z-[1] ml-1 shrink-0 pl-1')
    expect(workspace).toContain('max-w-40 shrink-0 items-center')
    expect(workspace).toContain(
      "activeSurface === surface ? 'border-transparent bg-chrome-control text-surface'"
    )
    expect(workspace).not.toContain(
      "activeSurface === surface ? 'border-chrome-control-border/70 bg-chrome-control-active text-surface shadow-sm'"
    )

    expect(bridge).toContain('workspace-layers-surface')
    expect(bridge).toContain('<InboxBriefingObjectSurface')
    expect(bridge).toContain('v-if="inboxBriefing"')
    expect(bridge).toContain('<TodoObjectSurface')
    expect(bridge).toContain('<BoardObjectPanelSurface v-else-if="objectId"')
    expect(bridge).toContain(':object-id="objectId"')
    expect(bridge).toContain(':draft="todoDraft"')
    expect(bridge).not.toContain(':pinned="todoPinned"')
    expect(bridge).not.toContain('Board layers')
    expect(bridge).not.toContain('icon-lucide-layers-3')
    expect(bridge).toContain('workspace-assets-surface')
    expect(bridge).toContain('workspace-activity-surface')
    expect(bridge).toContain('assets-scope-project')
    expect(bridge).toContain('assets-scope-global')
    expect(bridge).not.toContain('Reusable workspace items')
    expect(bridge).not.toContain('mx-3 my-2 grid h-8')
    expect(bridge).toContain('v-model="assetQuery"')
    expect(bridge).toContain("? 'project-assets-search' : 'assets-search'")
    expect(bridge).toContain('bg-chrome-control-active text-surface shadow-sm')
    expect(bridge).toContain('<LayerTree')
    expect(bridge).toContain('<WorkspaceProjectAssets')
    expect(bridge).toContain('<AssetsPanel')
    expect(bridge).toContain('<NarratedTracePanel')
  })

  test('opens Activity from Settings in the same right workspace', async () => {
    const settings = await Bun.file('src/components/Shell/AppMenu.vue').text()
    const leftPanel = await Bun.file('src/components/LayersPanel.vue').text()

    expect(settings).toContain('settings-activity-toggle')
    expect(settings).toContain("toggleAgentRightPanel('activity')")
    expect(leftPanel).toContain("openAgentRightPanel('activity')")
  })
})
