import type { SceneNode } from '@open-pencil/scene-graph'

import { isCodeObjectViewportPresetId, type CodeObjectViewportPresetId } from './viewport'

export const CODE_OBJECT_PLUGIN_ID = 'openpencil-code-object'
export const CODE_OBJECT_KIND = 'code-object'
export const CODE_OBJECT_SCHEMA_VERSION = 1 as const
export const SMYLR_PRODUCTION_PLUGIN_ID = 'smylr-production'
export const SMYLR_CODE_OBJECT_FRAME_KIND = 'smylr-code-object-frame'
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

const SMYLR_FRAME_METADATA_KEYS = new Set(['kind', 'pageId', 'route', 'state'])

export type CodeObjectDocument<
  Component extends string = string,
  State extends JsonRecord = JsonRecord,
  BoardPermission = unknown,
  Connection = unknown
> = {
  boardPermissions: BoardPermission[]
  component: Component
  connections: Connection[]
  definitionId: string
  name: string
  props: JsonRecord
  runtime: 'openpencil-code'
  schemaVersion: typeof CODE_OBJECT_SCHEMA_VERSION
  source: string
  state: State
  viewport?: {
    preset: CodeObjectViewportPresetId
  }
}

export type CodeObjectDocumentEnvelope = JsonRecord & {
  component: string
  runtime: 'openpencil-code'
  schemaVersion: typeof CODE_OBJECT_SCHEMA_VERSION
  state: JsonRecord
}

export type CreateUserCodeObjectDocumentInput<BoardPermission = unknown, Connection = unknown> = {
  boardPermissions?: BoardPermission[]
  connections?: Connection[]
  definitionId: string
  name: string
  props?: JsonRecord
  source: string
  state?: JsonRecord
}

export type SmylrTrustedWebAppDocument<
  BoardPermission = unknown,
  Connection = unknown
> = CodeObjectDocument<'smylr-production-app', { view: 'live' }, BoardPermission, Connection> & {
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

export function createUserCodeObjectDocument<BoardPermission = unknown, Connection = unknown>(
  input: CreateUserCodeObjectDocumentInput<BoardPermission, Connection>
): CodeObjectDocument<'user-code', JsonRecord, BoardPermission, Connection> {
  return {
    boardPermissions: structuredClone(input.boardPermissions ?? []),
    component: 'user-code',
    connections: structuredClone(input.connections ?? []),
    definitionId: input.definitionId,
    name: input.name,
    props: structuredClone(input.props ?? {}),
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: input.source,
    state: structuredClone(input.state ?? {})
  }
}

export function createSmylrTrustedWebAppDocument<
  BoardPermission = unknown,
  Connection = unknown
>(input: {
  label: string
  route: string
  viewportPreset?: CodeObjectViewportPresetId
}): SmylrTrustedWebAppDocument<BoardPermission, Connection> {
  return {
    boardPermissions: [],
    component: 'smylr-production-app',
    connections: [],
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

export function parseCodeObjectDocument(
  node: SceneNode | null | undefined
): CodeObjectDocumentEnvelope | null {
  if (node?.type !== 'FRAME' || pluginValue(node, 'kind') !== CODE_OBJECT_KIND) return null
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
  const document = parseCodeObjectDocument(node)
  if (!document) return null
  const currentPreset = isRecord(document.viewport) ? document.viewport.preset : undefined
  if (
    (preset === null && document.viewport === undefined) ||
    (preset !== null && isCodeObjectViewportPresetId(currentPreset) && currentPreset === preset)
  ) {
    return node.pluginData
  }
  const nextDocument: CodeObjectDocumentEnvelope = structuredClone(document)
  if (preset) nextDocument.viewport = { preset }
  else delete nextDocument.viewport
  return serializeCodeObjectPluginData(node, nextDocument)
}

export function serializeCodeObjectPluginData(
  node: SceneNode,
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
