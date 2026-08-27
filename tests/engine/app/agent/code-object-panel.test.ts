import { describe, expect, test } from 'bun:test'

describe('Code Object panel', () => {
  test('renders any Code Object in the right Object panel while chat stays left', async () => {
    const [
      panel,
      objectNavigation,
      objectSurface,
      panelState,
      rightPanelState,
      workspace,
      overlays
    ] = await Promise.all([
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/app/agent-chat/panel-object-navigation.ts').text(),
      Bun.file('src/components/agent-chat/CodeObjectPanelSurface.vue').text(),
      Bun.file('src/app/agent-chat/panel.ts').text(),
      Bun.file('src/app/agent-chat/right-panel.ts').text(),
      Bun.file('src/components/ai-elements/AiRightPanelWorkspace.vue').text(),
      Bun.file('src/components/canvas/CodeObjectOverlays.vue').text()
    ])

    expect(panelState).toContain("'conversation' | 'list'")
    expect(panelState).not.toContain("'conversation' | 'list' | 'plan'")
    expect(panelState).not.toContain('agentChatsPanelPlanObjectId')
    expect(panelState).toContain("=== 'plan') agentChatsPanelView.value = 'list'")
    expect(rightPanelState).toContain('codeObjectId?: string')
    expect(objectNavigation).toContain("openAgentRightPanel('object', {")
    expect(objectNavigation).toContain('codeObjectId: todo.planObjectId')
    expect(panel).toContain('data-test-id="agent-selected-plan-object"')
    expect(panel).toContain('@click="openSelectedPlan"')
    expect(panel).not.toContain('agent-selected-plan"')
    expect(panel).not.toContain('PlanSidebarSurface')

    expect(workspace).toContain('import CodeObjectPanelSurface')
    expect(workspace).toContain('<CodeObjectPanelSurface v-if="codeObjectId"')
    expect(workspace).toContain(':object-id="codeObjectId"')

    expect(objectSurface).toContain('cachedCodeObjectDocument(node)')
    expect(objectSurface).not.toContain('isWorkPlanDocument')
    expect(objectSurface).toContain('runtime.renderCodeObject(')
    expect(objectSurface).toContain('updateCodeObjectState(store, objectId, state)')
    expect(objectSurface).toContain('interactionEnabled: true')
    expect(objectSurface).toContain(
      'bytes: assetHash ? store.graph.images.get(assetHash) : undefined'
    )
    expect(objectSurface).toContain('onExtractPdfPage: extractPdfPage')
    expect(objectSurface).toContain('data-test-id="code-object-panel-host"')
    expect(objectSurface).toContain('<AgentConversationBoardSurface')
    expect(objectSurface).toContain('<SmylrTrustedWebApp')

    expect(overlays).not.toContain("openAgentRightPanel('object', {")
    expect(overlays).not.toContain('data-test-id="code-object-frame-chrome"')
  })
})
