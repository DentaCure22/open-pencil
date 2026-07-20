import type { AnimationClip, Object3D } from 'three'

import type { SpatialAssetFormat, SpatialResourcePayload, SpatialRuntimeStats } from '../types'
import {
  MAX_SPATIAL_TRIANGLES,
  normalizeSpatialResourceUri,
  spatialResourceMimeType,
  SpatialSourceError,
  validateSpatialSource
} from './validate'

export type LoadedSpatialAsset = {
  animations: AnimationClip[]
  root: Object3D
  stats: SpatialRuntimeStats
}

function runtimeStats(root: Object3D, animations: AnimationClip[]): SpatialRuntimeStats {
  const geometries = new Set<string>()
  const materials = new Set<string>()
  let triangles = 0
  root.traverse((object) => {
    const candidate = object as Object3D & {
      geometry?: {
        attributes?: { position?: { count?: number } }
        index?: { count?: number }
        uuid?: string
      }
      material?: { uuid?: string } | Array<{ uuid?: string }>
    }
    if (candidate.geometry?.uuid) geometries.add(candidate.geometry.uuid)
    const materialList: Array<{ uuid?: string }> = []
    if (Array.isArray(candidate.material)) materialList.push(...candidate.material)
    else if (candidate.material) materialList.push(candidate.material)
    for (const material of materialList) if (material.uuid) materials.add(material.uuid)
    const indexCount = candidate.geometry?.index?.count
    const vertexCount = candidate.geometry?.attributes?.position?.count
    triangles += Math.floor((indexCount ?? vertexCount ?? 0) / 3)
  })
  if (triangles > MAX_SPATIAL_TRIANGLES) {
    throw new SpatialSourceError(
      'resource-limit',
      'The parsed model exceeds the first viewer slice triangle guardrail.'
    )
  }
  return {
    animations: animations.length,
    geometries: geometries.size,
    materials: materials.size,
    triangles
  }
}

async function loadGltf(
  data: string | ArrayBuffer,
  resources: SpatialResourcePayload[]
): Promise<{ animations: AnimationClip[]; root: Object3D }> {
  const [{ LoadingManager }, { GLTFLoader }] = await Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js')
  ])
  const manager = new LoadingManager()
  const byUri = new Map(resources.map((resource) => [resource.uri, resource]))
  const objectUrls = new Map<string, string>()
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url
    const uri = normalizeSpatialResourceUri(url)
    const resource = byUri.get(uri)
    if (!resource) {
      throw new SpatialSourceError(
        'external-resource',
        `Local glTF resource "${uri}" was not included with the model.`
      )
    }
    const current = objectUrls.get(uri)
    if (current) return current
    const objectUrl = URL.createObjectURL(
      new Blob([resource.bytes.slice().buffer], { type: spatialResourceMimeType(uri) })
    )
    objectUrls.set(uri, objectUrl)
    return objectUrl
  })
  try {
    const loaded = await new GLTFLoader(manager).parseAsync(data, '')
    return { animations: loaded.animations, root: loaded.scene }
  } finally {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url)
  }
}

async function loadObj(data: string): Promise<{ animations: AnimationClip[]; root: Object3D }> {
  const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js')
  return { animations: [], root: new OBJLoader().parse(data) }
}

async function loadStl(
  data: ArrayBuffer
): Promise<{ animations: AnimationClip[]; root: Object3D }> {
  const [three, { STLLoader }] = await Promise.all([
    import('three'),
    import('three/addons/loaders/STLLoader.js')
  ])
  const geometry = new STLLoader().parse(data) as ReturnType<
    InstanceType<typeof STLLoader>['parse']
  > & {
    alpha?: number
    hasColors?: boolean
  }
  const material = new three.MeshStandardMaterial({
    color: geometry.hasColors ? '#ffffff' : '#b9a8ef',
    metalness: 0.08,
    opacity: geometry.alpha ?? 1,
    roughness: 0.72,
    transparent: (geometry.alpha ?? 1) < 1,
    vertexColors: geometry.hasColors ?? false
  })
  return { animations: [], root: new three.Mesh(geometry, material) }
}

export async function loadSpatialAsset(
  bytes: Uint8Array,
  format: SpatialAssetFormat,
  resources: SpatialResourcePayload[] = []
): Promise<LoadedSpatialAsset> {
  const data = validateSpatialSource(
    bytes,
    format,
    resources.map((resource) => resource.uri)
  )
  let loaded: { animations: AnimationClip[]; root: Object3D }
  if (format === 'gltf' || format === 'glb') loaded = await loadGltf(data, resources)
  else if (format === 'obj') loaded = await loadObj(data as string)
  else loaded = await loadStl(data as ArrayBuffer)
  const stats = runtimeStats(loaded.root, loaded.animations)
  if (stats.geometries === 0 || stats.triangles === 0) {
    throw new SpatialSourceError(
      'empty-scene',
      'The 3D source contains no renderable mesh geometry.'
    )
  }
  return { animations: loaded.animations, root: loaded.root, stats }
}
