export type CodeObjectUiTone = 'accent' | 'danger' | 'neutral' | 'success' | 'warning'

export type DataChartKind = 'area' | 'bar' | 'line'

export type DataChartSeries = {
  color?: string
  id: string
  label: string
  values: number[]
}

export type DataChartModel = {
  kind: DataChartKind
  labels: string[]
  series: DataChartSeries[]
}

export type CodeObjectUiAction = {
  label: string
  prompt: string
}

export type FinancialDashboardMetric = {
  label: string
  reportLabel?: string
  series?: number[]
  trend?: 'negative' | 'no_change' | 'positive'
  value: string
  whatChanged?: string
}

export type FinancialDashboardFinding = {
  action?: CodeObjectUiAction
  description?: string
  severity?: 'Cleanup' | 'High' | 'Medium'
  text: string
  title: string
  tone?: CodeObjectUiTone
}

export type FinancialDashboardTableColumn = {
  align?: 'left' | 'right'
  key: string
  label: string
}

export type FinancialDashboardTable = {
  columns: FinancialDashboardTableColumn[]
  rows: Record<string, number | string>[]
  title: string
}

export type FinancialDashboardModel = {
  accountingMethod?: string
  actions: CodeObjectUiAction[]
  companyName: string
  comparisonPeriod?: string
  goingWell: FinancialDashboardFinding[]
  keyNumbers: FinancialDashboardMetric[]
  needsAttention: FinancialDashboardFinding[]
  overallRead: 'mixed' | 'needs_attention' | 'stable' | 'strong'
  overallReadText: string
  period: string
  table?: FinancialDashboardTable
  title: string
}

export type CodeObjectUiActionHandler = (action: CodeObjectUiAction) => void

export type EstimateStatus =
  | 'accepted'
  | 'closed'
  | 'converted'
  | 'pending'
  | 'rejected'
  | 'unknown'

export type EstimateListItem = {
  amount: number
  currencyCode?: string
  currencySymbol: string
  customer: string
  customerEmail?: string
  date: string
  expirationDate?: string
  id: string
  itemSummary?: string
  quickBooksUrl?: string
  referenceNumber: string
  status: EstimateStatus
}

export type EstimateListModel = {
  companyName: string
  estimates: EstimateListItem[]
  sourceLabel: string
  title: string
}
