import {
  createUserCodeObjectDocument,
  resolveCodeObjectUiBlock,
  type CodeObjectDocument
} from '@open-pencil/core/code-object'

import type { CodeObjectBoardPermission } from './contracts'
import { FINANCIAL_DASHBOARD_SOURCE } from './saved-sources'

const UI_BLOCK = resolveCodeObjectUiBlock({ block: 'financial-dashboard' })

export const FINANCIAL_DASHBOARD_PRESET = {
  cornerRadius: 0,
  description: UI_BLOCK.definition.description,
  height: UI_BLOCK.height,
  id: 'financial-dashboard',
  label: UI_BLOCK.definition.label,
  modality: 'data-interface',
  width: UI_BLOCK.width
} as const

export function createFinancialDashboardDocument(): CodeObjectDocument<
  'user-code',
  Record<string, unknown>,
  CodeObjectBoardPermission
> {
  const block = resolveCodeObjectUiBlock({
    block: 'financial-dashboard',
    config: {
      accountingMethod: 'Accrual',
      actions: [
        {
          label: 'Review customer mix',
          prompt: 'Show sales by customer for August 2026 and explain concentration risk.'
        }
      ],
      companyName: 'Demo Company',
      comparisonPeriod: 'Compared with July 2026',
      goingWell: [
        {
          description: 'Gross margin improved while revenue also grew.',
          severity: 'Medium',
          text: 'Product revenue increased 11% and gross margin reached 42%.',
          title: 'Revenue quality improved',
          tone: 'success'
        },
        {
          text: 'Operating cash stayed positive for the third consecutive month.',
          title: 'Cash generation is consistent',
          tone: 'success'
        }
      ],
      keyNumbers: [
        {
          label: 'Revenue',
          reportLabel: 'P&L',
          series: [58, 62, 61, 69, 73, 78, 84],
          trend: 'positive',
          value: '$84K',
          whatChanged: 'Up 9% from July'
        },
        {
          label: 'Net income',
          reportLabel: 'P&L',
          series: [8, 10, 9, 12, 13, 15, 17],
          trend: 'positive',
          value: '$17K',
          whatChanged: 'Margin expanded to 20%'
        },
        {
          label: 'Cash balance',
          reportLabel: 'Balance sheet',
          series: [96, 91, 102, 108, 106, 117, 121],
          trend: 'positive',
          value: '$121K',
          whatChanged: 'Up $15K this month'
        },
        {
          label: 'Overdue invoices',
          reportLabel: 'A/R',
          series: [18, 16, 15, 19, 21, 24, 27],
          trend: 'negative',
          value: '$27K',
          whatChanged: '32% of open receivables'
        }
      ],
      needsAttention: [
        {
          action: {
            label: 'Draft reminders',
            prompt: 'Draft friendly reminders for invoices more than 30 days overdue.'
          },
          description: 'Two customers account for 71% of the overdue balance.',
          severity: 'High',
          text: '$27K is overdue, up $6K since last month.',
          title: 'Receivables are aging',
          tone: 'danger'
        },
        {
          severity: 'Cleanup',
          text: 'Five uncategorized expenses are reducing report confidence.',
          title: 'Books need light cleanup',
          tone: 'warning'
        }
      ],
      overallRead: 'mixed',
      overallReadText:
        'Revenue, margin, and cash are healthy. Overdue receivables are the clearest near-term risk.',
      period: 'August 2026',
      table: {
        columns: [
          { key: 'driver', label: 'Cash driver' },
          { align: 'right', key: 'current', label: 'August' },
          { align: 'right', key: 'change', label: 'Change' }
        ],
        rows: [
          { change: '+$7K', current: '$84K', driver: 'Customer receipts' },
          { change: '-$3K', current: '$31K', driver: 'Payroll' },
          {
            change: '-$2K',
            current: '$12K',
            driver: 'Software and services'
          }
        ],
        title: 'Cash drivers'
      },
      title: 'Business health'
    }
  })
  return createUserCodeObjectDocument<CodeObjectBoardPermission>({
    definitionId: 'openpencil.financial-dashboard',
    modality: 'data-interface',
    name: block.definition.label,
    props: {
      block: block.block,
      config: block.config
    },
    source: FINANCIAL_DASHBOARD_SOURCE,
    state: block.initialState,
    surface: block.surface
  })
}
