import type { ComponentType } from 'react'

import {
  CODE_OBJECT_UI_BLOCKS,
  codeObjectUiBlockDefinition,
  isCodeObjectUiBlockName,
  normalizeCodeObjectSurface,
  validateCodeObjectUiBlockConfig,
  type CodeObjectSurface,
  type CodeObjectUiBlockName
} from '@open-pencil/core/code-object'

import type { CodeObjectUiActionHandler } from '../types'
import { EstimatesList, normalizeEstimatesListModel } from './estimates-list'
import { FinancialDashboard, normalizeFinancialDashboardModel } from './financial-dashboard'

export { CODE_OBJECT_UI_BLOCKS, type CodeObjectUiBlockName }

type ConfiguredUiBlockRendererProps = {
  config: Record<string, unknown>
  interactionEnabled: boolean
  onAction?: CodeObjectUiActionHandler
  surface: CodeObjectSurface
}

function FinancialDashboardRenderer({
  config,
  interactionEnabled,
  onAction,
  surface
}: ConfiguredUiBlockRendererProps) {
  return (
    <FinancialDashboard
      interactionEnabled={interactionEnabled}
      model={normalizeFinancialDashboardModel(config)}
      onAction={onAction}
      surface={surface}
    />
  )
}

function EstimatesListRenderer({
  config,
  interactionEnabled,
  onAction,
  surface
}: ConfiguredUiBlockRendererProps) {
  return (
    <EstimatesList
      interactionEnabled={interactionEnabled}
      model={normalizeEstimatesListModel(config)}
      onAction={onAction}
      surface={surface}
    />
  )
}

const UI_BLOCK_RENDERERS = {
  'estimates-list': EstimatesListRenderer,
  'financial-dashboard': FinancialDashboardRenderer
} satisfies Record<CodeObjectUiBlockName, ComponentType<ConfiguredUiBlockRendererProps>>

function UiBlockError({ detail, title }: { detail: string; title: string }) {
  return (
    <main className="grid h-full min-h-full place-items-center bg-card p-6 text-card-foreground">
      <div className="max-w-sm text-center">
        <h1 className="m-0 text-lg font-semibold">{title}</h1>
        <p className="m-0 mt-2 text-sm text-muted-foreground">{detail}</p>
      </div>
    </main>
  )
}

export function ConfiguredBlock({
  block,
  config,
  interactionEnabled = false,
  onAction,
  surface
}: {
  block: string
  config?: unknown
  interactionEnabled?: boolean
  onAction?: CodeObjectUiActionHandler
  surface?: CodeObjectSurface
}) {
  if (!isCodeObjectUiBlockName(block)) {
    return (
      <UiBlockError
        detail={`Register “${block || 'unnamed'}” before using it.`}
        title="Unknown UI block"
      />
    )
  }
  const definition = codeObjectUiBlockDefinition(block)
  if (!definition) {
    return (
      <UiBlockError detail={`The “${block}” definition is unavailable.`} title="UI block error" />
    )
  }
  const validated = validateCodeObjectUiBlockConfig(block, config)
  if (!validated.success) {
    return <UiBlockError detail={validated.error} title="Invalid UI block configuration" />
  }
  const Renderer = UI_BLOCK_RENDERERS[block]
  return (
    <Renderer
      config={validated.config}
      interactionEnabled={interactionEnabled}
      onAction={onAction}
      surface={normalizeCodeObjectSurface(surface ?? definition.surface)}
    />
  )
}
