import { browserCaptureAttachmentFromDrag } from '@/app/browser-inspector/attachment'
import { hasBrowserCaptureDrag, readBrowserCaptureDrag } from '@/app/browser-inspector/drag'

export const MAX_ATTACHMENT_COUNT = 5
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024 // 100 MB
export const MAX_TOTAL_ATTACHMENT_BYTES = 250 * 1024 * 1024 // 250 MB

export function isSameAttachmentFile(left: File, right: File): boolean {
  return (
    left.name === right.name && left.size === right.size && left.lastModified === right.lastModified
  )
}

export function appendDraftAttachments(
  current: File[],
  incoming: File[]
): { attachments: File[]; error?: string } {
  if (!incoming.length) return { attachments: current }
  const firstOversized = incoming.find((file) => file.size > MAX_ATTACHMENT_BYTES)
  const unique = [...current]
  let totalBytes = unique.reduce((total, file) => total + file.size, 0)
  let exceedsTotal = false

  for (const file of incoming) {
    if (
      file.size > MAX_ATTACHMENT_BYTES ||
      unique.some((candidate) => isSameAttachmentFile(candidate, file))
    ) {
      continue
    }
    if (unique.length === MAX_ATTACHMENT_COUNT) break
    if (totalBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
      exceedsTotal = true
      continue
    }
    unique.push(file)
    totalBytes += file.size
  }

  let error: string | undefined
  if (firstOversized) {
    error = `${firstOversized.name} is larger than 100 MB.`
  } else if (exceedsTotal) {
    error = 'Attachments must be 250 MB or smaller in total.'
  } else if (
    incoming.some((file) => !unique.some((candidate) => isSameAttachmentFile(candidate, file)))
  ) {
    error = 'You can attach up to 5 files.'
  }

  return { attachments: unique, ...(error ? { error } : {}) }
}

export type AttachmentDragReader = {
  files: Iterable<File>
  getData: (format: string) => string
  types: Iterable<string>
}

export function carriesAttachmentDrag(
  dataTransfer: Pick<AttachmentDragReader, 'getData' | 'types'> | null
): boolean {
  if (!dataTransfer) return false
  const types = [...dataTransfer.types]
  return types.includes('Files') || hasBrowserCaptureDrag(dataTransfer)
}

export function readAttachmentDrag(dataTransfer: AttachmentDragReader | null): File[] {
  if (!dataTransfer) return []
  const capture = readBrowserCaptureDrag(dataTransfer)
  const captureAttachment = capture ? browserCaptureAttachmentFromDrag(capture) : null
  if (captureAttachment) return [captureAttachment]
  return [...dataTransfer.files]
}
