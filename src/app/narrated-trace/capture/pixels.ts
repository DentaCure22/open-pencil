const MAX_CAPTURE_PIXEL_SAMPLES = 20_000
const NEAR_WHITE_CHANNEL = 248

export function createCaptureLayer(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return { canvas, context: canvas.getContext('2d') }
}

function sampledPixels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  onPixel: (red: number, green: number, blue: number, alpha: number) => void
) {
  const pixels = context.getImageData(0, 0, width, height).data
  const pixelCount = Math.max(1, width * height)
  const step = Math.max(1, Math.floor(pixelCount / MAX_CAPTURE_PIXEL_SAMPLES))
  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const index = pixel * 4
    onPixel(
      pixels[index] ?? 0,
      pixels[index + 1] ?? 0,
      pixels[index + 2] ?? 0,
      pixels[index + 3] ?? 0
    )
  }
}

function layerHasPixels(context: CanvasRenderingContext2D, width: number, height: number) {
  let opaquePixels = 0
  try {
    sampledPixels(context, width, height, (_red, _green, _blue, alpha) => {
      if (alpha > 8) opaquePixels += 1
    })
  } catch {
    return false
  }
  return opaquePixels > 0
}

export function captureHasMeaningfulPixels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  let opaquePixels = 0
  let nonWhitePixels = 0
  try {
    sampledPixels(context, width, height, (red, green, blue, alpha) => {
      if (alpha <= 8) return
      opaquePixels += 1
      if (red < NEAR_WHITE_CHANNEL || green < NEAR_WHITE_CHANNEL || blue < NEAR_WHITE_CHANNEL) {
        nonWhitePixels += 1
      }
    })
  } catch {
    return false
  }
  if (opaquePixels === 0) return false
  return nonWhitePixels >= Math.min(12, opaquePixels)
}

export function compositeLayer(
  destination: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  layerContext: CanvasRenderingContext2D
) {
  if (!layerHasPixels(layerContext, layer.width, layer.height)) return false
  destination.drawImage(layer, 0, 0)
  return true
}
