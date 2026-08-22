import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentConversationAttachmentPart } from '#mcp/agent-router/contracts'

const MAX_ATTACHMENT_IMAGES = 10
const MAX_CONVERSATION_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_DISPLAY_ATTACHMENTS = 5
const VISION_IMAGE_EXTENSIONS = new Set(['gif', 'jpeg', 'jpg', 'png', 'webp'])
const VISION_IMAGE_MIME_TYPES: Partial<Record<string, string>> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function attachmentPath(authorityRoot: string, value: unknown): string | null {
  if (typeof value !== 'string') return null
  const attachmentRoot = path.resolve(authorityRoot, 'agent-attachments')
  const resolved = path.resolve(value)
  return resolved.startsWith(`${attachmentRoot}${path.sep}`) ? resolved : null
}

function attachmentName(value: unknown): string {
  if (typeof value !== 'string') return 'Attachment'
  return (path.basename(value.replaceAll('\\', '/')) || 'Attachment').slice(0, 255)
}

function attachmentMediaType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalized) ? normalized : undefined
}

function visionImageMimeType(name: string, mediaType?: string): string | null {
  if (mediaType && isVisionImage(name, mediaType)) return mediaType
  const extension = path.extname(name).slice(1).toLowerCase()
  return VISION_IMAGE_MIME_TYPES[extension] ?? null
}

export function isVisionImage(name: string, mimeType = ''): boolean {
  const normalizedMimeType = mimeType.toLowerCase()
  if (
    normalizedMimeType === 'image/gif' ||
    normalizedMimeType === 'image/jpeg' ||
    normalizedMimeType === 'image/png' ||
    normalizedMimeType === 'image/webp'
  ) {
    return true
  }
  const extension = path.extname(name).slice(1).toLowerCase()
  return VISION_IMAGE_EXTENSIONS.has(extension)
}

export function resolveAgentAttachmentImagePaths(authorityRoot: string, value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const attachmentRoot = path.resolve(authorityRoot, 'agent-attachments')
  const prefix = `${attachmentRoot}${path.sep}`
  const resolved: string[] = []
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue
    const imagePath = path.resolve(candidate)
    if (!imagePath.startsWith(prefix) || !isVisionImage(imagePath)) continue
    if (!resolved.includes(imagePath)) resolved.push(imagePath)
    if (resolved.length === MAX_ATTACHMENT_IMAGES) break
  }
  return resolved
}

export async function resolveAgentConversationAttachments(
  authorityRoot: string,
  value: unknown
): Promise<AgentConversationAttachmentPart[]> {
  if (!Array.isArray(value)) return []
  const resolved: AgentConversationAttachmentPart[] = []
  for (const candidate of value.slice(0, MAX_DISPLAY_ATTACHMENTS)) {
    if (!isRecord(candidate)) continue
    const filePath = attachmentPath(authorityRoot, candidate.path)
    if (!filePath) continue
    const fileStat = await lstat(filePath).catch(() => null)
    if (!fileStat?.isFile()) continue
    const name = attachmentName(candidate.name)
    const mediaType = attachmentMediaType(candidate.type)
    const imageMimeType = visionImageMimeType(name, mediaType)
    if (imageMimeType && fileStat.size <= MAX_CONVERSATION_IMAGE_BYTES) {
      const data = await readFile(filePath).catch(() => null)
      if (data) {
        resolved.push({
          alt: name,
          type: 'image',
          url: `data:${imageMimeType};base64,${data.toString('base64')}`
        })
        continue
      }
    }
    resolved.push({
      ...(mediaType ? { mediaType } : {}),
      name,
      size: fileStat.size,
      type: 'attachment'
    })
  }
  return resolved
}
