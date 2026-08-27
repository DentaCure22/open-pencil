import { describe, expect, test } from 'bun:test'

describe('connected Plan sidebar', () => {
  test('opens the rendered Plan as a first-class left-sidebar view', async () => {
    const [panel, planSurface, panelState] = await Promise.all([
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/components/agent-chat/PlanSidebarSurface.vue').text(),
      Bun.file('src/app/agent-chat/panel.ts').text()
    ])

    expect(panelState).toContain("'conversation' | 'list' | 'plan'")
    expect(panelState).toContain('agentChatsPanelPlanObjectId')
    expect(panel).toContain('data-test-id="agent-selected-plan"')
    expect(panel).toContain('<PlanSidebarSurface :object-id="planObjectId" />')
    expect(panel).toContain("view.value = 'plan'")
    expect(panel).toContain('planObjectId.value = link.objectId')
    expect(panel).toContain('data-test-id="agent-plan-open-chat"')
    expect(panel).toContain('@click="openConnectedPlanChat"')
    expect(panel).toContain('data-test-id="agent-selected-plan-object"')
    expect(panel).toContain('@click="openSelectedPlan"')

    expect(planSurface).toContain('cachedCodeObjectDocument(node)')
    expect(planSurface).toContain('isWorkPlanDocument(document)')
    expect(planSurface).toContain('runtime.renderCodeObject(')
    expect(planSurface).toContain('interactionEnabled: false')
    expect(planSurface).toContain('data-test-id="agent-plan-sidebar-host"')
  })
})
