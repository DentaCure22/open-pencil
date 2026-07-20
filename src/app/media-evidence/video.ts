import type { ExtractedMediaImage } from '@/app/media-evidence/extraction'
import { canvasPngBlob } from '@/app/media-evidence/raster'

const VIDEO_FRAME_MAX_DIMENSION = 1920
const VIDEO_FRAME_MAX_PIXELS = 4_000_000

export type CapturedVideoFrame = {
  image: ExtractedMediaImage
  timeMs: number
}

function frameScale(width: number, height: number): number {
  const dimensionScale = VIDEO_FRAME_MAX_DIMENSION / Math.max(width, height)
  const pixelScale = Math.sqrt(VIDEO_FRAME_MAX_PIXELS / (width * height))
  return Math.min(1, dimensionScale, pixelScale)
}

function videoFrameFileName(sourceFileName: string, timeMs: number): string {
  const baseName = sourceFileName.replace(/\.[^.]+$/, '') || 'Video'
  const totalSeconds = Math.floor(timeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${baseName} - ${minutes}m${seconds}s.png`
}

export async function captureVideoFrame(
  video: HTMLVideoElement,
  sourceFileName: string
): Promise<CapturedVideoFrame> {
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    throw new Error('Video frame is not ready')
  }
  const scale = frameScale(video.videoWidth, video.videoHeight)
  const canvas = window.document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.floor(video.videoHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Video frame canvas is unavailable')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const blob = await canvasPngBlob(canvas)
  const timeMs = Number.isFinite(video.currentTime)
    ? Math.max(0, Math.round(video.currentTime * 1000))
    : 0
  return {
    image: {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      fileName: videoFrameFileName(sourceFileName, timeMs),
      height: canvas.height,
      width: canvas.width
    },
    timeMs
  }
}
