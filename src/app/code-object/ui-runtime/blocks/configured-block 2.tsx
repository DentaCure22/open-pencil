import {
  CODE_OBJECT_UI_BLOCKS,
  normalizeCodeObjectSurface,
  type CodeObjectSurface,
  type CodeObjectUiBlockName
} from '@open-pencil/core/code-object'

import type { CodeObjectUiActionHandler } from '../types'
import { FinancialDashboard, normalizeFinancialDashboardModel } from './financial-dashboard'

export { CODE_OBJECT_UI_BLOCKS, type CodeObjectUiBlockName }

export function ConfiguredBlock({
  block,
  config,
  interactionEnabled = false,
  onAction,
  surface
}: {
  block: string
  config: unknown
  interactionEnabled?: boolean
  onAction?: CodeObjectUiActionHandler
  surface?: CodeObjectSurface
}) {
  if (block === 'financial-dashboard') {
    return (
      <FinancialDashboard
        interactionEnabled={interactionEnabled}
        model={normalizeFinancialDashboardModel(config)}
        onAction={onAction}
        surface={normalizeCodeObjectSurface(surface)}
      />
    )
  }

  return (
    <main className="grid h-full min-h-full place-items-center bg-card p-6 text-card-foreground">
      <div className="max-w-sm text-center">
        <h1 className="m-0 text-lg font-semibold">Unknown UI block</h1>
        <p className="m-0 mt-2 text-sm text-muted-foreground">
          Register “{block || 'unnamed'}” in @open-pencil/code-object-ui before using it.
        </p>
      </div>
    </main>
  )
}
