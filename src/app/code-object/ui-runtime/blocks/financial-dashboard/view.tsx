import type { CodeObjectSurface } from '@open-pencil/core/code-object'

import { cn } from '@/app/code-object/ui-runtime/classnames'
import { Badge } from '@/app/code-object/ui-runtime/components/badge'
import { Button } from '@/app/code-object/ui-runtime/components/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/app/code-object/ui-runtime/components/card'
import { DataTable } from '@/app/code-object/ui-runtime/components/data-table'
import { Sparkline } from '@/app/code-object/ui-runtime/components/sparkline'
import type {
  CodeObjectUiActionHandler,
  CodeObjectUiTone,
  FinancialDashboardFinding,
  FinancialDashboardModel
} from '@/app/code-object/ui-runtime/types'

const READ_TONE: Record<FinancialDashboardModel['overallRead'], CodeObjectUiTone> = {
  mixed: 'warning',
  needs_attention: 'danger',
  stable: 'neutral',
  strong: 'success'
}

function readLabel(read: FinancialDashboardModel['overallRead']) {
  if (read === 'needs_attention') return 'Needs attention'
  return read[0]?.toUpperCase() + read.slice(1)
}

function Finding({
  finding,
  interactionEnabled,
  onAction
}: {
  finding: FinancialDashboardFinding
  interactionEnabled: boolean
  onAction?: CodeObjectUiActionHandler
}) {
  return (
    <li className="grid gap-1.5 border-b border-border/60 py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-xs font-semibold">{finding.title}</strong>
        {finding.severity ? (
          <Badge tone={finding.tone ?? 'neutral'}>{finding.severity}</Badge>
        ) : null}
      </div>
      <p className="m-0 text-xs leading-5 text-card-foreground">{finding.text}</p>
      {finding.description ? (
        <p className="m-0 text-[11px] leading-4 text-muted-foreground">{finding.description}</p>
      ) : null}
      {finding.action ? (
        <Button
          className="mt-1 w-fit"
          disabled={!interactionEnabled || !onAction}
          onClick={() => finding.action && onAction?.(finding.action)}
        >
          {finding.action.label}
        </Button>
      ) : null}
    </li>
  )
}

export function FinancialDashboard({
  interactionEnabled = false,
  model,
  onAction,
  surface
}: {
  interactionEnabled?: boolean
  model: FinancialDashboardModel
  onAction?: CodeObjectUiActionHandler
  surface: CodeObjectSurface
}) {
  const context = [model.period, model.accountingMethod, model.comparisonPeriod]
    .filter(Boolean)
    .join(' · ')

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
          <p className="m-0 mt-1 text-xs text-muted-foreground">{context}</p>
        </div>
        <Badge tone={READ_TONE[model.overallRead]}>{readLabel(model.overallRead)}</Badge>
      </header>

      <Card className="mb-4 border-accent/25 bg-accent/5">
        <CardContent className="pt-4">
          <p className="m-0 text-sm leading-6">{model.overallReadText}</p>
        </CardContent>
      </Card>

      {model.keyNumbers.length > 0 ? (
        <section className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(145px,1fr))] gap-3">
          {model.keyNumbers.map((metric) => (
            <Card key={metric.label}>
              <CardContent className="grid min-h-28 content-between gap-2 pt-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {metric.label}
                    </span>
                    {metric.reportLabel ? (
                      <span className="text-[10px] text-muted-foreground">
                        {metric.reportLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{metric.value}</div>
                  {metric.whatChanged ? (
                    <p className="m-0 mt-1 text-[11px] leading-4 text-muted-foreground">
                      {metric.whatChanged}
                    </p>
                  ) : null}
                </div>
                {metric.series ? <Sparkline values={metric.series} /> : null}
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      <section className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
        {model.goingWell.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>What’s going well</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="m-0 list-none p-0">
                {model.goingWell.map((finding) => (
                  <Finding
                    finding={finding}
                    interactionEnabled={interactionEnabled}
                    key={`${finding.title}-${finding.text}`}
                    onAction={onAction}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {model.needsAttention.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="m-0 list-none p-0">
                {model.needsAttention.map((finding) => (
                  <Finding
                    finding={finding}
                    interactionEnabled={interactionEnabled}
                    key={`${finding.title}-${finding.text}`}
                    onAction={onAction}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </section>

      {model.table ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{model.table.title}</CardTitle>
          </CardHeader>
          <CardContent className="px-1 pb-1">
            <DataTable model={model.table} />
          </CardContent>
        </Card>
      ) : null}

      {model.actions.length > 0 ? (
        <footer className="flex flex-wrap gap-2">
          {model.actions.map((action) => (
            <Button
              disabled={!interactionEnabled || !onAction}
              key={`${action.label}-${action.prompt}`}
              onClick={() => onAction?.(action)}
            >
              {action.label}
            </Button>
          ))}
        </footer>
      ) : null}
    </main>
  )
}
