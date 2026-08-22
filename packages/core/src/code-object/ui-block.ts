import { toJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { normalizeCodeObjectSurface, type CodeObjectSurface } from '#core/code-object/document'

type JsonRecord = Record<string, unknown>

const requiredText = (maxLength: number) =>
  v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(maxLength))
const optionalText = (maxLength: number) => v.optional(requiredText(maxLength))

const ACTION_SCHEMA = v.strictObject({
  label: requiredText(80),
  prompt: requiredText(2_000)
})

const METRIC_SCHEMA = v.strictObject({
  label: requiredText(120),
  reportLabel: optionalText(80),
  series: v.optional(v.pipe(v.array(v.number()), v.minLength(2), v.maxLength(32))),
  trend: v.optional(v.picklist(['negative', 'no_change', 'positive'])),
  value: requiredText(120),
  whatChanged: optionalText(240)
})

const FINDING_SCHEMA = v.strictObject({
  action: v.optional(ACTION_SCHEMA),
  description: optionalText(600),
  severity: v.optional(v.picklist(['Cleanup', 'High', 'Medium'])),
  text: requiredText(600),
  title: requiredText(160),
  tone: v.optional(v.picklist(['accent', 'danger', 'neutral', 'success', 'warning']))
})

const TABLE_COLUMN_SCHEMA = v.strictObject({
  align: v.optional(v.picklist(['left', 'right'])),
  key: requiredText(80),
  label: requiredText(120)
})

const TABLE_SCHEMA = v.strictObject({
  columns: v.pipe(v.array(TABLE_COLUMN_SCHEMA), v.minLength(1), v.maxLength(12)),
  rows: v.pipe(v.array(v.record(v.string(), v.union([v.number(), v.string()]))), v.maxLength(50)),
  title: requiredText(160)
})

const FINANCIAL_DASHBOARD_CONFIG_SCHEMA = v.strictObject({
  accountingMethod: optionalText(80),
  actions: v.optional(v.pipe(v.array(ACTION_SCHEMA), v.maxLength(6))),
  companyName: optionalText(160),
  comparisonPeriod: optionalText(160),
  goingWell: v.optional(v.pipe(v.array(FINDING_SCHEMA), v.maxLength(8))),
  keyNumbers: v.optional(v.pipe(v.array(METRIC_SCHEMA), v.maxLength(8))),
  needsAttention: v.optional(v.pipe(v.array(FINDING_SCHEMA), v.maxLength(8))),
  overallRead: v.optional(v.picklist(['mixed', 'needs_attention', 'stable', 'strong'])),
  overallReadText: optionalText(1_200),
  period: optionalText(160),
  table: v.optional(TABLE_SCHEMA),
  title: optionalText(160)
})

const ESTIMATE_SCHEMA = v.strictObject({
  amount: v.pipe(v.number(), v.minValue(0)),
  currencyCode: optionalText(12),
  currencySymbol: optionalText(8),
  customer: requiredText(240),
  customerEmail: optionalText(320),
  date: requiredText(40),
  expirationDate: optionalText(40),
  id: requiredText(800),
  itemSummary: optionalText(500),
  quickBooksUrl: optionalText(2_048),
  referenceNumber: requiredText(80),
  status: v.picklist(['accepted', 'closed', 'converted', 'pending', 'rejected', 'unknown'])
})

const ESTIMATES_LIST_CONFIG_SCHEMA = v.strictObject({
  companyName: optionalText(160),
  estimates: v.pipe(v.array(ESTIMATE_SCHEMA), v.maxLength(50)),
  sourceLabel: optionalText(240),
  title: optionalText(160)
})

export const CODE_OBJECT_UI_BLOCK_CAPABILITIES = ['actions', 'charts', 'tables'] as const

export type CodeObjectUiBlockCapability = (typeof CODE_OBJECT_UI_BLOCK_CAPABILITIES)[number]
export type CodeObjectUiBlockName = 'estimates-list' | 'financial-dashboard'

export type CodeObjectUiBlockDefinition = {
  capabilities: readonly CodeObjectUiBlockCapability[]
  configSchema: JsonRecord
  defaultSize: {
    height: number
    width: number
  }
  defaultState: JsonRecord
  description: string
  id: CodeObjectUiBlockName
  label: string
  sizing: 'content' | 'viewport'
  surface: CodeObjectSurface
}

const UI_BLOCK_REGISTRY = [
  {
    configSchema: FINANCIAL_DASHBOARD_CONFIG_SCHEMA,
    definition: {
      capabilities: ['actions', 'charts', 'tables'],
      configSchema: jsonSchema(FINANCIAL_DASHBOARD_CONFIG_SCHEMA),
      defaultSize: { height: 980, width: 1040 },
      defaultState: { lastAction: null },
      description: 'A business-health dashboard with metrics, findings, actions, and detail tables',
      id: 'financial-dashboard',
      label: 'Financial dashboard',
      sizing: 'content',
      surface: { background: 'transparent', overflow: 'scroll' }
    }
  },
  {
    configSchema: ESTIMATES_LIST_CONFIG_SCHEMA,
    definition: {
      capabilities: ['actions', 'tables'],
      configSchema: jsonSchema(ESTIMATES_LIST_CONFIG_SCHEMA),
      defaultSize: { height: 720, width: 1040 },
      defaultState: { lastAction: null },
      description:
        'A connected estimate pipeline with totals, status, customer, and review actions',
      id: 'estimates-list',
      label: 'Estimates list',
      sizing: 'content',
      surface: { background: 'transparent', overflow: 'scroll' }
    }
  }
] satisfies readonly {
  configSchema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>
  definition: CodeObjectUiBlockDefinition
}[]

export const CODE_OBJECT_UI_BLOCKS: readonly CodeObjectUiBlockName[] = Object.freeze(
  UI_BLOCK_REGISTRY.map(({ definition }) => definition.id)
)

export const CODE_OBJECT_UI_BLOCK_DEFINITIONS: readonly CodeObjectUiBlockDefinition[] =
  Object.freeze(UI_BLOCK_REGISTRY.map(({ definition }) => definition))

export type CodeObjectUiBlockConfigValidation =
  | { config: JsonRecord; success: true }
  | { error: string; success: false }

export type ResolveCodeObjectUiBlockInput = {
  block: string
  config?: unknown
  height?: number
  initialState?: JsonRecord
  surface?: CodeObjectSurface
  width?: number
}

export type ResolvedCodeObjectUiBlock = {
  block: CodeObjectUiBlockName
  config: JsonRecord
  definition: CodeObjectUiBlockDefinition
  height: number
  initialState: JsonRecord
  surface: CodeObjectSurface
  width: number
}

export const CONFIGURED_CODE_OBJECT_SOURCE = `import { ConfiguredBlock } from '@open-pencil/code-object-ui'

type CodeObjectProps = {
  interactionEnabled: boolean
  props: {
    block?: string
    config?: unknown
  }
  setState: (next: Record<string, unknown>) => void
  state: Record<string, unknown>
  surface?: {
    background: 'surface' | 'transparent'
    overflow: 'clip' | 'scroll'
  }
}

export default function ConfiguredUiBlock({
  interactionEnabled,
  props,
  setState,
  state,
  surface
}: CodeObjectProps) {
  return (
    <ConfiguredBlock
      block={props.block ?? ''}
      config={props.config}
      interactionEnabled={interactionEnabled}
      onAction={(action) => setState({ ...state, lastAction: action.prompt })}
      surface={surface}
    />
  )
}`

function registeredUiBlock(block: string) {
  return UI_BLOCK_REGISTRY.find(({ definition }) => definition.id === block) ?? null
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function jsonSchema(schema: v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>): JsonRecord {
  const converted = toJsonSchema(schema, { ignoreActions: ['trim'], typeMode: 'input' })
  if (!isRecord(converted)) throw new TypeError('UI block JSON Schema conversion failed.')
  return converted
}

export function codeObjectUiBlockDefinition(block: string): CodeObjectUiBlockDefinition | null {
  return registeredUiBlock(block)?.definition ?? null
}

export function isCodeObjectUiBlockName(value: string): value is CodeObjectUiBlockName {
  return registeredUiBlock(value) !== null
}

export function validateCodeObjectUiBlockConfig(
  block: string,
  value: unknown,
  label = 'UI block config'
): CodeObjectUiBlockConfigValidation {
  const registered = registeredUiBlock(block)
  if (!registered) return { error: `UI block "${block}" is not registered.`, success: false }
  const result = v.safeParse(registered.configSchema, value ?? {})
  if (!result.success) {
    return { error: `${label} is invalid:\n${v.summarize(result.issues)}`, success: false }
  }
  if (!isRecord(result.output)) {
    return { error: `${label} must be an object.`, success: false }
  }
  return { config: structuredClone(result.output), success: true }
}

export function resolveCodeObjectUiBlock(
  input: ResolveCodeObjectUiBlockInput,
  configLabel = 'UI block config'
): ResolvedCodeObjectUiBlock {
  const registered = registeredUiBlock(input.block)
  if (!registered) throw new Error(`UI block "${input.block}" is not registered.`)
  const { definition } = registered
  const validated = validateCodeObjectUiBlockConfig(input.block, input.config, configLabel)
  if (!validated.success) throw new Error(validated.error)
  return {
    block: definition.id,
    config: validated.config,
    definition,
    height: input.height ?? definition.defaultSize.height,
    initialState: structuredClone(input.initialState ?? definition.defaultState),
    surface: input.surface
      ? normalizeCodeObjectSurface(input.surface)
      : structuredClone(definition.surface),
    width: input.width ?? definition.defaultSize.width
  }
}

export function codeObjectUiBlockSource(block: string): string {
  if (!isCodeObjectUiBlockName(block)) throw new Error(`UI block "${block}" is not registered.`)
  return CONFIGURED_CODE_OBJECT_SOURCE
}
