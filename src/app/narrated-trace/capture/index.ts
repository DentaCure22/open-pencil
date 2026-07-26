import type { Rect } from '@open-pencil/scene-graph/primitives'

import { readCacheValue, writeCacheValue } from '@/app/cache'

import type {
  NarratedTraceEvidence,
  NarratedTraceEvidenceAnnotation,
  NarratedTraceEvidenceOmission,
  NarratedTraceTarget
} from '../types'
import { captureHasMeaningfulPixels, compositeLayer, createCaptureLayer } from './pixels'

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
  return globalThis.crypto.randomUUID()
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
}

function blobImageUrl(blob: Blob) {
  return URL.createObjectURL(blob)
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

function sourceMatchesTarget(
  source: HTMLCanvasElement | HTMLImageElement,
  sourceRegion: Rect,
  target?: NarratedTraceTarget
) {
  if (!target?.frameId) return false
  const ownerFrameId = source.closest<HTMLElement>('[data-code-object-id]')?.dataset.codeObjectId
  if (ownerFrameId === target.frameId) return true
  if (!(source instanceof HTMLImageElement) || !target.bounds) return false
  const overlapWidth = Math.max(
    0,
    Math.min(sourceRegion.x + sourceRegion.width, target.bounds.x + target.bounds.width) -
      Math.max(sourceRegion.x, target.bounds.x)
  )
  const overlapHeight = Math.max(
    0,
    Math.min(sourceRegion.y + sourceRegion.height, target.bounds.y + target.bounds.height) -
      Math.max(sourceRegion.y, target.bounds.y)
  )
  const overlapArea = overlapWidth * overlapHeight
  const smallerArea = Math.min(
    sourceRegion.width * sourceRegion.height,
    target.bounds.width * target.bounds.height
  )
  return smallerArea > 0 && overlapArea / smallerArea >= 0.8
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

function drawRasterSources(
  context: CanvasRenderingContext2D,
  area: HTMLElement,
  areaRect: DOMRect,
  cropBounds: Rect,
  scale: number,
  target?: NarratedTraceTarget
) {
  let drewSource = false
  let drewTargetSource = false
  let targetSourceMeaningful = false
  const sources = area.querySelectorAll<HTMLCanvasElement | HTMLImageElement>('canvas, img')
  for (const source of sources) {
    if (
      source.closest('[data-narrated-trace-overlay="true"]') ||
      source.closest('[data-narrated-trace-capture-omit="true"]')
    ) {
      continue
    }
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
      const layer = createCaptureLayer(context.canvas.width, context.canvas.height)
      if (!layer.context) continue
      layer.context.drawImage(
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
      if (!compositeLayer(context, layer.canvas, layer.context)) continue
      drewSource = true
      if (sourceMatchesTarget(source, sourceRegion, target)) {
        drewTargetSource = true
        targetSourceMeaningful ||= captureHasMeaningfulPixels(
          layer.context,
          layer.canvas.width,
          layer.canvas.height
        )
      }
    } catch (error) {
      console.warn('Narrated Trace raster source could not be drawn:', error)
    }
  }
  return { drewSource, drewTargetSource, targetSourceMeaningful }
}

async function drawDomSurface(
  context: CanvasRenderingContext2D,
  input: NarratedTraceCaptureInput,
  width: number,
  height: number
) {
  const { default: html2canvas } = await import('html2canvas')
  const rendered = await html2canvas(input.area, {
    backgroundColor: null,
    ignoreElements: (element) =>
      element instanceof HTMLElement &&
      (element.dataset.narratedTraceOverlay === 'true' ||
        element.dataset.narratedTraceCaptureOmit === 'true' ||
        element instanceof HTMLCanvasElement ||
        element instanceof HTMLIFrameElement),
    logging: false,
    scale: 1,
    useCORS: true
  })
  const layer = createCaptureLayer(width, height)
  if (!layer.context) return false
  layer.context.drawImage(
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
  return compositeLayer(context, layer.canvas, layer.context)
}

function drawEvidenceAnnotation(
  context: CanvasRenderingContext2D,
  annotation: NarratedTraceEvidenceAnnotation,
  cropBounds: Rect,
  scale: number
) {
  if (annotation.points.length === 0 || !intersects(annotation.bounds, cropBounds)) return false
  context.save()
  context.strokeStyle = annotation.color
  context.lineWidth = Math.max(1, annotation.strokeWidth * scale)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  if (annotation.points.length === 1) {
    const point = annotation.points[0]
    context.arc(
      (point.x - cropBounds.x) * scale,
      (point.y - cropBounds.y) * scale,
      Math.max(3, annotation.strokeWidth * scale * 2),
      0,
      Math.PI * 2
    )
  }
  for (const [index, point] of annotation.points.entries()) {
    if (annotation.points.length === 1) break
    const x = (point.x - cropBounds.x) * scale
    const y = (point.y - cropBounds.y) * scale
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.stroke()
  context.restore()
  return true
}

function fillTransparentPixels(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save()
  context.globalCompositeOperation = 'destination-over'
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.restore()
}

async function drawDomSurfaceSafely(
  context: CanvasRenderingContext2D,
  input: NarratedTraceCaptureInput,
  width: number,
  height: number,
  behindPixels = false
) {
  if (behindPixels) {
    context.save()
    context.globalCompositeOperation = 'destination-over'
  }
  try {
    return await drawDomSurface(context, input, width, height)
  } catch (error) {
    console.warn('Narrated Trace DOM capture failed; using pixel surfaces:', error)
    return false
  } finally {
    if (behindPixels) context.restore()
  }
}

function drawOmissionsSafely(
  context: CanvasRenderingContext2D,
  omissions: NarratedTraceEvidenceOmission[],
  cropBounds: Rect,
  scale: number
) {
  try {
    drawOmissions(context, omissions, cropBounds, scale)
    return true
  } catch (error) {
    console.warn('Narrated Trace privacy redaction failed:', error)
    return false
  }
}

async function persistEvidenceBlob(cacheKey: string, blob: Blob) {
  transientEvidenceImages.set(cacheKey, blobImageUrl(blob))
  try {
    await writeCacheValue(cacheKey, blob)
  } catch (error) {
    console.warn('Narrated Trace evidence could not be persisted:', error)
  }
}

async function composeCaptureSources(
  context: CanvasRenderingContext2D,
  input: NarratedTraceCaptureInput,
  areaRect: DOMRect,
  width: number,
  height: number,
  scale: number
): Promise<NarratedTraceEvidence['source'] | null> {
  const drewDom = await drawDomSurfaceSafely(context, input, width, height)
  const { drewSource: drewRaster, targetSourceMeaningful } = drawRasterSources(
    context,
    input.area,
    areaRect,
    input.cropBounds,
    scale,
    input.target
  )
  const hasPixels = drewDom || drewRaster
  const targetHasPixels = !input.target?.frameId || targetSourceMeaningful
  if (!hasPixels || !targetHasPixels || !captureHasMeaningfulPixels(context, width, height)) {
    return null
  }
  return input.target?.frameId && targetSourceMeaningful ? 'frame-snapshot' : 'canvas'
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}

function canvasBackdropColor(area: HTMLElement) {
  let element: HTMLElement | null = area
  for (let depth = 0; element && depth < 8; depth += 1) {
    const color = getComputedStyle(element).backgroundColor
    if (
      color &&
      color !== 'transparent' &&
      color !== 'rgba(0, 0, 0, 0)' &&
      !color.endsWith('/ 0)')
    ) {
      return color
    }
    element = element.parentElement
  }
  return getComputedStyle(area).getPropertyValue('--color-canvas').trim() || null
}

function drawCanvasLocationFallback(
  context: CanvasRenderingContext2D,
  input: NarratedTraceCaptureInput,
  width: number,
  height: number
) {
  if (!input.target?.stableId.startsWith('canvas:')) return false
  const background = canvasBackdropColor(input.area)
  if (!background) return false
  context.save()
  context.fillStyle = background
  context.fillRect(0, 0, width, height)
  context.restore()
  return true
}

export async function captureNarratedTraceEvidence(
  input: NarratedTraceCaptureInput
): Promise<NarratedTraceEvidence | null> {
  await nextPaint()
  const edge = Math.max(input.cropBounds.width, input.cropBounds.height, 1)
  const scale = Math.min(1, MAX_CAPTURE_EDGE / edge)
  const width = Math.max(1, Math.round(input.cropBounds.width * scale))
  const height = Math.max(1, Math.round(input.cropBounds.height * scale))
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const context = output.getContext('2d')
  if (!context) return null

  const areaRect = input.area.getBoundingClientRect()
  const omissions = omissionsForCapture(input.area, areaRect, input.cropBounds)
  let source = await composeCaptureSources(context, input, areaRect, width, height, scale)
  if (!source) {
    await nextPaint()
    context.clearRect(0, 0, width, height)
    source = await composeCaptureSources(context, input, areaRect, width, height, scale)
  }
  if (!source && drawCanvasLocationFallback(context, input, width, height)) source = 'canvas'
  if (!source) return null

  const annotationBaked = drawEvidenceAnnotation(context, input.annotation, input.cropBounds, scale)

  if (!drawOmissionsSafely(context, omissions, input.cropBounds, scale)) return null
  fillTransparentPixels(context, width, height)

  const evidenceId = createEvidenceId()
  const cacheKey = `${EVIDENCE_CACHE_PREFIX}${encodeURIComponent(input.sessionId)}/${evidenceId}`
  const blob = await canvasBlob(output)
  if (!blob) return null
  await persistEvidenceBlob(cacheKey, blob)

  return {
    annotation: input.annotation,
    annotationBaked,
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
