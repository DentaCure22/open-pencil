import { createRoot, type Root } from 'react-dom/client'

import { AuthoredCodeObject } from '@/app/code-object/compiler'
import type {
  CodeObjectBoardClient,
  DispatchCodeObjectBoardAction
} from '@/app/code-object/contracts'
import type { PdfPageImage } from '@/app/media-evidence/pdf'

import type { CodeObjectDocument, CodeObjectState } from './model'
import { renderCodeObjectCompatibilityAdapter } from './registry-implementation'

type CodeObjectRuntime = {
  element: HTMLDivElement
  root: Root
}

export type CodeObjectSource = {
  board: CodeObjectBoardClient
  bytes?: Uint8Array
  dispatchBoardAction: DispatchCodeObjectBoardAction
  fileName?: string
  interactionEnabled?: boolean
  onExtractPdfPage?: (pageNumber: number, image: PdfPageImage) => void
}

const runtimes = new Map<string, CodeObjectRuntime>()
const parkingLot = typeof document === 'undefined' ? null : document.createDocumentFragment()

function runtimeFor(frameId: string) {
  const existing = runtimes.get(frameId)
  if (existing) return existing
  if (typeof document === 'undefined') return null
  const element = document.createElement('div')
  element.className = 'size-full'
  element.tabIndex = -1
  element.dataset.codeObjectRoot = frameId
  const runtime = { element, root: createRoot(element) }
  runtimes.set(frameId, runtime)
  return runtime
}

export function attachCodeObject(frameId: string, host: HTMLElement) {
  const runtime = runtimeFor(frameId)
  if (!runtime) return null
  if (runtime.element.parentElement !== host) host.append(runtime.element)
  return runtime.element
}

export function renderCodeObject(
  frameId: string,
  document: CodeObjectDocument,
  onStateChange: (state: CodeObjectState) => void,
  source: CodeObjectSource
) {
  const runtime = runtimeFor(frameId)
  if (!runtime) return false
  const context = {
    document,
    interactionEnabled: source.interactionEnabled ?? false,
    onExtractPdfPage: source.onExtractPdfPage,
    onStateChange,
    sourceBytes: source.bytes,
    sourceFileName: source.fileName
  }
  runtime.root.render(
    <AuthoredCodeObject
      board={source.board}
      dispatchBoardAction={source.dispatchBoardAction}
      document={document}
      interactionEnabled={context.interactionEnabled}
      onStateChange={onStateChange}
      renderComponent={() => renderCodeObjectCompatibilityAdapter(context)}
    />
  )
  return true
}

export function focusCodeObject(frameId: string) {
  const runtime = runtimes.get(frameId)
  if (!runtime) return false
  runtime.element.focus({ preventScroll: true })
  return true
}

export function parkCodeObject(frameId: string) {
  const runtime = runtimes.get(frameId)
  if (!runtime || !parkingLot) return
  parkingLot.append(runtime.element)
}

export function disposeCodeObject(frameId: string) {
  const runtime = runtimes.get(frameId)
  if (!runtime) return false
  runtime.root.unmount()
  runtime.element.remove()
  runtimes.delete(frameId)
  return true
}

export function disposeAllCodeObjects() {
  for (const frameId of runtimes.keys()) disposeCodeObject(frameId)
}

export function disposeCodeObjectsExcept(frameIds: ReadonlySet<string>) {
  for (const frameId of runtimes.keys()) {
    if (!frameIds.has(frameId)) disposeCodeObject(frameId)
  }
}

export function codeObjectRuntimeCount() {
  return runtimes.size
}
