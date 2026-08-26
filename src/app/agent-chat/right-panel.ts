import { shallowRef } from 'vue'

export type AgentRightPanelSurface =
  | 'activity'
  | 'assets'
  | 'browser'
  | 'diff'
  | 'files'
  | 'layers'
  | 'terminal'

export interface AgentRightPanelContext {
  projectId?: string
  projectName?: string
}

export interface AgentRightPanelState extends AgentRightPanelContext {
  activationNonce: number
  open: boolean
  surface: AgentRightPanelSurface
}

export const agentRightPanelState = shallowRef<AgentRightPanelState>({
  activationNonce: 0,
  open: false,
  surface: 'diff'
})

export function openAgentRightPanel(
  surface: AgentRightPanelSurface,
  context: AgentRightPanelContext = {}
) {
  agentRightPanelState.value = {
    ...agentRightPanelState.value,
    ...context,
    activationNonce: agentRightPanelState.value.activationNonce + 1,
    open: true,
    surface
  }
}

export function closeAgentRightPanel() {
  agentRightPanelState.value = {
    ...agentRightPanelState.value,
    open: false
  }
}

export function setAgentRightPanelSurface(surface: AgentRightPanelSurface) {
  agentRightPanelState.value = {
    ...agentRightPanelState.value,
    open: true,
    surface
  }
}

export function toggleAgentRightPanel(
  surface: AgentRightPanelSurface,
  context: AgentRightPanelContext = {}
) {
  const current = agentRightPanelState.value
  if (current.open && current.surface === surface) {
    closeAgentRightPanel()
    return
  }
  openAgentRightPanel(surface, context)
}
