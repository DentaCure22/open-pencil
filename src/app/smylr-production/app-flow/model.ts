export type AppScreenFlowNodeKind = 'entry' | 'screen' | 'exit'

export type AppScreenFlowEdgeKind = 'entry' | 'primary' | 'loop' | 'exit'

export type AppScreenFlowNode = {
  id: string
  kind: AppScreenFlowNodeKind
  label: string
  state?: string
}

export type AppScreenFlowEdge = {
  id: string
  kind: AppScreenFlowEdgeKind
  label: string
  sourceId: string
  targetId: string
}

export type AppScreenFlowDefinition = {
  edges: AppScreenFlowEdge[]
  id: string
  label: string
  nodes: AppScreenFlowNode[]
  pageId: string
  route: string
  schemaVersion: string
}

export const DENTAL_CHART_APP_FLOW = {
  edges: [
    {
      id: 'open-chart',
      kind: 'entry',
      label: 'Open chart',
      sourceId: 'entry',
      targetId: 'current'
    },
    {
      id: 'set-up-exam',
      kind: 'primary',
      label: 'Set up exam',
      sourceId: 'current',
      targetId: 'exam-setup'
    },
    {
      id: 'begin-charting',
      kind: 'primary',
      label: 'Begin charting',
      sourceId: 'exam-setup',
      targetId: 'active-charting'
    },
    {
      id: 'review-chart',
      kind: 'primary',
      label: 'Review chart',
      sourceId: 'active-charting',
      targetId: 'review'
    },
    {
      id: 'edit-chart',
      kind: 'loop',
      label: 'Edit chart',
      sourceId: 'review',
      targetId: 'active-charting'
    },
    {
      id: 'finish-charting',
      kind: 'exit',
      label: 'Finish',
      sourceId: 'review',
      targetId: 'exit'
    }
  ],
  id: 'dental-chart-core-flow',
  label: 'Dental Chart app flow',
  nodes: [
    { id: 'entry', kind: 'entry', label: 'Start' },
    { id: 'current', kind: 'screen', label: 'Current', state: 'current' },
    { id: 'exam-setup', kind: 'screen', label: 'Exam setup', state: 'exam-setup' },
    {
      id: 'active-charting',
      kind: 'screen',
      label: 'Active charting',
      state: 'active-charting'
    },
    { id: 'review', kind: 'screen', label: 'Review', state: 'review' },
    { id: 'exit', kind: 'exit', label: 'Done' }
  ],
  pageId: 'dental-chart',
  route: '/dental-chart',
  schemaVersion: '4'
} satisfies AppScreenFlowDefinition
