import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask
} from 'pdfjs-dist'
// Vite's `?url` loader synthesizes this default string export at build time.
// oxlint-disable-next-line import/default
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { IS_BROWSER } from '@open-pencil/core/constants'

import type { ExtractedMediaImage } from '@/app/media-evidence/extraction'
import { canvasPngBlob } from '@/app/media-evidence/raster'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const PDF_PREVIEW_CSS_SCALE = 1.15
const PDF_PREVIEW_MAX_DIMENSION = 4096
const PDF_PREVIEW_MAX_PIXELS = 12_000_000
const PDF_EXTRACTION_MAX_DIMENSION = 1800
const PDF_EXTRACTION_MAX_PIXELS = 6_000_000
const PDF_SOURCE_IMAGE_MAX_PIXELS = 16_000_000

export type PdfPageImage = ExtractedMediaImage

function boundedScale(
  width: number,
  height: number,
  requestedScale: number,
  maxDimension: number,
  maxPixels: number
): number {
  const dimensionScale = maxDimension / Math.max(width, height)
  const pixelScale = Math.sqrt(maxPixels / (width * height))
  return Math.max(0.1, Math.min(requestedScale, dimensionScale, pixelScale))
}

export function startPdfDocumentLoad(bytes: Uint8Array): PDFDocumentLoadingTask {
  if (bytes.byteLength === 0) throw new Error('PDF source is empty')
  return getDocument({
    data: bytes.slice().buffer,
    maxImageSize: PDF_SOURCE_IMAGE_MAX_PIXELS,
    stopAtErrors: true,
    useWasm: false
  })
}

export async function loadPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return startPdfDocumentLoad(bytes).promise
}

export async function startPdfPageRender(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement
): Promise<RenderTask> {
  const page = await pdf.getPage(pageNumber)
  const original = page.getViewport({ scale: 1 })
  const deviceScale = IS_BROWSER ? Math.min(window.devicePixelRatio, 2) : 1
  const scale = boundedScale(
    original.width,
    original.height,
    PDF_PREVIEW_CSS_SCALE * deviceScale,
    PDF_PREVIEW_MAX_DIMENSION,
    PDF_PREVIEW_MAX_PIXELS
  )
  const viewport = page.getViewport({ scale })
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  return page.render({ canvas, viewport })
}

function pageFileName(sourceFileName: string, pageNumber: number): string {
  const baseName = sourceFileName.replace(/\.pdf$/i, '') || 'PDF'
  return `${baseName} - page ${pageNumber}.png`
}

export async function extractPdfPageImage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  sourceFileName: string
): Promise<PdfPageImage> {
  if (!IS_BROWSER) throw new TypeError('PDF page extraction requires a browser')
  const page = await pdf.getPage(pageNumber)
  const original = page.getViewport({ scale: 1 })
  const scale = boundedScale(
    original.width,
    original.height,
    2,
    PDF_EXTRACTION_MAX_DIMENSION,
    PDF_EXTRACTION_MAX_PIXELS
  )
  const viewport = page.getViewport({ scale })
  const canvas = window.document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport }).promise
  const blob = await canvasPngBlob(canvas)
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    fileName: pageFileName(sourceFileName, pageNumber),
    height: canvas.height,
    width: canvas.width
  }
}
