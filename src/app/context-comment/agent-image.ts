import { captureNarratedTraceDisplayEvidence } from '@/app/narrated-trace'

import { openAgentImageComment } from './state'

export type AgentImageAnnotationInput = {
  action?: 'follow-up' | 'steer'
  height: number
  imageUrl: string
  modelScope?: string
  threadId?: string
  width: number
}

type ImagePreviewSource = {
  decode?: () => Promise<void>
  naturalHeight: number
  naturalWidth: number
}

function readyImageSize(
  image: ImagePreviewSource | null
): { height: number; width: number } | null {
  const width = Math.floor(image?.naturalWidth ?? 0)
  const height = Math.floor(image?.naturalHeight ?? 0)
  return width > 0 && height > 0 ? { height, width } : null
}

export async function readImagePreviewSize(
  image: ImagePreviewSource | null,
  fallback?: { height: number; width: number }
): Promise<{ height: number; width: number }> {
  const fallbackSize =
    fallback && fallback.width > 0 && fallback.height > 0
      ? { height: Math.floor(fallback.height), width: Math.floor(fallback.width) }
      : null
  const immediate = readyImageSize(image)
  if (immediate) return immediate
  if (image?.decode) await image.decode().catch(() => undefined)
  const decoded = readyImageSize(image)
  if (decoded) return decoded
  if (fallbackSize) return fallbackSize
  throw new Error('The image preview is not ready yet.')
}

export async function openAgentImageAnnotation(input: AgentImageAnnotationInput): Promise<void> {
  const width = Math.floor(input.width)
  const height = Math.floor(input.height)
  if (width < 1 || height < 1) throw new Error('The image preview is not ready yet.')

  const bounds = { height, width, x: 0, y: 0 }
  const threadId = input.threadId?.trim()
  const capture = await captureNarratedTraceDisplayEvidence({
    annotation: {
      bounds,
      color: '#3b82f6',
      kind: 'focus',
      points: [],
      strokeWidth: 2
    },
    capturedAtMs: Date.now(),
    cropBounds: bounds,
    imageUrl: input.imageUrl,
    maxEdge: Math.max(width, height),
    preserveTransparency: true,
    sessionId: `agent-image-${threadId || globalThis.crypto.randomUUID()}`,
    sourceCropBounds: bounds
  })
  if (!capture) throw new Error('The image could not be prepared for annotation.')

  openAgentImageComment(
    capture,
    threadId
      ? {
          action: input.action ?? 'follow-up',
          kind: 'agent-conversation',
          modelScope: input.modelScope ?? `task:${threadId}`,
          threadId
        }
      : undefined,
    input.modelScope
  )
}
