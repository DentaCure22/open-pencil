import type { SceneNode } from '@open-pencil/scene-graph'

import { isCodeObjectViewportPresetId, type CodeObjectViewportPresetId } from './viewport'

export const CODE_OBJECT_PLUGIN_ID = 'openpencil-code-object'
export const CODE_OBJECT_KIND = 'code-object'
export const CODE_OBJECT_SCHEMA_VERSION = 1 as const

/**
 * Every runnable Code Object `component` value. Custom TSX always uses `user-code`;
 * custom identity belongs in `definitionId` and `name`. An unrecognized component
 * renders nothing, so writers must validate against this list before persisting.
 */
export const KNOWN_CODE_OBJECT_COMPONENTS = [
  'agent-conversation-terminal',
  'code-starter',
  'earth-signals',
  'external-live-surface',
  'office-document',
  'office-spreadsheet',
  'open-source-workspace',
  'orbit-lab',
  'pdf-document',
  'pptx-deck',
  'signal-bloom',
  'smylr-flow-screen',
  'smylr-production-app',
  'user-code'
] as const

export function isKnownCodeObjectComponent(value: string): boolean {
  return (KNOWN_CODE_OBJECT_COMPONENTS as readonly string[]).includes(value)
}
export const SMYLR_PRODUCTION_PLUGIN_ID = 'smylr-production'
export const SMYLR_CODE_OBJECT_FRAME_KIND = 'smylr-code-object-frame'
export const DEFAULT_CODE_OBJECT_SURFACE = {
  background: 'surface',
  overflow: 'clip'
} as const satisfies CodeObjectSurface
export const SMYLR_TRUSTED_WEB_APP_SOURCE = `type SmylrProductionAppProps = {
  interactionEnabled: boolean
  props: {
    route: string
  }
}

/**
 * OpenPencil mounts the real Smylr application for this Code Object through
 * its production-runtime adapter. The persisted route remains frame-owned.
 */
export default function SmylrProductionApp({
  interactionEnabled,
  props
}: SmylrProductionAppProps) {
  return (
    <main
      data-smylr-production-route={props.route}
      data-smylr-interaction-enabled={String(interactionEnabled)}
    />
  )
}`

type JsonRecord = Record<string, unknown>

export type CodeObjectSurface = {
  background: 'surface' | 'transparent'
  overflow: 'clip' | 'scroll'
}

const SMYLR_FRAME_METADATA_KEYS = new Set(['kind', 'pageId', 'route', 'state'])

export type CodeObjectDocument<
  Component extends string = string,
  State extends JsonRecord = JsonRecord,
  BoardPermission = unknown
> = {
  boardPermissions: BoardPermission[]
  component: Component
  definitionId: string
  name: string
  props: JsonRecord
  runtime: 'openpencil-code'
  schemaVersion: typeof CODE_OBJECT_SCHEMA_VERSION
  source: string
  state: State
  surface?: CodeObjectSurface
  viewport?: {
    preset: CodeObjectViewportPresetId
  }
}

export type CodeObjectDocumentEnvelope = JsonRecord & {
  component: string
  runtime: 'openpencil-code'
  schemaVersion: typeof CODE_OBJECT_SCHEMA_VERSION
  state: JsonRecord
  surface?: CodeObjectSurface
}

export type CreateUserCodeObjectDocumentInput<BoardPermission = unknown> = {
  boardPermissions?: BoardPermission[]
  definitionId: string
  name: string
  props?: JsonRecord
  source: string
  state?: JsonRecord
  surface?: CodeObjectSurface
}

export type SmylrTrustedWebAppDocument<BoardPermission = unknown> = CodeObjectDocument<
  'smylr-production-app',
  { view: 'live' },
  BoardPermission
> & {
  label: string
  launch: {
    launcherId: 'smylr'
    startScript: 'npm run dev'
  }
  route: string
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeCodeObjectSurface(value: unknown): CodeObjectSurface {
  if (!isRecord(value)) return { ...DEFAULT_CODE_OBJECT_SURFACE }
  return {
    background: value.background === 'transparent' ? 'transparent' : 'surface',
    overflow: value.overflow === 'scroll' ? 'scroll' : 'clip'
  }
}

function pluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === CODE_OBJECT_PLUGIN_ID && entry.key === key)
      ?.value ?? null
  )
}

export function smylrTrustedWebAppPageId(route: string): string {
  const normalizedRoute = `/${route.split('/').filter(Boolean).join('/')}`
  if (normalizedRoute === '/practice-analytics') return 'analytics'
  return normalizedRoute.slice(1).replaceAll('/', '-') || 'home'
}

function smylrTrustedWebAppPluginData(
  codeObject: CodeObjectDocumentEnvelope
): SceneNode['pluginData'] {
  if (codeObject.component !== 'smylr-production-app') return []
  const route = codeObject.route
  if (typeof route !== 'string' || !route.startsWith('/')) return []
  return [
    {
      pluginId: SMYLR_PRODUCTION_PLUGIN_ID,
      key: 'kind',
      value: SMYLR_CODE_OBJECT_FRAME_KIND
    },
    {
      pluginId: SMYLR_PRODUCTION_PLUGIN_ID,
      key: 'pageId',
      value: smylrTrustedWebAppPageId(route)
    },
    { pluginId: SMYLR_PRODUCTION_PLUGIN_ID, key: 'route', value: route },
    { pluginId: SMYLR_PRODUCTION_PLUGIN_ID, key: 'state', value: 'current' }
  ]
}

export function createUserCodeObjectDocument<BoardPermission = unknown>(
  input: CreateUserCodeObjectDocumentInput<BoardPermission>
): CodeObjectDocument<'user-code', JsonRecord, BoardPermission> {
  return {
    boardPermissions: structuredClone(input.boardPermissions ?? []),
    component: 'user-code',
    definitionId: input.definitionId,
    name: input.name,
    props: structuredClone(input.props ?? {}),
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: input.source,
    state: structuredClone(input.state ?? {}),
    ...(input.surface ? { surface: normalizeCodeObjectSurface(input.surface) } : {})
  }
}

export function createSmylrTrustedWebAppDocument<BoardPermission = unknown>(input: {
  label: string
  route: string
  viewportPreset?: CodeObjectViewportPresetId
}): SmylrTrustedWebAppDocument<BoardPermission> {
  return {
    boardPermissions: [],
    component: 'smylr-production-app',
    definitionId: `smylr.production.${input.route.replace(/^\/+/, '').replaceAll('/', '.')}`,
    label: input.label,
    launch: {
      launcherId: 'smylr',
      startScript: 'npm run dev'
    },
    name: input.label,
    props: { route: input.route },
    route: input.route,
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: SMYLR_TRUSTED_WEB_APP_SOURCE,
    state: { view: 'live' },
    ...(input.viewportPreset ? { viewport: { preset: input.viewportPreset } } : {})
  }
}

export function isCodeObjectKind(node: SceneNode | null | undefined): node is SceneNode {
  return node?.type === 'FRAME' && pluginValue(node, 'kind') === CODE_OBJECT_KIND
}

export function parseCodeObjectDocument(
  node: SceneNode | null | undefined
): CodeObjectDocumentEnvelope | null {
  if (!isCodeObjectKind(node)) return null
  const raw = pluginValue(node, 'document')
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !isRecord(parsed) ||
      typeof parsed.component !== 'string' ||
      !parsed.component ||
      parsed.runtime !== 'openpencil-code' ||
      parsed.schemaVersion !== CODE_OBJECT_SCHEMA_VERSION ||
      !isRecord(parsed.state)
    ) {
      return null
    }
    return parsed as CodeObjectDocumentEnvelope
  } catch {
    return null
  }
}

export function codeObjectViewportPluginData(
  node: SceneNode,
  preset: CodeObjectViewportPresetId | null
): SceneNode['pluginData'] | null {
  const codeObject = parseCodeObjectDocument(node)
  if (!codeObject) return null
  const currentPreset = isRecord(codeObject.viewport) ? codeObject.viewport.preset : undefined
  if (
    (preset === null && codeObject.viewport === undefined) ||
    (preset !== null && isCodeObjectViewportPresetId(currentPreset) && currentPreset === preset)
  ) {
    return node.pluginData
  }
  const nextDocument: CodeObjectDocumentEnvelope = structuredClone(codeObject)
  if (preset) nextDocument.viewport = { preset }
  else delete nextDocument.viewport
  return serializeCodeObjectPluginData(node, nextDocument)
}

export function serializeCodeObjectPluginData(
  node: Pick<SceneNode, 'pluginData'>,
  codeObject: CodeObjectDocumentEnvelope
): SceneNode['pluginData'] {
  const smylrPluginData = smylrTrustedWebAppPluginData(codeObject)
  return [
    ...node.pluginData.filter(
      (entry) =>
        entry.pluginId !== CODE_OBJECT_PLUGIN_ID &&
        !(
          smylrPluginData.length > 0 &&
          entry.pluginId === SMYLR_PRODUCTION_PLUGIN_ID &&
          SMYLR_FRAME_METADATA_KEYS.has(entry.key)
        )
    ),
    ...smylrPluginData,
    { key: 'kind', pluginId: CODE_OBJECT_PLUGIN_ID, value: CODE_OBJECT_KIND },
    { key: 'document', pluginId: CODE_OBJECT_PLUGIN_ID, value: JSON.stringify(codeObject) }
  ]
}
