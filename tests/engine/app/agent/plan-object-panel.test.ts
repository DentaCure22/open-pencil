import { describe, expect, test } from 'bun:test'

describe('connected Plan object panel', () => {
  test('opens the rendered Plan in the right Object panel while chat stays left', async () => {
    const [panel, planSurface, panelState, rightPanelState, workspace] = await Promise.all([
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/components/agent-chat/PlanObjectSurface.vue').text(),
      Bun.file('src/app/agent-chat/panel.ts').text(),
      Bun.file('src/app/agent-chat/right-panel.ts').text(),
      Bun.file('src/components/ai-elements/AiRightPanelWorkspace.vue').text()
    ])

    expect(panelState).toContain("'conversation' | 'list'")
    expect(panelState).not.toContain("'conversation' | 'list' | 'plan'")
    expect(panelState).not.toContain('agentChatsPanelPlanObjectId')
    expect(panelState).toContain("=== 'plan') agentChatsPanelView.value = 'list'")
    expect(rightPanelState).toContain('objectPlanId?: string')
    expect(panel).toContain('OPEN_PLAN_OBJECT_EVENT')
    expect(panel).toContain("openAgentRightPanel('object', {")
    expect(panel).toContain('objectPlanId: link.objectId')
    expect(panel).toContain('data-test-id="agent-selected-plan-object"')
    expect(panel).toContain('@click="openSelectedPlan"')
    expect(panel).not.toContain('agent-selected-plan"')
    expect(panel).not.toContain('PlanSidebarSurface')

    expect(workspace).toContain('import PlanObjectSurface')
    expect(workspace).toContain('<PlanObjectSurface v-if="planObjectId"')
    expect(workspace).toContain(':object-id="planObjectId"')

    expect(planSurface).toContain('cachedCodeObjectDocument(node)')
    expect(planSurface).toContain('isWorkPlanDocument(document)')
    expect(planSurface).toContain('runtime.renderCodeObject(')
    expect(planSurface).toContain('interactionEnabled: false')
    expect(planSurface).toContain('data-test-id="plan-object-host"')
  })
})
