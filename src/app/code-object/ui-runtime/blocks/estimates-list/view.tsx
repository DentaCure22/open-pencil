import type { CodeObjectSurface } from '@open-pencil/core/code-object'

import { cn } from '@/app/code-object/ui-runtime/classnames'
import { Badge } from '@/app/code-object/ui-runtime/components/badge'
import { Button } from '@/app/code-object/ui-runtime/components/button'
import { Card, CardContent } from '@/app/code-object/ui-runtime/components/card'
import type {
  CodeObjectUiActionHandler,
  CodeObjectUiTone,
  EstimateListItem,
  EstimateListModel,
  EstimateStatus
} from '@/app/code-object/ui-runtime/types'

const STATUS_TONE: Record<EstimateStatus, CodeObjectUiTone> = {
  accepted: 'success',
  closed: 'neutral',
  converted: 'accent',
  pending: 'warning',
  rejected: 'danger',
  unknown: 'neutral'
}

function titleCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

function money(amount: number, symbol: string) {
  return `${symbol}${amount.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
}

function estimateAction(estimate: EstimateListItem) {
  const link = estimate.quickBooksUrl ? ` Open in QuickBooks: ${estimate.quickBooksUrl}` : ''
  return {
    label: `Review #${estimate.referenceNumber}`,
    prompt: `Review QuickBooks estimate #${estimate.referenceNumber} for ${estimate.customer}.${link}`
  }
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="m-0 text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="m-0 mt-1 text-2xl font-semibold tabular-nums tracking-[-0.03em]">{value}</p>
      </CardContent>
    </Card>
  )
}

export function EstimatesList({
  interactionEnabled = false,
  model,
  onAction,
  surface
}: {
  interactionEnabled?: boolean
  model: EstimateListModel
  onAction?: CodeObjectUiActionHandler
  surface: CodeObjectSurface
}) {
  const pending = model.estimates.filter((estimate) => estimate.status === 'pending').length
  const pipeline = model.estimates.reduce((sum, estimate) => sum + estimate.amount, 0)
  const currencySymbol = model.estimates[0]?.currencySymbol ?? '$'

  return (
    <main
      className={cn(
        'min-h-full p-5 font-sans text-card-foreground',
        surface.background === 'transparent' ? 'bg-transparent' : 'bg-card'
      )}
      data-code-object-surface-background={surface.background}
    >
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {model.companyName}
          </p>
          <h1 className="m-0 mt-1 text-2xl font-semibold tracking-[-0.035em]">{model.title}</h1>
          <p className="m-0 mt-1 text-xs text-muted-foreground">{model.sourceLabel}</p>
        </div>
        <Badge tone="success">Live data</Badge>
      </header>

      <section className="mb-4 grid grid-cols-3 gap-3">
        <SummaryCard label="Estimates" value={String(model.estimates.length)} />
        <SummaryCard label="Pipeline value" value={money(pipeline, currencySymbol)} />
        <SummaryCard label="Pending" value={String(pending)} />
      </section>

      <Card>
        <div className="grid grid-cols-[1.15fr_1.5fr_0.75fr_0.7fr_0.8fr_auto] items-center gap-3 border-b border-border px-4 py-3 text-[11px] font-medium text-muted-foreground">
          <span>Estimate</span>
          <span>Customer</span>
          <span>Date</span>
          <span>Status</span>
          <span className="text-right">Amount</span>
          <span className="w-20" />
        </div>
        <ul className="m-0 list-none p-0">
          {model.estimates.map((estimate) => {
            const action = estimateAction(estimate)
            return (
              <li
                className="grid grid-cols-[1.15fr_1.5fr_0.75fr_0.7fr_0.8fr_auto] items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0"
                key={estimate.id}
              >
                <div className="min-w-0">
                  <strong className="block text-xs font-semibold">
                    #{estimate.referenceNumber}
                  </strong>
                  {estimate.itemSummary ? (
                    <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                      {estimate.itemSummary}
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <span className="block truncate text-xs">{estimate.customer}</span>
                  {estimate.customerEmail ? (
                    <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                      {estimate.customerEmail}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">{estimate.date}</span>
                <Badge tone={STATUS_TONE[estimate.status]}>{titleCase(estimate.status)}</Badge>
                <strong className="text-right text-xs tabular-nums">
                  {money(estimate.amount, estimate.currencySymbol)}
                </strong>
                <Button
                  className="w-20"
                  disabled={!interactionEnabled || !onAction}
                  onClick={() => onAction?.(action)}
                >
                  Review
                </Button>
              </li>
            )
          })}
        </ul>
        {model.estimates.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No estimates were returned.
          </div>
        ) : null}
      </Card>
    </main>
  )
}
