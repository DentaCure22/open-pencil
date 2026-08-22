import { readFileSync, statSync } from 'node:fs'

export const MAX_IMAGE_BASE64_LENGTH = 3 * 1024 * 1024

function imageMimeType(path: string): string | null {
  const extension = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  return null
}

export function imagePreviewFromPath(
  path: string,
  alt: string
): { alt: string; url: string } | null {
  const mimeType = imageMimeType(path)
  if (!mimeType) return null
  try {
    const size = statSync(path).size
    if (Math.ceil(size / 3) * 4 > MAX_IMAGE_BASE64_LENGTH) return null
    return {
      alt,
      url: `data:${mimeType};base64,${readFileSync(path).toString('base64')}`
    }
  } catch {
    return null
  }
}
