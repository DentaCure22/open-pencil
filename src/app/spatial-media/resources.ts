import {
  MAX_SPATIAL_BUNDLE_BYTES,
  MAX_SPATIAL_RESOURCE_FILES,
  MAX_SPATIAL_SOURCE_BYTES
} from './classify'
import { inspectGltfResourceUris, SpatialSourceError } from './runtime/validate'

export { spatialResourceMimeType } from './runtime/validate'

export type SpatialFileClaim = {
  claimed: File[]
  remaining: File[]
}

export type SpatialResolvedResourceFile = {
  file: File
  uri: string
}

function filePath(file: File): string {
  const relativePath = Reflect.get(file, 'webkitRelativePath')
  const relative = typeof relativePath === 'string' ? relativePath.trim() : ''
  return (relative || file.name).replaceAll('\\', '/').replace(/^\.\//, '')
}

function primaryDirectory(file: File): string {
  const path = filePath(file)
  const separator = path.lastIndexOf('/')
  return separator === -1 ? '' : path.slice(0, separator)
}

function expectedResourcePath(primary: File, uri: string): string {
  const directory = primaryDirectory(primary)
  return directory ? `${directory}/${uri}` : uri
}

function matchesResource(primary: File, uri: string, candidates: File[]): File | null {
  const expected = expectedResourcePath(primary, uri)
  const exact = candidates.filter((candidate) => filePath(candidate) === expected)
  if (exact.length === 1) return exact[0] ?? null
  if (exact.length > 1) return null
  const baseName = uri.split('/').at(-1)
  if (!baseName) return null
  const flat = candidates.filter((candidate) => candidate.name === baseName)
  return flat.length === 1 ? (flat[0] ?? null) : null
}

async function resourceUris(file: File): Promise<string[]> {
  if (!file.name.toLowerCase().endsWith('.gltf')) return []
  try {
    return inspectGltfResourceUris(new Uint8Array(await file.arrayBuffer()))
  } catch {
    return []
  }
}

export async function resolveSpatialResourceFiles(
  primary: File,
  candidates: File[]
): Promise<SpatialResolvedResourceFile[]> {
  const resolved: SpatialResolvedResourceFile[] = []
  for (const uri of await resourceUris(primary)) {
    const file = matchesResource(primary, uri, candidates)
    if (file) resolved.push({ file, uri })
  }
  return resolved
}

export async function claimSpatialMediaFiles(
  files: File[],
  isPrimary: (file: File) => boolean
): Promise<SpatialFileClaim> {
  const primaries = files.filter(isPrimary)
  const candidates = files.filter((file) => !isPrimary(file))
  const claimed = new Set<File>(primaries)
  for (const primary of primaries) {
    for (const resource of await resolveSpatialResourceFiles(primary, candidates)) {
      claimed.add(resource.file)
    }
  }
  return {
    claimed: files.filter((file) => claimed.has(file)),
    remaining: files.filter((file) => !claimed.has(file))
  }
}

export function validateSpatialBundleSize(
  primary: File,
  resources: SpatialResolvedResourceFile[]
): void {
  if (resources.length > MAX_SPATIAL_RESOURCE_FILES) {
    throw new SpatialSourceError(
      'resource-limit',
      `The local glTF bundle exceeds the ${MAX_SPATIAL_RESOURCE_FILES}-file resource guardrail.`
    )
  }
  if (resources.some((resource) => resource.file.size > MAX_SPATIAL_SOURCE_BYTES)) {
    throw new SpatialSourceError(
      'resource-limit',
      `A local glTF resource exceeds the ${MAX_SPATIAL_SOURCE_BYTES}-byte per-file guardrail.`
    )
  }
  const bytes = resources.reduce((total, resource) => total + resource.file.size, primary.size)
  if (bytes > MAX_SPATIAL_BUNDLE_BYTES) {
    throw new SpatialSourceError(
      'resource-limit',
      `The local glTF bundle exceeds the ${MAX_SPATIAL_BUNDLE_BYTES}-byte guardrail.`
    )
  }
}
