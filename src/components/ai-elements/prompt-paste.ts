export const LARGE_PASTE_CHARACTER_THRESHOLD = 2_000
export const LARGE_PASTE_LINE_THRESHOLD = 20

const PASTED_TEXT_MIME_TYPE = 'application/x-openpencil-pasted-text'
const PASTED_TEXT_NAME = /^Pasted text(?: (\d+))?\.txt$/

export function shouldAttachPastedText(text: string): boolean {
  if (text.length >= LARGE_PASTE_CHARACTER_THRESHOLD) return true
  return text.split(/\r\n|\r|\n/).length >= LARGE_PASTE_LINE_THRESHOLD
}

export function isPastedTextAttachment(file: Pick<File, 'type'>): boolean {
  return file.type === PASTED_TEXT_MIME_TYPE
}

export function createPastedTextAttachment(text: string, files: readonly File[]): File {
  const usedNumbers = new Set(
    files.flatMap((file) => {
      const match = PASTED_TEXT_NAME.exec(file.name)
      if (!match) return []
      return [match[1] ? Number(match[1]) : 1]
    })
  )
  let number = 1
  while (usedNumbers.has(number)) number += 1
  const name = number === 1 ? 'Pasted text.txt' : `Pasted text ${String(number)}.txt`
  return new File([text], name, { type: PASTED_TEXT_MIME_TYPE })
}
