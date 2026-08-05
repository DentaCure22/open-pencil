import { createRoot, type Root } from 'react-dom/client'

import type { Vector } from '@open-pencil/scene-graph'

import {
  acknowledgeCodeObjectRuntimeMount,
  beginCodeObjectRuntimeRender,
  clearCodeObjectRuntimeRender,
  AuthoredCodeObject
} from '@/app/code-object/compiler'
import type {
  CodeObjectBoardClient,
  DispatchCodeObjectBoardAction
} from '@/app/code-object/contracts'
import type { PdfPageImage } from '@/app/media-evidence/pdf'
import {
  clearObjectGraphPortPresentation,
  invalidateObjectGraphPortPresentation,
  publishObjectGraphPortPresentation,
  type ObjectGraphPortPresentation
} from '@/app/object-graph/port-presentation'

import type { CodeObjectDocument, CodeObjectState } from './model'
import { renderCodeObjectCompatibilityAdapter } from './registry-implementation'

type CodeObjectRuntime = {
  element: HTMLDivElement
  mutationObserver: MutationObserver | null
  resizeObserver: ResizeObserver | null
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

function runtimePortCenter(root: HTMLElement, element: HTMLElement): Vector {
  let current: HTMLElement | null = element
  let x = element.offsetWidth / 2
  let y = element.offsetHeight / 2
  while (current && current !== root) {
    x += current.offsetLeft
    y += current.offsetTop
    current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null
  }
  if (current === root) return { x, y }

  const rootBounds = root.getBoundingClientRect()
  const bounds = element.getBoundingClientRect()
  const scaleX = root.offsetWidth > 0 ? rootBounds.width / root.offsetWidth : 1
  const scaleY = root.offsetHeight > 0 ? rootBounds.height / root.offsetHeight : 1
  return {
    x: (bounds.left + bounds.width / 2 - rootBounds.left) / Math.max(scaleX, 0.001),
    y: (bounds.top + bounds.height / 2 - rootBounds.top) / Math.max(scaleY, 0.001)
  }
}

function measureRuntimePorts(root: HTMLElement): ObjectGraphPortPresentation {
  const anchors = new Map<string, Vector>()
  const duplicateIds = new Set<string>()
  for (const candidate of root.querySelectorAll<HTMLElement>('[data-openpencil-port-id]')) {
    const id = candidate.dataset.openpencilPortId?.trim()
    if (!id) continue
    if (anchors.has(id)) {
      duplicateIds.add(id)
      continue
    }
    anchors.set(id, runtimePortCenter(root, candidate))
  }
  return Object.fromEntries(
    [...anchors.entries()].filter(([id]) => !duplicateIds.has(id))
  ) as ObjectGraphPortPresentation
}

function observeRuntimePorts(frameId: string, element: HTMLElement) {
  const invalidate = () => invalidateObjectGraphPortPresentation(frameId)
  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(invalidate)
  resizeObserver?.observe(element)
  const mutationObserver =
    typeof MutationObserver === 'undefined' ? null : new MutationObserver(invalidate)
  mutationObserver?.observe(element, {
    attributeFilter: ['class', 'data-openpencil-port-id', 'style'],
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true
  })
  return { mutationObserver, resizeObserver }
}

function runtimeFor(frameId: string) {
  const existing = runtimes.get(frameId)
  if (existing) return existing
  if (typeof document === 'undefined') return null
  const element = document.createElement('div')
  element.className = 'relative size-full'
  element.tabIndex = -1
  element.dataset.codeObjectRoot = frameId
  const runtime = { element, root: createRoot(element), ...observeRuntimePorts(frameId, element) }
  runtimes.set(frameId, runtime)
  return runtime
}

export function attachCodeObject(frameId: string, host: HTMLElement) {
  const runtime = runtimeFor(frameId)
  if (!runtime) return null
  const hostChanged = runtime.element.parentElement !== host
  if (hostChanged) host.append(runtime.element)
  acknowledgeCodeObjectRuntimeMount(frameId, true)
  if (hostChanged) invalidateObjectGraphPortPresentation(frameId)
  return runtime.element
}

export function refreshCodeObjectRuntimePortPresentation(frameId: string): boolean {
  const runtime = runtimes.get(frameId)
  if (!runtime?.element.parentElement) return clearObjectGraphPortPresentation(frameId)
  return publishObjectGraphPortPresentation(frameId, measureRuntimePorts(runtime.element))
}

export function renderCodeObject(
  frameId: string,
  document: CodeObjectDocument,
  onStateChange: (state: CodeObjectState) => void,
  source: CodeObjectSource
) {
  const runtime = runtimeFor(frameId)
  if (!runtime) return false
  const generation = beginCodeObjectRuntimeRender(
    frameId,
    document.source,
    runtime.element.parentElement !== null
  )
  const context = {
    document,
    interactionEnabled: source.interactionEnabled ?? false,
    onExtractPdfPage: source.onExtractPdfPage,
    onStateChange,
    ports: source.board.ports,
    sourceBytes: source.bytes,
    sourceFileName: source.fileName
  }
  runtime.root.render(
    <AuthoredCodeObject
      board={source.board}
      dispatchBoardAction={source.dispatchBoardAction}
      document={document}
      frameId={frameId}
      generation={generation}
      interactionEnabled={context.interactionEnabled}
      onStateChange={onStateChange}
      renderComponent={() => renderCodeObjectCompatibilityAdapter(context)}
    />
  )
  invalidateObjectGraphPortPresentation(frameId)
  return generation
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
  acknowledgeCodeObjectRuntimeMount(frameId, false)
  clearObjectGraphPortPresentation(frameId)
}

export function disposeCodeObject(frameId: string) {
  const runtime = runtimes.get(frameId)
  if (!runtime) return false
  runtime.mutationObserver?.disconnect()
  runtime.resizeObserver?.disconnect()
  runtime.root.unmount()
  runtime.element.remove()
  runtimes.delete(frameId)
  clearObjectGraphPortPresentation(frameId)
  clearCodeObjectRuntimeRender(frameId)
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
