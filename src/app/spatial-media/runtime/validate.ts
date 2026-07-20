import type { SpatialAssetFormat } from '../types'

const GLB_MAGIC = 0x46546c67
const GLB_JSON_CHUNK = 0x4e4f534a
const MAX_GLTF_NODES = 10_000
const MAX_GLTF_PRIMITIVES = 20_000
const MAX_GLTF_TEXTURES = 256
const MAX_GLTF_POSITION_VALUES = 5_000_000
export const MAX_SPATIAL_TRIANGLES = 2_000_000

type GltfAccessor = { count?: unknown; type?: unknown }
type GltfBuffer = { uri?: unknown }
type GltfImage = { bufferView?: unknown; mimeType?: unknown; uri?: unknown }
type GltfMesh = { primitives?: unknown }
type GltfDocument = {
  accessors?: unknown
  asset?: { version?: unknown }
  buffers?: unknown
  images?: unknown
  meshes?: unknown
  nodes?: unknown
  textures?: unknown
}

export class SpatialSourceError extends Error {
  constructor(
    public readonly code:
      | 'empty-scene'
      | 'external-resource'
      | 'invalid-format'
      | 'resource-limit'
      | 'unsupported-extension',
    message: string
  ) {
    super(message)
    this.name = 'SpatialSourceError'
  }
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function allowedEmbeddedUri(uri: string): boolean {
  return /^(?:data:application\/(?:gltf-buffer|octet-stream);base64,|data:image\/(?:avif|jpeg|png|webp);base64,)/i.test(
    uri
  )
}

function decodeResourceUri(uri: string): string {
  try {
    return decodeURIComponent(uri)
  } catch {
    throw new SpatialSourceError('external-resource', `Resource URI "${uri}" is not valid UTF-8.`)
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export function normalizeSpatialResourceUri(uri: string): string {
  const decoded = decodeResourceUri(uri).replaceAll('\\', '/')
  if (
    decoded.length === 0 ||
    hasControlCharacter(decoded) ||
    decoded.startsWith('/') ||
    decoded.includes('?') ||
    decoded.includes('#') ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded)
  ) {
    throw new SpatialSourceError(
      'external-resource',
      `Resource URI "${uri}" is not a safe local relative path.`
    )
  }
  const segments = decoded.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    throw new SpatialSourceError(
      'external-resource',
      `Resource URI "${uri}" escapes the local model bundle.`
    )
  }
  return segments.join('/')
}

export function spatialResourceMimeType(uri: string): string {
  const extension = normalizeSpatialResourceUri(uri).split('.').at(-1)?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'avif') return 'image/avif'
  return 'application/octet-stream'
}

function validateExternalImageUri(uri: string): void {
  if (!/\.(?:avif|jpe?g|png|webp)$/i.test(uri)) {
    throw new SpatialSourceError(
      'unsupported-extension',
      `Local glTF image "${uri}" is not PNG, JPEG, WebP, or AVIF.`
    )
  }
}

function allowedImageMimeType(value: unknown): boolean {
  return typeof value === 'string' && /^image\/(?:avif|jpeg|png|webp)$/i.test(value)
}

function resourceUris(values: unknown, label: string, kind: 'buffer' | 'image'): string[] {
  const result: string[] = []
  for (const item of array(values)) {
    const resource = item as GltfBuffer | GltfImage
    const uri = resource.uri
    if (kind === 'image') {
      const image = resource as GltfImage
      if (image.mimeType !== undefined && !allowedImageMimeType(image.mimeType)) {
        throw new SpatialSourceError(
          'unsupported-extension',
          'glTF images must use PNG, JPEG, WebP, or AVIF data.'
        )
      }
      if (image.bufferView !== undefined && !allowedImageMimeType(image.mimeType)) {
        throw new SpatialSourceError(
          'unsupported-extension',
          'Buffer-backed glTF images must declare PNG, JPEG, WebP, or AVIF data.'
        )
      }
    }
    if (uri === undefined) continue
    if (typeof uri !== 'string') {
      throw new SpatialSourceError(
        'external-resource',
        `${label} must use embedded data or a safe local relative path.`
      )
    }
    if (allowedEmbeddedUri(uri)) continue
    const normalized = normalizeSpatialResourceUri(uri)
    if (kind === 'image') validateExternalImageUri(normalized)
    result.push(normalized)
  }
  return result
}

function inspectDocument(document: GltfDocument): string[] {
  if (typeof document.asset?.version !== 'string' || !document.asset.version.startsWith('2')) {
    throw new SpatialSourceError('invalid-format', 'Only glTF 2.x assets are supported.')
  }
  const nodes = array(document.nodes)
  const meshes = array(document.meshes) as GltfMesh[]
  const textures = array(document.textures)
  const primitiveCount = meshes.reduce((count, mesh) => count + array(mesh.primitives).length, 0)
  const positionValueCount = (array(document.accessors) as GltfAccessor[]).reduce(
    (count, accessor) =>
      accessor.type === 'VEC3' && typeof accessor.count === 'number'
        ? count + accessor.count
        : count,
    0
  )
  if (
    nodes.length > MAX_GLTF_NODES ||
    primitiveCount > MAX_GLTF_PRIMITIVES ||
    textures.length > MAX_GLTF_TEXTURES ||
    positionValueCount > MAX_GLTF_POSITION_VALUES
  ) {
    throw new SpatialSourceError(
      'resource-limit',
      'The asset exceeds the first viewer slice node, primitive, texture, or vertex guardrail.'
    )
  }
  return [
    ...resourceUris(document.buffers, 'glTF buffers', 'buffer'),
    ...resourceUris(document.images, 'glTF images', 'image')
  ]
}

function parseJson(text: string): GltfDocument {
  try {
    return JSON.parse(text) as GltfDocument
  } catch {
    throw new SpatialSourceError('invalid-format', 'The glTF JSON is not valid.')
  }
}

function glbJson(bytes: Uint8Array): GltfDocument {
  if (bytes.byteLength < 20) {
    throw new SpatialSourceError('invalid-format', 'The GLB header is incomplete.')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  const declaredLength = view.getUint32(8, true)
  const jsonLength = view.getUint32(12, true)
  const chunkType = view.getUint32(16, true)
  if (
    magic !== GLB_MAGIC ||
    version !== 2 ||
    declaredLength !== bytes.byteLength ||
    chunkType !== GLB_JSON_CHUNK ||
    20 + jsonLength > bytes.byteLength
  ) {
    throw new SpatialSourceError('invalid-format', 'The GLB container is not valid glTF 2.0.')
  }
  return parseJson(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim())
}

function validateGltfResources(document: GltfDocument, availableUris: readonly string[]): void {
  const available = new Set(availableUris.map((uri) => normalizeSpatialResourceUri(uri)))
  for (const uri of inspectDocument(document)) {
    if (!available.has(uri)) {
      throw new SpatialSourceError(
        'external-resource',
        `Local glTF resource "${uri}" was not included with the model.`
      )
    }
  }
}

function validateObj(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes)
  if (text.includes('\0')) {
    throw new SpatialSourceError('invalid-format', 'The OBJ source contains binary data.')
  }
  let vertices = 0
  let triangles = 0
  let objects = 0
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/^mtllib\s+/i.test(line)) {
      throw new SpatialSourceError(
        'unsupported-extension',
        'OBJ material-library files are not supported yet; import geometry-only OBJ source.'
      )
    }
    if (line.startsWith('v ')) vertices += 1
    else if (line.startsWith('o ') || line.startsWith('g ')) objects += 1
    else if (line.startsWith('f ')) {
      const corners = line.split(/\s+/).length - 1
      if (corners >= 3) triangles += corners - 2
    }
    if (vertices > MAX_GLTF_POSITION_VALUES || triangles > MAX_SPATIAL_TRIANGLES) {
      throw new SpatialSourceError(
        'resource-limit',
        'The OBJ exceeds the first viewer slice vertex or triangle guardrail.'
      )
    }
    if (objects > MAX_GLTF_NODES) {
      throw new SpatialSourceError(
        'resource-limit',
        'The OBJ exceeds the first viewer slice object guardrail.'
      )
    }
  }
  if (vertices === 0 || triangles === 0) {
    throw new SpatialSourceError('empty-scene', 'The OBJ contains no renderable mesh geometry.')
  }
  return text
}

function binaryStlTriangleCount(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 84) return null
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
  return 84 + count * 50 === bytes.byteLength ? count : null
}

function validateStl(bytes: Uint8Array): ArrayBuffer {
  const binaryTriangles = binaryStlTriangleCount(bytes)
  let triangles = binaryTriangles
  if (triangles === null) {
    const text = new TextDecoder().decode(bytes)
    if (!/^\s*solid(?:\s|$)/i.test(text) || !/\bendsolid\b/i.test(text)) {
      throw new SpatialSourceError('invalid-format', 'The STL is not valid binary or ASCII STL.')
    }
    triangles = text.match(/^\s*facet\s+normal\b/gim)?.length ?? 0
  }
  if (triangles === 0) {
    throw new SpatialSourceError('empty-scene', 'The STL contains no renderable triangles.')
  }
  if (triangles > MAX_SPATIAL_TRIANGLES) {
    throw new SpatialSourceError(
      'resource-limit',
      'The STL exceeds the first viewer slice triangle guardrail.'
    )
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function inspectGltfResourceUris(bytes: Uint8Array): string[] {
  return [...new Set(inspectDocument(parseJson(new TextDecoder().decode(bytes))))]
}

export function validateSpatialSource(
  bytes: Uint8Array,
  format: SpatialAssetFormat,
  availableResourceUris: readonly string[] = []
): string | ArrayBuffer {
  if (format === 'gltf') {
    const text = new TextDecoder().decode(bytes)
    validateGltfResources(parseJson(text), availableResourceUris)
    return text
  }
  if (format === 'glb') {
    validateGltfResources(glbJson(bytes), [])
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }
  if (format === 'obj') return validateObj(bytes)
  return validateStl(bytes)
}
