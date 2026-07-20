import type { MarkdownImageAsset, MarkdownImportOptions } from './types'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const FETCH_TIMEOUT_MS = 10_000

export interface MarkdownImageResolution {
  asset: MarkdownImageAsset | null
  error?: string
}

function imageMimeType(value: string | null): string | null {
  const mimeType = value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return mimeType.startsWith('image/') ? mimeType : null
}

function decodeDataImage(source: string): MarkdownImageAsset | null {
  const separator = source.indexOf(',')
  if (!source.startsWith('data:') || separator === -1) return null
  const metadata = source.slice(5, separator)
  const mimeType = imageMimeType(metadata)
  if (!mimeType) return null

  const encoded = source.slice(separator + 1)
  const data = metadata.split(';').includes('base64')
    ? Uint8Array.fromBase64(encoded)
    : new TextEncoder().encode(decodeURIComponent(encoded))
  if (data.byteLength > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 20 MB limit')
  return { data, mimeType }
}

async function fetchRemoteImage(source: string): Promise<MarkdownImageAsset> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(source, {
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`Image request failed with status ${response.status}`)
    const mimeType = imageMimeType(response.headers.get('content-type'))
    if (!mimeType) throw new Error('Image response has an unsupported media type')

    const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds the 20 MB limit')
    }
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 20 MB limit')
    return { data, mimeType }
  } finally {
    clearTimeout(timeout)
  }
}

async function defaultResolveImage(source: string): Promise<MarkdownImageAsset | null> {
  if (source.startsWith('data:')) return decodeDataImage(source)
  if (/^https?:\/\//i.test(source)) return fetchRemoteImage(source)
  return null
}

export async function resolveMarkdownImage(
  source: string,
  resolver: MarkdownImportOptions['resolveImage']
): Promise<MarkdownImageResolution> {
  try {
    const asset = await (resolver ? resolver(source) : defaultResolveImage(source))
    if (!asset) {
      return {
        asset: null,
        error:
          /^https?:\/\//i.test(source) || source.startsWith('data:')
            ? 'Image could not be loaded'
            : 'Relative image source retained without an available file resolver'
      }
    }
    if (!imageMimeType(asset.mimeType)) {
      return { asset: null, error: 'Image resolver returned an unsupported media type' }
    }
    if (asset.data.byteLength > MAX_IMAGE_BYTES) {
      return { asset: null, error: 'Image exceeds the 20 MB limit' }
    }
    return { asset }
  } catch (error) {
    return {
      asset: null,
      error: error instanceof Error ? error.message : 'Image could not be loaded'
    }
  }
}
