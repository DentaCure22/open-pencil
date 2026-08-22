const BYTE_MARKER = '__openpencil_uint8array_v1'

type EncodedAuthorityValue =
  | boolean
  | number
  | string
  | null
  | EncodedAuthorityValue[]
  | { [key: string]: EncodedAuthorityValue }

type EncodedAuthorityRecord = {
  [key: string]: unknown
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 32_768
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function encodeLocalWorkspaceDocument(value: unknown): EncodedAuthorityValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) {
    return { [BYTE_MARKER]: bytesToBase64(value) }
  }
  if (value instanceof ArrayBuffer) {
    return { [BYTE_MARKER]: bytesToBase64(new Uint8Array(value)) }
  }
  if (Array.isArray(value)) {
    return value.map((entry) => (entry === undefined ? null : encodeLocalWorkspaceDocument(entry)))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, encodeLocalWorkspaceDocument(entry)])
    )
  }
  throw new TypeError(`Unsupported workspace document value: ${typeof value}`)
}

export function stringifyLocalWorkspaceAuthorityValue(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry instanceof Uint8Array) {
      return { [BYTE_MARKER]: bytesToBase64(entry) }
    }
    if (entry instanceof ArrayBuffer) {
      return { [BYTE_MARKER]: bytesToBase64(new Uint8Array(entry)) }
    }
    return entry
  })
}

export function decodeLocalWorkspaceDocument(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(decodeLocalWorkspaceDocument)
  if (!value || typeof value !== 'object') {
    throw new TypeError('Workspace authority returned an unsupported document value')
  }
  const record = value as EncodedAuthorityRecord
  if (Object.keys(record).length === 1 && typeof record[BYTE_MARKER] === 'string') {
    return base64ToBytes(record[BYTE_MARKER])
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, decodeLocalWorkspaceDocument(entry)])
  )
}
