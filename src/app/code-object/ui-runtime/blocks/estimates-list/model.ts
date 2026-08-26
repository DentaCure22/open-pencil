import type {
  EstimateListItem,
  EstimateListModel,
  EstimateStatus
} from '@/app/code-object/ui-runtime/types'

import { isRecord, optionalString, stringValue } from '../model'

function statusValue(value: unknown): EstimateStatus {
  const statuses: readonly EstimateStatus[] = [
    'accepted',
    'closed',
    'converted',
    'pending',
    'rejected',
    'unknown'
  ]
  return typeof value === 'string' && statuses.includes(value as EstimateStatus)
    ? (value as EstimateStatus)
    : 'unknown'
}

function estimate(value: unknown, index: number): EstimateListItem | null {
  if (!isRecord(value)) return null
  const amount =
    typeof value.amount === 'number' && Number.isFinite(value.amount) ? value.amount : 0
  return {
    amount,
    currencyCode: optionalString(value.currencyCode),
    currencySymbol: stringValue(value.currencySymbol, '$'),
    customer: stringValue(value.customer, 'Unknown customer'),
    customerEmail: optionalString(value.customerEmail),
    date: stringValue(value.date, 'Date unavailable'),
    expirationDate: optionalString(value.expirationDate),
    id: stringValue(value.id, `estimate-${index + 1}`),
    itemSummary: optionalString(value.itemSummary),
    quickBooksUrl: optionalString(value.quickBooksUrl),
    referenceNumber: stringValue(value.referenceNumber, String(index + 1)),
    status: statusValue(value.status)
  }
}

export function normalizeEstimatesListModel(value: unknown): EstimateListModel {
  const record = isRecord(value) ? value : {}
  const estimates = Array.isArray(record.estimates)
    ? record.estimates.flatMap((candidate, index) => estimate(candidate, index) ?? []).slice(0, 50)
    : []
  return {
    companyName: stringValue(record.companyName, 'QuickBooks company'),
    estimates,
    sourceLabel: stringValue(record.sourceLabel, 'Connected QuickBooks data'),
    title: stringValue(record.title, 'Estimates')
  }
}
