import type { SmylrLiveContainerDocument } from './types'

export const SMYLR_OPENPENCIL_LIVE_CONTAINER_MARKER =
  'SMYLR_OPENPENCIL_LIVE_CONTAINER_V1'

type SmylrLiveContainerClipboardPacket = {
  document?: SmylrLiveContainerDocument
  kind?: string
  version?: number
}

function assertLiveContainerDocument(
  value: unknown
): asserts value is SmylrLiveContainerDocument {
  if (!value || typeof value !== 'object') {
    throw new Error('Clipboard did not contain a Smylr live container document.')
  }

  const document = value as Partial<SmylrLiveContainerDocument>
  if (
    typeof document.title !== 'string' ||
    typeof document.route !== 'string' ||
    typeof document.selectedId !== 'string' ||
    !document.tree ||
    typeof document.tree !== 'object'
  ) {
    throw new Error('Clipboard Smylr live container document is incomplete.')
  }
}

function jsonTextAfterMarker(text: string) {
  const markerIndex = text.indexOf(SMYLR_OPENPENCIL_LIVE_CONTAINER_MARKER)
  if (markerIndex === -1) return null

  const afterMarker = text
    .slice(markerIndex + SMYLR_OPENPENCIL_LIVE_CONTAINER_MARKER.length)
    .trim()
  const jsonStart = afterMarker.indexOf('{')
  if (jsonStart === -1) {
    throw new Error('Clipboard Smylr live container packet has no JSON body.')
  }

  return afterMarker.slice(jsonStart).trim()
}

export function parseSmylrLiveContainerClipboardText(
  text: string
): SmylrLiveContainerDocument | null {
  const jsonText = jsonTextAfterMarker(text)
  if (!jsonText) return null

  const parsed = JSON.parse(jsonText) as
    | SmylrLiveContainerClipboardPacket
    | SmylrLiveContainerDocument
  const maybePacket = parsed as SmylrLiveContainerClipboardPacket
  const document = maybePacket.document ?? parsed

  assertLiveContainerDocument(document)

  return document
}
