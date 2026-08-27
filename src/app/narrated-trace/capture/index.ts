import { rectIntersectionRatio, rectsIntersect } from '@open-pencil/scene-graph/geometry'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  persistLocalWorkspaceTraceEvidence,
  readLocalWorkspaceTraceEvidence
} from '@/app/workspace-document/local-authority/client'

import type {
  NarratedTraceEvidence,
  NarratedTraceEvidenceAnnotation,
  NarratedTraceEvidenceOmission,
  NarratedTraceTarget
} from '../types'
import { drawDomSurfaceSafely, regionForElement } from './dom-surface'
import { captureHasMeaningfulPixels, compositeLayer, createCaptureLayer } from './pixels'

const MAX_CAPTURE_EDGE = 420
const transientEvidenceImages = new Map<string, string>()

export type NarratedTraceCaptureOmissionProvider = (
  area: HTMLElement
) => NarratedTraceEvidenceOmission[]

export type NarratedTraceCaptureInput = {
  annotation: NarratedTraceEvidenceAnnotation
  annotationBaked?: boolean
  area: HTMLElement
  capturedAtMs: number
  cropBounds: Rect
  maxEdge?: number
  sessionId: string
  target?: NarratedTraceTarget
}

export type NarratedTraceDisplayCaptureInput = {
  annotation: NarratedTraceEvidenceAnnotation
  annotationBaked?: boolean
  capturedAtMs: number
  cropBounds: Rect
  imageUrl: string
  maxEdge?: number
  preserveTransparency?: boolean
  sessionId: string
  source?: NarratedTraceEvidence['source']
  sourceCropBounds: Rect
  target?: NarratedTraceTarget
}

export type NarratedTraceSnapshotInput = Pick<
  NarratedTraceCaptureInput,
  'area' | 'cropBounds' | 'maxEdge' | 'target'
> & {
  allowCanvasLocationFallback?: boolean
  domOverlayIds?: readonly string[]
  minimumEdge?: number
}

export type NarratedTraceSnapshot = {
  blob: Blob
  height: number
  omissions: NarratedTraceEvidenceOmission[]
  source: NarratedTraceEvidence['source']
  width: number
}

type PreparedNarratedTraceCapture = Omit<NarratedTraceSnapshot, 'blob'> & {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  scale: number
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

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image), { once: true })
    image.addEventListener(
      'error',
      () => reject(new Error('The shared screen image is unavailable.')),
      {
        once: true
      }
    )
    image.src = url
  })
}

type RasterCaptureSource = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement
function sourceMatchesTarget(
  source: RasterCaptureSource,
  sourceRegion: Rect,
  target?: NarratedTraceTarget
) {
  if (!target?.frameId) return false
  const ownerFrameId = source.closest<HTMLElement>('[data-code-object-id]')?.dataset.codeObjectId
  if (ownerFrameId === target.frameId) return true
  if (!(source instanceof HTMLImageElement) || !target.bounds) return false
  return rectIntersectionRatio(sourceRegion, target.bounds) >= 0.8
}

function rasterSourceIsReady(source: RasterCaptureSource) {
  if (source instanceof HTMLImageElement) return source.complete && source.naturalWidth > 0
  if (source instanceof HTMLVideoElement) {
    return source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  }
  return true
}

function rasterSourceSize(source: RasterCaptureSource) {
  if (source instanceof HTMLCanvasElement) return { height: source.height, width: source.width }
  if (source instanceof HTMLImageElement) {
    return { height: source.naturalHeight, width: source.naturalWidth }
  }
  return { height: source.videoHeight, width: source.videoWidth }
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
    rectsIntersect(omission.bounds, cropBounds)
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
  const sources = area.querySelectorAll<RasterCaptureSource>('canvas, img, video')
  for (const source of sources) {
    if (
      source.closest('[data-narrated-trace-overlay="true"]') ||
      source.closest('[data-narrated-trace-capture-omit="true"]')
    ) {
      continue
    }
    if (!rasterSourceIsReady(source)) continue
    const sourceRegion = regionForElement(source, areaRect)
    if (!rectsIntersect(sourceRegion, cropBounds)) continue
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
    const { height: intrinsicHeight, width: intrinsicWidth } = rasterSourceSize(source)
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

function drawEvidenceAnnotation(
  context: CanvasRenderingContext2D,
  annotation: NarratedTraceEvidenceAnnotation,
  cropBounds: Rect,
  scale: number
) {
  if (annotation.points.length === 0 || !rectsIntersect(annotation.bounds, cropBounds)) return false
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

function canvasHasTransparentPixels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  const pixels = context.getImageData(0, 0, width, height).data
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return true
  }
  return false
}

function roundedRect(bounds: Rect): Rect {
  return {
    height: Math.round(bounds.height),
    width: Math.round(bounds.width),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y)
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

async function persistEvidenceBlob(evidenceId: string, sessionId: string, blob: Blob) {
  await persistLocalWorkspaceTraceEvidence({
    evidenceBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    evidenceId,
    mimeType: 'image/png',
    sessionId
  })
  transientEvidenceImages.set(evidenceId, blobImageUrl(blob))
}

async function composeCaptureSources(
  context: CanvasRenderingContext2D,
  input: NarratedTraceSnapshotInput,
  areaRect: DOMRect,
  width: number,
  height: number,
  scale: number
): Promise<NarratedTraceEvidence['source'] | null> {
  const drewDom = await drawDomSurfaceSafely(context, input, areaRect, width, height)
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
  input: NarratedTraceSnapshotInput,
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

async function prepareNarratedTraceCapture(
  input: NarratedTraceSnapshotInput
): Promise<PreparedNarratedTraceCapture | null> {
  await nextPaint()
  const edge = Math.max(input.cropBounds.width, input.cropBounds.height, 1)
  const maxEdge = Math.min(2_048, Math.max(1, input.maxEdge ?? MAX_CAPTURE_EDGE))
  const minimumEdge = Math.max(1, input.minimumEdge ?? 1)
  const outputEdge = Math.min(maxEdge, Math.max(edge, minimumEdge))
  const scale = outputEdge / edge
  const width = Math.max(1, Math.round(input.cropBounds.width * scale))
  const height = Math.max(1, Math.round(input.cropBounds.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null

  const areaRect = input.area.getBoundingClientRect()
  const omissions = omissionsForCapture(input.area, areaRect, input.cropBounds)
  let source = await composeCaptureSources(context, input, areaRect, width, height, scale)
  if (!source) {
    await nextPaint()
    context.clearRect(0, 0, width, height)
    source = await composeCaptureSources(context, input, areaRect, width, height, scale)
  }
  if (
    !source &&
    input.allowCanvasLocationFallback !== false &&
    drawCanvasLocationFallback(context, input, width, height)
  ) {
    source = 'canvas'
  }
  if (!source) return null

  return { canvas, context, height, omissions, scale, source, width }
}

export async function captureNarratedTraceSnapshot(
  input: NarratedTraceSnapshotInput
): Promise<NarratedTraceSnapshot | null> {
  const capture = await prepareNarratedTraceCapture(input)
  if (!capture) return null
  if (!drawOmissionsSafely(capture.context, capture.omissions, input.cropBounds, capture.scale)) {
    return null
  }
  fillTransparentPixels(capture.context, capture.width, capture.height)
  const blob = await canvasBlob(capture.canvas)
  if (!blob) return null
  return {
    blob,
    height: capture.height,
    omissions: capture.omissions,
    source: capture.source,
    width: capture.width
  }
}

export async function captureNarratedTraceEvidence(
  input: NarratedTraceCaptureInput
): Promise<NarratedTraceEvidence | null> {
  const capture = await prepareNarratedTraceCapture(input)
  if (!capture) return null
  const annotationBaked =
    input.annotationBaked === true ||
    drawEvidenceAnnotation(capture.context, input.annotation, input.cropBounds, capture.scale)

  if (!drawOmissionsSafely(capture.context, capture.omissions, input.cropBounds, capture.scale)) {
    return null
  }
  fillTransparentPixels(capture.context, capture.width, capture.height)

  const evidenceId = createEvidenceId()
  const blob = await canvasBlob(capture.canvas)
  if (!blob) return null
  await persistEvidenceBlob(evidenceId, input.sessionId, blob)

  return {
    annotation: input.annotation,
    annotationBaked,
    capturedAtMs: input.capturedAtMs,
    cropBounds: roundedRect(input.cropBounds),
    evidenceId,
    height: capture.height,
    mimeType: 'image/png',
    omissions: capture.omissions,
    source: capture.source,
    targetPath: input.target?.path,
    targetStableId: input.target?.stableId,
    width: capture.width
  }
}

export async function captureNarratedTraceDisplayEvidence(
  input: NarratedTraceDisplayCaptureInput
): Promise<NarratedTraceEvidence | null> {
  const image = await loadImage(input.imageUrl)
  const sourceLeft = Math.min(image.naturalWidth, Math.max(0, input.sourceCropBounds.x))
  const sourceTop = Math.min(image.naturalHeight, Math.max(0, input.sourceCropBounds.y))
  const sourceRight = Math.min(
    image.naturalWidth,
    Math.max(sourceLeft, input.sourceCropBounds.x + input.sourceCropBounds.width)
  )
  const sourceBottom = Math.min(
    image.naturalHeight,
    Math.max(sourceTop, input.sourceCropBounds.y + input.sourceCropBounds.height)
  )
  const sourceWidth = sourceRight - sourceLeft
  const sourceHeight = sourceBottom - sourceTop
  if (sourceWidth < 1 || sourceHeight < 1) return null

  const edge = Math.max(sourceWidth, sourceHeight, 1)
  const maxEdge = Math.min(2_048, Math.max(1, input.maxEdge ?? MAX_CAPTURE_EDGE))
  const scale = Math.min(1, maxEdge / edge)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const context = output.getContext('2d')
  if (!context) return null
  context.drawImage(image, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, width, height)
  const sourceHasTransparency = canvasHasTransparentPixels(context, width, height)
  if (!input.preserveTransparency) fillTransparentPixels(context, width, height)

  const evidenceId = createEvidenceId()
  const blob = await canvasBlob(output)
  if (!blob) return null
  await persistEvidenceBlob(evidenceId, input.sessionId, blob)
  return {
    annotation: input.annotation,
    annotationBaked: input.annotationBaked ?? false,
    capturedAtMs: input.capturedAtMs,
    cropBounds: roundedRect(input.cropBounds),
    evidenceId,
    height,
    mimeType: 'image/png',
    omissions: [],
    source: input.source ?? 'display-capture',
    sourceHasTransparency,
    targetPath: input.target?.path,
    targetStableId: input.target?.stableId,
    width
  }
}

export async function readNarratedTraceEvidenceImage(evidence: NarratedTraceEvidence) {
  const transient = transientEvidenceImages.get(evidence.evidenceId)
  if (transient) return transient
  const persisted = await readLocalWorkspaceTraceEvidence(evidence.evidenceId)
  if (!persisted) return null
  const blob = new Blob([base64ToBytes(persisted.evidenceBase64)], { type: persisted.mimeType })
  const imageUrl = blobImageUrl(blob)
  transientEvidenceImages.set(evidence.evidenceId, imageUrl)
  return imageUrl
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 32_768
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export async function readNarratedTraceEvidenceImageData(evidence: NarratedTraceEvidence) {
  const persisted = await readLocalWorkspaceTraceEvidence(evidence.evidenceId)
  return persisted ? { base64: persisted.evidenceBase64, mimeType: persisted.mimeType } : null
}
