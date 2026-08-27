import type html2canvasType from 'html2canvas'

import { rectsIntersect } from '@open-pencil/scene-graph/geometry'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { compositeLayer, createCaptureLayer } from './pixels'

type NarratedTraceDomSurfaceInput = {
  area: HTMLElement
  cropBounds: Rect
  domOverlayIds?: readonly string[]
}

export function regionForElement(element: Element, areaRect: DOMRect): Rect {
  const rect = element.getBoundingClientRect()
  return {
    height: rect.height,
    width: rect.width,
    x: rect.left - areaRect.left,
    y: rect.top - areaRect.top
  }
}

type Html2Canvas = typeof html2canvasType

async function rasterizeDomOverlay(
  html2canvas: Html2Canvas,
  source: HTMLElement,
  options: Parameters<Html2Canvas>[1]
) {
  const width = Math.max(1, source.offsetWidth)
  const height = Math.max(1, source.offsetHeight)
  const host = document.createElement('div')
  Object.assign(host.style, {
    height: `${String(height)}px`,
    left: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    width: `${String(width)}px`,
    zIndex: '-2147483648'
  })
  const clone = source.cloneNode(true) as HTMLElement
  clone.style.height = `${String(height)}px`
  clone.style.transform = 'none'
  clone.style.width = `${String(width)}px`
  host.append(clone)
  document.body.append(host)
  try {
    return await html2canvas(clone, { ...options, height, width })
  } finally {
    host.remove()
  }
}

async function drawDomSurface(
  context: CanvasRenderingContext2D,
  input: NarratedTraceDomSurfaceInput,
  areaRect: DOMRect,
  width: number,
  height: number
) {
  const { default: html2canvas } = await import('html2canvas')
  const captureOptions = {
    backgroundColor: null,
    ignoreElements: (element: Element) =>
      element instanceof HTMLElement &&
      (element.dataset.narratedTraceOverlay === 'true' ||
        element.dataset.narratedTraceCaptureOmit === 'true' ||
        element instanceof HTMLCanvasElement ||
        element instanceof HTMLIFrameElement),
    logging: false,
    scale: 1,
    useCORS: true
  } as const
  const layer = createCaptureLayer(width, height)
  if (!layer.context) return false
  const overlayIds = new Set(input.domOverlayIds)
  if (overlayIds.size === 0) {
    try {
      const rendered = await html2canvas(input.area, captureOptions)
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
    } catch (error) {
      console.warn('Narrated Trace Board DOM surface could not be drawn:', error)
    }
  }
  if (overlayIds.size > 0) {
    const overlays = [...input.area.querySelectorAll<HTMLElement>('[data-code-object-id]')].filter(
      (element) => {
        const id = element.dataset.codeObjectId
        return Boolean(id && overlayIds.has(id))
      }
    )
    for (const overlay of overlays) {
      const surface = overlay.querySelector<HTMLElement>('[data-code-object-root]') ?? overlay
      const sourceRegion = regionForElement(surface, areaRect)
      if (!rectsIntersect(sourceRegion, input.cropBounds)) continue
      let overlayRaster: HTMLCanvasElement
      try {
        overlayRaster = await rasterizeDomOverlay(html2canvas, surface, captureOptions)
      } catch (error) {
        console.warn(
          `Narrated Trace overlay "${overlay.dataset.codeObjectId ?? ''}" failed:`,
          error
        )
        continue
      }
      const left = Math.max(sourceRegion.x, input.cropBounds.x)
      const top = Math.max(sourceRegion.y, input.cropBounds.y)
      const right = Math.min(
        sourceRegion.x + sourceRegion.width,
        input.cropBounds.x + input.cropBounds.width
      )
      const bottom = Math.min(
        sourceRegion.y + sourceRegion.height,
        input.cropBounds.y + input.cropBounds.height
      )
      const intersectionWidth = right - left
      const intersectionHeight = bottom - top
      if (intersectionWidth <= 0 || intersectionHeight <= 0) continue
      layer.context.drawImage(
        overlayRaster,
        ((left - sourceRegion.x) / sourceRegion.width) * overlayRaster.width,
        ((top - sourceRegion.y) / sourceRegion.height) * overlayRaster.height,
        (intersectionWidth / sourceRegion.width) * overlayRaster.width,
        (intersectionHeight / sourceRegion.height) * overlayRaster.height,
        (left - input.cropBounds.x) * (width / input.cropBounds.width),
        (top - input.cropBounds.y) * (height / input.cropBounds.height),
        intersectionWidth * (width / input.cropBounds.width),
        intersectionHeight * (height / input.cropBounds.height)
      )
    }
  }
  return compositeLayer(context, layer.canvas, layer.context)
}

export async function drawDomSurfaceSafely(
  context: CanvasRenderingContext2D,
  input: NarratedTraceDomSurfaceInput,
  areaRect: DOMRect,
  width: number,
  height: number,
  behindPixels = false
) {
  if (behindPixels) {
    context.save()
    context.globalCompositeOperation = 'destination-over'
  }
  try {
    return await drawDomSurface(context, input, areaRect, width, height)
  } catch (error) {
    console.warn('Narrated Trace DOM capture failed; using pixel surfaces:', error)
    return false
  } finally {
    if (behindPixels) context.restore()
  }
}
