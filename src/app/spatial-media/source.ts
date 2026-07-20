import { readContentSource } from '@open-pencil/core/io'
import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

import type {
  SpatialAssetFormat,
  SpatialCameraState,
  SpatialMediaSource,
  SpatialResourceReference,
  ThreeExperienceMetadata
} from './types'

const PLUGIN_ID = 'open-pencil'
const KEY_PREFIX = 'spatial-media/'
const KIND_KEY = `${KEY_PREFIX}kind`
const CAMERA_KEY = `${KEY_PREFIX}camera`
const HOME_CAMERA_KEY = `${KEY_PREFIX}home-camera`
const PREVIEW_KEY = `${KEY_PREFIX}preview-asset`
const RESOURCES_KEY = `${KEY_PREFIX}resources`
const THREE_EXPERIENCE_KEY = `${KEY_PREFIX}three-experience`

type StoredThreeExperienceMetadata = Omit<Partial<ThreeExperienceMetadata>, 'permission'> & {
  permission?: Partial<ThreeExperienceMetadata['permission']>
}

function pluginValue(node: Pick<SceneNode, 'pluginData'>, key: string): string | null {
  for (const item of node.pluginData) {
    if (item.pluginId === PLUGIN_ID && item.key === key) return item.value
  }
  return null
}

function entry(key: string, value: string): PluginDataEntry {
  return { key, pluginId: PLUGIN_ID, value }
}

function validTuple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  )
}

function parseCamera(value: string | null): SpatialCameraState | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<SpatialCameraState>
    return validTuple(parsed.position) && validTuple(parsed.target)
      ? { position: parsed.position, target: parsed.target }
      : null
  } catch {
    return null
  }
}

function parseResources(value: string | null): SpatialResourceReference[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is SpatialResourceReference =>
        typeof item === 'object' &&
        item !== null &&
        typeof Reflect.get(item, 'assetHash') === 'string' &&
        typeof Reflect.get(item, 'fileName') === 'string' &&
        typeof Reflect.get(item, 'mimeType') === 'string' &&
        typeof Reflect.get(item, 'uri') === 'string'
    )
  } catch {
    return []
  }
}

export function spatialMediaPluginData(
  existing: PluginDataEntry[],
  input: {
    camera?: SpatialCameraState | null
    format?: SpatialAssetFormat
    homeCamera?: SpatialCameraState | null
    previewHash?: string | null
    resources?: SpatialResourceReference[]
  }
): PluginDataEntry[] {
  const next = existing.filter(
    (item) => item.pluginId !== PLUGIN_ID || !item.key.startsWith(KEY_PREFIX)
  )
  if (input.format) next.push(entry(KIND_KEY, input.format))
  if (input.camera) next.push(entry(CAMERA_KEY, JSON.stringify(input.camera)))
  if (input.homeCamera) next.push(entry(HOME_CAMERA_KEY, JSON.stringify(input.homeCamera)))
  if (input.previewHash) next.push(entry(PREVIEW_KEY, input.previewHash))
  if (input.resources?.length) next.push(entry(RESOURCES_KEY, JSON.stringify(input.resources)))
  return next
}

export function spatialMediaSource(node: Pick<SceneNode, 'pluginData'>): SpatialMediaSource | null {
  const format = pluginValue(node, KIND_KEY)
  if (format !== 'glb' && format !== 'gltf' && format !== 'obj' && format !== 'stl') return null
  const metadata = readContentSource(node)
  if (!metadata) return null
  const assetHash = assetHashFromReference(metadata.source)
  if (!assetHash) return null
  return {
    assetHash,
    camera: parseCamera(pluginValue(node, CAMERA_KEY)),
    fileName: metadata.fileName ?? `Untitled.${format}`,
    format,
    homeCamera: parseCamera(pluginValue(node, HOME_CAMERA_KEY)),
    metadata,
    previewHash: pluginValue(node, PREVIEW_KEY),
    resources: parseResources(pluginValue(node, RESOURCES_KEY))
  }
}

export function threeExperiencePluginData(
  existing: PluginDataEntry[],
  metadata: ThreeExperienceMetadata
): PluginDataEntry[] {
  return [
    ...existing.filter((item) => item.pluginId !== PLUGIN_ID || item.key !== THREE_EXPERIENCE_KEY),
    entry(THREE_EXPERIENCE_KEY, JSON.stringify(metadata))
  ]
}

export function threeExperienceMetadata(
  node: Pick<SceneNode, 'pluginData'>
): ThreeExperienceMetadata | null {
  const value = pluginValue(node, THREE_EXPERIENCE_KEY)
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as StoredThreeExperienceMetadata
    if (
      parsed.permission?.execution !== 'explicit-user-start' ||
      parsed.permission.hostAccess !== 'opaque-origin' ||
      parsed.permission.network !== 'none' ||
      parsed.permission.sourceCode !== 'sandboxed' ||
      typeof parsed.runtimeIntegrity !== 'string' ||
      typeof parsed.runtimeUrl !== 'string' ||
      typeof parsed.sourceHash !== 'string' ||
      typeof parsed.sourceId !== 'string' ||
      !Number.isSafeInteger(parsed.sourceRevision) ||
      Number(parsed.sourceRevision) < 1
    ) {
      return null
    }
    return parsed as ThreeExperienceMetadata
  } catch {
    return null
  }
}
