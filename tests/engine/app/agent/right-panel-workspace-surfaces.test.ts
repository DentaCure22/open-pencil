import { describe, expect, test } from 'bun:test'

describe('project workspace surfaces', () => {
  test('keeps Work Map on the left and mounts project tools in the T3 workspace', async () => {
    const leftPanel = await Bun.file('src/components/LayersPanel.vue').text()
    const workMap = await Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text()
    const workspace = await Bun.file('src/components/ai-elements/T3RightPanelWorkspace.tsx').text()
    const bridge = await Bun.file('src/components/ai-elements/AiRightPanelWorkspace.vue').text()

    expect(leftPanel).toContain('<AgentChatsPanel />')
    expect(leftPanel).not.toContain('Sidebar utilities')
    expect(leftPanel).not.toContain('left-panel-layers-tab')
    expect(leftPanel).not.toContain('left-panel-assets-tab')
    expect(leftPanel).not.toContain('left-panel-trace-tab')

    expect(workMap).toContain('work-map-project-layers-')
    expect(workMap).toContain("openAgentRightPanel('layers'")
    expect(workMap).toContain(':requested-surface="agentRightPanelState.surface"')

    expect(workspace).toContain("kind: 'layers'")
    expect(workspace).toContain("kind: 'assets'")
    expect(workspace).toContain("kind: 'activity'")
    expect(workspace).toContain('t3-right-panel-layers-host')
    expect(workspace).toContain('t3-right-panel-assets-host')
    expect(workspace).toContain('t3-right-panel-activity-host')

    expect(bridge).toContain('workspace-layers-surface')
    expect(bridge).toContain('workspace-assets-surface')
    expect(bridge).toContain('workspace-activity-surface')
    expect(bridge).toContain('assets-scope-project')
    expect(bridge).toContain('assets-scope-global')
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
