import type { Locator } from '@playwright/test'

export async function readNarratedTraceEvidencePixels(evidence: Locator) {
  return evidence.evaluate(async (element) => {
    if (!(element instanceof HTMLImageElement)) throw new Error('Evidence preview is not an image')
    await element.decode()
    const canvas = document.createElement('canvas')
    canvas.width = element.naturalWidth
    canvas.height = element.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Evidence pixel canvas is unavailable')
    context.drawImage(element, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let nonWhite = 0
    let violet = 0
    for (let index = 0; index < data.length; index += 16) {
      const red = data[index] ?? 255
      const green = data[index + 1] ?? 255
      const blue = data[index + 2] ?? 255
      if (red < 245 || green < 245 || blue < 245) nonWhite += 1
      if (blue > 170 && red > 80 && red < 190 && green < 150) violet += 1
    }
    return { nonWhite, violet }
  })
}
