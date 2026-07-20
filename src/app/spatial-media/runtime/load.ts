import type { AnimationClip, Object3D } from 'three'

import type { SpatialAssetFormat, SpatialRuntimeStats } from '../types'
import { SpatialSourceError, validateSpatialSource } from './validate'

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
  return {
    animations: animations.length,
    geometries: geometries.size,
    materials: materials.size,
    triangles
  }
}

export async function loadSpatialAsset(
  bytes: Uint8Array,
  format: SpatialAssetFormat
): Promise<LoadedSpatialAsset> {
  const data = validateSpatialSource(bytes, format)
  const [{ LoadingManager }, { GLTFLoader }] = await Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js')
  ])
  const manager = new LoadingManager()
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url
    throw new SpatialSourceError(
      'external-resource',
      'Network and companion-file URLs are blocked in the source-backed viewer.'
    )
  })
  const loaded = await new GLTFLoader(manager).parseAsync(data, '')
  const stats = runtimeStats(loaded.scene, loaded.animations)
  if (stats.geometries === 0 || stats.triangles === 0) {
    throw new SpatialSourceError('empty-scene', 'The glTF contains no renderable mesh geometry.')
  }
  return { animations: loaded.animations, root: loaded.scene, stats }
}
