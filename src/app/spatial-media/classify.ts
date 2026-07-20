import type {
  DeferredMeshFormat,
  SpatialFileClassification,
  SpatialViewerClassification
} from './types'

export const MAX_SPATIAL_SOURCE_BYTES = 64 * 1024 * 1024

const VIEWER_EXTENSIONS = new Map<string, SpatialViewerClassification>([
  [
    'glb',
    {
      disposition: 'spatial-viewer',
      format: 'glb',
      kind: 'mesh-asset',
      label: 'glTF binary asset'
    }
  ],
  [
    'gltf',
    {
      disposition: 'spatial-viewer',
      format: 'gltf',
      kind: 'mesh-asset',
      label: 'Self-contained glTF asset'
    }
  ]
])

const DEFERRED_MESH_EXTENSIONS = new Map<string, DeferredMeshFormat>([
  ['obj', 'obj'],
  ['stl', 'stl']
])

function extension(fileName: string): string {
  return fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? ''
}

function threeExperienceFormat(fileName: string) {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.three.html')) return 'three-html' as const
  if (lower.endsWith('.three.js') || lower.endsWith('.three.mjs')) return 'three-js' as const
  if (lower.endsWith('.three.json')) return 'three-json' as const
  return null
}

export function classifySpatialFile(
  file: Pick<File, 'name' | 'size' | 'type'>
): SpatialFileClassification {
  if (file.size > MAX_SPATIAL_SOURCE_BYTES) {
    return {
      disposition: 'reject',
      kind: 'oversize',
      label: '3D source exceeds the viewer guardrail',
      reason: `The first viewer slice accepts at most ${MAX_SPATIAL_SOURCE_BYTES} bytes per source.`
    }
  }

  const experienceFormat = threeExperienceFormat(file.name)
  if (experienceFormat) {
    return {
      disposition: 'three-experience-adapter',
      format: experienceFormat,
      kind: 'three-experience',
      label: 'Source-backed Three.js experience',
      reason:
        'Executable experience source requires the explicit HTML-board sandbox adapter and user-start permission.'
    }
  }

  const fileExtension = extension(file.name)
  const viewer = VIEWER_EXTENSIONS.get(fileExtension)
  if (viewer) return viewer

  const meshFormat = DEFERRED_MESH_EXTENSIONS.get(fileExtension)
  if (meshFormat) {
    return {
      disposition: 'generic-source',
      format: meshFormat,
      kind: 'mesh-source',
      label: `${meshFormat.toUpperCase()} mesh source`,
      reason:
        'This first slice keeps the source but does not enable the older text mesh loader without a dedicated performance fixture.'
    }
  }

  return { disposition: 'not-spatial', kind: 'unknown', label: 'Not a spatial source' }
}
