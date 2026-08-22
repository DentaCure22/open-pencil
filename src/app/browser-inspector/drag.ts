export const BROWSER_CAPTURE_DRAG_TYPE = 'application/x-openpencil-browser-capture'

export type BrowserCaptureDragPayload = {
  recordingId?: string
  selectionId?: string
  sessionId: string
}

type BrowserCaptureDragReader = Pick<DataTransfer, 'getData' | 'types'>
type BrowserCaptureDragWriter = BrowserCaptureDragReader &
  Pick<DataTransfer, 'effectAllowed' | 'setData'>

function optionalIdentifier(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  return value.trim() || null
}

export function hasBrowserCaptureDrag(dataTransfer: BrowserCaptureDragReader | null): boolean {
  return Boolean(dataTransfer && [...dataTransfer.types].includes(BROWSER_CAPTURE_DRAG_TYPE))
}

export function writeBrowserCaptureDrag(
  event: { dataTransfer: BrowserCaptureDragWriter | null },
  payload: BrowserCaptureDragPayload
): void {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(BROWSER_CAPTURE_DRAG_TYPE, JSON.stringify(payload))
  event.dataTransfer.effectAllowed = 'copy'
}

export function readBrowserCaptureDrag(
  dataTransfer: BrowserCaptureDragReader | null
): BrowserCaptureDragPayload | null {
  if (!hasBrowserCaptureDrag(dataTransfer)) return null
  try {
    const value = JSON.parse(dataTransfer?.getData(BROWSER_CAPTURE_DRAG_TYPE) ?? '') as unknown
    if (!value || typeof value !== 'object') return null
    const sessionId = optionalIdentifier('sessionId' in value ? value.sessionId : undefined)
    const selectionId = optionalIdentifier('selectionId' in value ? value.selectionId : undefined)
    const recordingId = optionalIdentifier('recordingId' in value ? value.recordingId : undefined)
    if (
      !sessionId ||
      selectionId === null ||
      recordingId === null ||
      (selectionId && recordingId)
    ) {
      return null
    }
    return {
      sessionId,
      ...(selectionId ? { selectionId } : {}),
      ...(recordingId ? { recordingId } : {})
    }
  } catch {
    return null
  }
}
