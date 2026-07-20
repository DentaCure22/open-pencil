import type { SpatialAssetFormat } from '../types'

const GLB_MAGIC = 0x46546c67
const GLB_JSON_CHUNK = 0x4e4f534a
const MAX_GLTF_NODES = 10_000
const MAX_GLTF_PRIMITIVES = 20_000
const MAX_GLTF_TEXTURES = 256
const MAX_GLTF_POSITION_VALUES = 5_000_000

type GltfAccessor = { count?: unknown; type?: unknown }
type GltfBuffer = { uri?: unknown }
type GltfImage = { uri?: unknown }
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

function validateUris(values: unknown, label: string) {
  for (const item of array(values)) {
    const uri = (item as GltfBuffer | GltfImage).uri
    if (uri === undefined) continue
    if (typeof uri !== 'string' || !allowedEmbeddedUri(uri)) {
      throw new SpatialSourceError(
        'external-resource',
        `${label} must be embedded; network and companion-file URLs are blocked.`
      )
    }
  }
}

function validateDocument(document: GltfDocument): void {
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
  validateUris(document.buffers, 'glTF buffers')
  validateUris(document.images, 'glTF images')
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

export function validateSpatialSource(
  bytes: Uint8Array,
  format: SpatialAssetFormat
): string | ArrayBuffer {
  if (format === 'gltf') {
    const text = new TextDecoder().decode(bytes)
    validateDocument(parseJson(text))
    return text
  }
  validateDocument(glbJson(bytes))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
