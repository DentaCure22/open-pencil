import type { Rect } from '@open-pencil/scene-graph/primitives'

import { readCacheValue, writeCacheValue } from '@/app/cache'
import { liveInspectorDocument } from '@/app/smylr-live-inspector/session'

import type {
  NarratedTraceEvidence,
  NarratedTraceEvidenceAnnotation,
  NarratedTraceEvidenceOmission,
  NarratedTraceTarget
} from './types'

const MAX_CAPTURE_EDGE = 420
const EVIDENCE_CACHE_PREFIX = 'narrated-trace/evidence/'
const transientEvidenceImages = new Map<string, string>()

export type NarratedTraceCaptureOmissionProvider = (
  area: HTMLElement
) => NarratedTraceEvidenceOmission[]

export type NarratedTraceCaptureInput = {
  annotation: NarratedTraceEvidenceAnnotation
  area: HTMLElement
  capturedAtMs: number
  cropBounds: Rect
  sessionId: string
  target?: NarratedTraceTarget
}

let captureOmissionProvider: NarratedTraceCaptureOmissionProvider | null = null

export function setNarratedTraceCaptureOmissionProvider(
  provider: NarratedTraceCaptureOmissionProvider | null
) {
  captureOmissionProvider = provider
}

function createEvidenceId() {
  return globalThis.crypto?.randomUUID?.() ?? `evidence-${Date.now()}`
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
}

function blobImageUrl(blob: Blob) {
  return URL.createObjectURL(blob)
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Capture image could not be loaded'))
    image.src = dataUrl
  })
}

function intersects(first: Rect, second: Rect) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  )
}

function regionForElement(element: Element, areaRect: DOMRect): Rect {
  const rect = element.getBoundingClientRect()
  return {
    height: rect.height,
    width: rect.width,
    x: rect.left - areaRect.left,
    y: rect.top - areaRect.top
  }
}

function defaultOmissions(area: HTMLElement, areaRect: DOMRect) {
  return [...area.querySelectorAll<HTMLElement>('[data-narrated-trace-capture-omit="true"]')].map(
    (element) => ({
      bounds: regionForElement(element, areaRect),
      reason: element.dataset.narratedTraceCaptureReason || 'Marked private'
    })
  )
}

function omissionsForCapture(area: HTMLElement, areaRect: DOMRect, cropBounds: Rect) {
  const supplied = captureOmissionProvider?.(area) ?? []
  return [...defaultOmissions(area, areaRect), ...supplied].filter((omission) =>
    intersects(omission.bounds, cropBounds)
  )
}

function drawOmissions(
  context: CanvasRenderingContext2D,
  omissions: NarratedTraceEvidenceOmission[],
  cropBounds: Rect,
  scale: number
) {
  for (const omission of omissions) {
    const left = Math.max(omission.bounds.x, cropBounds.x)
    const top = Math.max(omission.bounds.y, cropBounds.y)
    const right = Math.min(
      omission.bounds.x + omission.bounds.width,
      cropBounds.x + cropBounds.width
    )
    const bottom = Math.min(
      omission.bounds.y + omission.bounds.height,
      cropBounds.y + cropBounds.height
    )
    if (right <= left || bottom <= top) continue
    context.fillStyle = '#111827'
    context.fillRect(
      (left - cropBounds.x) * scale,
      (top - cropBounds.y) * scale,
      (right - left) * scale,
      (bottom - top) * scale
    )
  }
}

async function drawLiveFrame(
  context: CanvasRenderingContext2D,
  area: HTMLElement,
  areaRect: DOMRect,
  cropBounds: Rect,
  scale: number,
  target?: NarratedTraceTarget
) {
  const pageFace = liveInspectorDocument.value?.pageFace
  if (!pageFace?.dataUrl) return false
  const centerX = cropBounds.x + cropBounds.width / 2
  const centerY = cropBounds.y + cropBounds.height / 2
  const targetFrame = target?.frameId
    ? area.querySelector<HTMLIFrameElement>(
        `iframe[data-live-frame-id="${CSS.escape(target.frameId)}"]`
      )
    : null
  const iframe =
    targetFrame ??
    [...area.querySelectorAll<HTMLIFrameElement>('iframe')].find((candidate) => {
      const frame = regionForElement(candidate, areaRect)
      return (
        centerX >= frame.x &&
        centerX <= frame.x + frame.width &&
        centerY >= frame.y &&
        centerY <= frame.y + frame.height
      )
    })
  if (!iframe) return false

  const frame = regionForElement(iframe, areaRect)
  const intersection: Rect = {
    x: Math.max(cropBounds.x, frame.x),
    y: Math.max(cropBounds.y, frame.y),
    width: Math.max(
      0,
      Math.min(cropBounds.x + cropBounds.width, frame.x + frame.width) -
        Math.max(cropBounds.x, frame.x)
    ),
    height: Math.max(
      0,
      Math.min(cropBounds.y + cropBounds.height, frame.y + frame.height) -
        Math.max(cropBounds.y, frame.y)
    )
  }
  if (intersection.width === 0 || intersection.height === 0) return false

  const image = await loadImage(pageFace.dataUrl)
  const sourceScaleX = pageFace.width / Math.max(frame.width, 1)
  const sourceScaleY = pageFace.height / Math.max(frame.height, 1)
  context.drawImage(
    image,
    (intersection.x - frame.x) * sourceScaleX,
    (intersection.y - frame.y) * sourceScaleY,
    intersection.width * sourceScaleX,
    intersection.height * sourceScaleY,
    (intersection.x - cropBounds.x) * scale,
    (intersection.y - cropBounds.y) * scale,
    intersection.width * scale,
    intersection.height * scale
  )
  return true
}

function drawRasterFallback(
  context: CanvasRenderingContext2D,
  area: HTMLElement,
  areaRect: DOMRect,
  cropBounds: Rect,
  scale: number
) {
  let drewSource = false
  const sources = [
    ...area.querySelectorAll<HTMLCanvasElement>('canvas'),
    ...area.querySelectorAll<HTMLImageElement>('img')
  ]
  for (const source of sources) {
    if (source instanceof HTMLImageElement && (!source.complete || source.naturalWidth === 0)) {
      continue
    }
    const sourceRegion = regionForElement(source, areaRect)
    if (!intersects(sourceRegion, cropBounds)) continue
    const intersection: Rect = {
      height: Math.max(
        0,
        Math.min(cropBounds.y + cropBounds.height, sourceRegion.y + sourceRegion.height) -
          Math.max(cropBounds.y, sourceRegion.y)
      ),
      width: Math.max(
        0,
        Math.min(cropBounds.x + cropBounds.width, sourceRegion.x + sourceRegion.width) -
          Math.max(cropBounds.x, sourceRegion.x)
      ),
      x: Math.max(cropBounds.x, sourceRegion.x),
      y: Math.max(cropBounds.y, sourceRegion.y)
    }
    if (intersection.width === 0 || intersection.height === 0) continue
    const intrinsicWidth = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth
    const intrinsicHeight =
      source instanceof HTMLCanvasElement ? source.height : source.naturalHeight
    try {
      context.drawImage(
        source,
        ((intersection.x - sourceRegion.x) / Math.max(sourceRegion.width, 1)) * intrinsicWidth,
        ((intersection.y - sourceRegion.y) / Math.max(sourceRegion.height, 1)) * intrinsicHeight,
        (intersection.width / Math.max(sourceRegion.width, 1)) * intrinsicWidth,
        (intersection.height / Math.max(sourceRegion.height, 1)) * intrinsicHeight,
        (intersection.x - cropBounds.x) * scale,
        (intersection.y - cropBounds.y) * scale,
        intersection.width * scale,
        intersection.height * scale
      )
      drewSource = true
    } catch (error) {
      console.warn('Narrated Trace raster source could not be drawn:', error)
    }
  }
  return drewSource
}

export async function captureNarratedTraceEvidence(
  input: NarratedTraceCaptureInput
): Promise<NarratedTraceEvidence | null> {
  const edge = Math.max(input.cropBounds.width, input.cropBounds.height, 1)
  const scale = Math.min(1, MAX_CAPTURE_EDGE / edge)
  const width = Math.max(1, Math.round(input.cropBounds.width * scale))
  const height = Math.max(1, Math.round(input.cropBounds.height * scale))
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const context = output.getContext('2d')
  if (!context) return null
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)

  const areaRect = input.area.getBoundingClientRect()
  const omissions = omissionsForCapture(input.area, areaRect, input.cropBounds)
  let source: NarratedTraceEvidence['source'] = 'canvas'
  let drewLiveFrame = false
  try {
    drewLiveFrame = await drawLiveFrame(
      context,
      input.area,
      areaRect,
      input.cropBounds,
      scale,
      input.target
    )
  } catch (error) {
    console.warn('Narrated Trace live-frame capture failed; using the canvas fallback:', error)
  }

  if (drewLiveFrame) {
    source = 'live-frame'
  } else {
    try {
      const { default: html2canvas } = await import('html2canvas')
      const rendered = await html2canvas(input.area, {
        backgroundColor: null,
        ignoreElements: (element) =>
          element instanceof HTMLElement &&
          (element.dataset.narratedTraceOverlay === 'true' ||
            element.dataset.narratedTraceCaptureOmit === 'true'),
        logging: false,
        scale: 1,
        useCORS: true
      })
      context.drawImage(
        rendered,
        input.cropBounds.x,
        input.cropBounds.y,
        input.cropBounds.width,
        input.cropBounds.height,
        0,
        0,
        width,
        height
      )
    } catch (error) {
      if (!drawRasterFallback(context, input.area, areaRect, input.cropBounds, scale)) {
        console.warn('Narrated Trace canvas capture failed:', error)
        return null
      }
    }
  }

  try {
    drawOmissions(context, omissions, input.cropBounds, scale)
  } catch (error) {
    console.warn('Narrated Trace privacy redaction failed:', error)
    return null
  }

  const evidenceId = createEvidenceId()
  const cacheKey = `${EVIDENCE_CACHE_PREFIX}${encodeURIComponent(input.sessionId)}/${evidenceId}`
  const blob = await canvasBlob(output)
  if (!blob) return null
  transientEvidenceImages.set(cacheKey, blobImageUrl(blob))
  try {
    await writeCacheValue(cacheKey, blob)
  } catch (error) {
    console.warn('Narrated Trace evidence could not be persisted:', error)
  }

  return {
    annotation: input.annotation,
    cacheKey,
    capturedAtMs: input.capturedAtMs,
    cropBounds: {
      height: Math.round(input.cropBounds.height),
      width: Math.round(input.cropBounds.width),
      x: Math.round(input.cropBounds.x),
      y: Math.round(input.cropBounds.y)
    },
    evidenceId,
    height,
    mimeType: 'image/png',
    omissions,
    source,
    targetPath: input.target?.path,
    targetStableId: input.target?.stableId,
    width
  }
}

export async function readNarratedTraceEvidenceImage(evidence: NarratedTraceEvidence) {
  const transient = transientEvidenceImages.get(evidence.cacheKey)
  if (transient) return transient
  const persisted = await readCacheValue<unknown>(evidence.cacheKey)
  if (persisted instanceof Blob) {
    const imageUrl = blobImageUrl(persisted)
    transientEvidenceImages.set(evidence.cacheKey, imageUrl)
    return imageUrl
  }
  return typeof persisted === 'string' ? persisted : null
}
