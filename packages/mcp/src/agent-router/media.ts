export const AGENT_MEDIA_ROUTE = '/agent-router/v1/pi/media'

const MEDIA_MIME_TYPES = {
  gif: 'image/gif',
  jpg: 'image/jpeg',
  mp4: 'video/mp4',
  ogv: 'video/ogg',
  png: 'image/png',
  webm: 'video/webm',
  webp: 'image/webp'
} as const

export function agentMediaFileName(value: string): string | null {
  return /^[a-f0-9]{64}\.(?:gif|jpg|mp4|ogv|png|webm|webp)$/.test(value) ? value : null
}

export function agentMediaMimeType(fileName: string): string | null {
  const extension = fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
  return extension && extension in MEDIA_MIME_TYPES
    ? MEDIA_MIME_TYPES[extension as keyof typeof MEDIA_MIME_TYPES]
    : null
}
