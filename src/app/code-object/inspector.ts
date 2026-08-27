import { computed, ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import { rectsIntersect } from '@open-pencil/scene-graph/geometry'
import type { Rect } from '@open-pencil/scene-graph/primitives'
import type { LayerNode, LayerTreeHostBridge } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'

import { isCodeObjectFrame } from './model'

const LAYER_ID_PREFIX = 'code-object-dom:'
const SELECTED_ATTRIBUTE = 'data-code-object-inspector-selected'

type ParsedLayerId = {
  frameId: string
  path: number[]
}

export type CodeObjectInspectorSelection = {
  attributes: Array<{ name: string; value: string }>
  classes: string[]
  computedStyles: Array<{ name: string; value: string }>
  frameId: string
  layerId: string
  name: string
  role?: string
  selector: string
  tagName: string
}

export type CodeObjectRegionHint = {
  boundsNormalized: Rect
  name: string
  role?: string
  selector: string
  styles: Array<{ name: string; value: string }>
  tagName: string
  text?: string
}

export const codeObjectInspectorVersion = ref(0)
export const selectedCodeObjectLayerId = ref<string | null>(null)

function codeObjectSurface(frameId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return (
    [...document.querySelectorAll<HTMLElement>('[data-code-object-id]')].find(
      (element) => element.dataset.codeObjectId === frameId
    ) ?? null
  )
}

function codeObjectHost(frameId: string): HTMLElement | null {
  const host = codeObjectSurface(frameId)?.firstElementChild
  return host instanceof HTMLElement ? host : null
}

function layerId(frameId: string, path: number[]) {
  return `${LAYER_ID_PREFIX}${encodeURIComponent(frameId)}:${path.join('.')}`
}

export function isCodeObjectLayerId(id: string) {
  return id.startsWith(LAYER_ID_PREFIX)
}

function parseLayerId(id: string): ParsedLayerId | null {
  if (!isCodeObjectLayerId(id)) return null
  const payload = id.slice(LAYER_ID_PREFIX.length)
  const separator = payload.indexOf(':')
  if (separator === -1) return null
  const frameId = decodeURIComponent(payload.slice(0, separator))
  const pathText = payload.slice(separator + 1)
  const path =
    pathText.length === 0 ? [] : pathText.split('.').map((part) => Number.parseInt(part, 10))
  if (!frameId || path.some((part) => !Number.isInteger(part) || part < 0)) return null
  return { frameId, path }
}

function elementAtPath(frameId: string, path: number[]): HTMLElement | null {
  let current: Element | null = codeObjectHost(frameId)
  for (const index of path) current = current?.children.item(index) ?? null
  return current instanceof HTMLElement ? current : null
}

function meaningfulText(element: HTMLElement) {
  if (element.children.length > 0) return ''
  const textContent = element.textContent as string | null
  return (textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48)
}

function elementName(element: HTMLElement) {
  const semanticName =
    element.dataset.slot ||
    element.dataset.component ||
    element.getAttribute('aria-label') ||
    element.getAttribute('role')
  if (semanticName) return semanticName
  const text = meaningfulText(element)
  return text || element.tagName.toLocaleLowerCase()
}

function elementLayer(frameId: string, element: HTMLElement, path: number[]): LayerNode {
  const children = [...element.children].flatMap((child, index) =>
    child instanceof HTMLElement ? [elementLayer(frameId, child, [...path, index])] : []
  )
  const style = getComputedStyle(element)
  return {
    children: children.length > 0 ? children : undefined,
    id: layerId(frameId, path),
    layoutMode: 'NONE',
    locked: true,
    name: elementName(element),
    type: children.length === 0 && meaningfulText(element) ? 'TEXT' : 'FRAME',
    virtual: true,
    visible: style.display !== 'none' && style.visibility !== 'hidden'
  }
}

function codeObjectLayers(node: SceneNode): LayerNode[] | undefined {
  if (!isCodeObjectFrame(node)) return undefined
  const host = codeObjectHost(node.id)
  if (!host) return undefined
  const children = [...host.children].flatMap((child, index) =>
    child instanceof HTMLElement ? [elementLayer(node.id, child, [index])] : []
  )
  return children.length > 0 ? children : undefined
}

function selectorSegment(element: HTMLElement) {
  if (element.id) return `#${element.id}`
  const slot = element.dataset.slot
  if (slot) return `[data-slot="${slot}"]`
  const component = element.dataset.component
  if (component) return `[data-component="${component}"]`
  const tag = element.tagName.toLocaleLowerCase()
  const sameTagSiblings = element.parentElement
    ? [...element.parentElement.children].filter((sibling) => sibling.tagName === element.tagName)
    : []
  if (sameTagSiblings.length <= 1) return tag
  return `${tag}:nth-of-type(${sameTagSiblings.indexOf(element) + 1})`
}

function selectorFor(element: HTMLElement, host: HTMLElement) {
  const segments: string[] = []
  let current: HTMLElement | null = element
  while (current && current !== host) {
    segments.unshift(selectorSegment(current))
    current = current.parentElement
  }
  return segments.join(' > ')
}

const INSPECTED_STYLE_PROPERTIES = [
  'display',
  'position',
  'width',
  'height',
  'padding',
  'gap',
  'color',
  'background-color',
  'border',
  'border-radius',
  'font-family',
  'font-size',
  'font-weight',
  'line-height'
] as const

function clientRect(rect: DOMRect): Rect {
  return { height: rect.height, width: rect.width, x: rect.left, y: rect.top }
}

function normalizedBounds(rect: DOMRect, surfaceRect: DOMRect): Rect {
  return {
    height: rect.height / Math.max(surfaceRect.height, 1),
    width: rect.width / Math.max(surfaceRect.width, 1),
    x: (rect.left - surfaceRect.left) / Math.max(surfaceRect.width, 1),
    y: (rect.top - surfaceRect.top) / Math.max(surfaceRect.height, 1)
  }
}

function compactElementText(element: HTMLElement) {
  const textContent = element.textContent as string | null
  const text = (textContent ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 120) : undefined
}

/** Return bounded semantic DOM hints for a traced subregion inside one live Code Object. */
export function codeObjectRegionHints(
  frameId: string,
  clientRegion: Rect,
  limit = 12
): CodeObjectRegionHint[] {
  const surface = codeObjectSurface(frameId)
  const host = codeObjectHost(frameId)
  if (!surface || !host) return []
  const surfaceRect = surface.getBoundingClientRect()
  const regionArea = Math.max(1, clientRegion.width * clientRegion.height)
  return [host, ...host.querySelectorAll<HTMLElement>('*')]
    .flatMap((element) => {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return []
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0 || !rectsIntersect(clientRect(rect), clientRegion))
        return []
      const overlapWidth = Math.max(
        0,
        Math.min(rect.right, clientRegion.x + clientRegion.width) -
          Math.max(rect.left, clientRegion.x)
      )
      const overlapHeight = Math.max(
        0,
        Math.min(rect.bottom, clientRegion.y + clientRegion.height) -
          Math.max(rect.top, clientRegion.y)
      )
      const elementArea = Math.max(1, rect.width * rect.height)
      return [
        {
          element,
          elementArea,
          overlapRatio: (overlapWidth * overlapHeight) / regionArea,
          rect,
          style
        }
      ]
    })
    .sort(
      (left, right) =>
        right.overlapRatio - left.overlapRatio ||
        left.elementArea - right.elementArea ||
        selectorFor(left.element, host).localeCompare(selectorFor(right.element, host))
    )
    .slice(0, Math.max(1, limit))
    .map(({ element, rect, style }) => ({
      boundsNormalized: normalizedBounds(rect, surfaceRect),
      name: elementName(element),
      ...(element.getAttribute('role') ? { role: element.getAttribute('role') ?? undefined } : {}),
      selector: selectorFor(element, host),
      styles: INSPECTED_STYLE_PROPERTIES.map((name) => ({
        name,
        value: style.getPropertyValue(name)
      })).filter((entry) => entry.value),
      tagName: element.tagName.toLocaleLowerCase(),
      ...(compactElementText(element) ? { text: compactElementText(element) } : {})
    }))
}

export const codeObjectInspectorSelection = computed<CodeObjectInspectorSelection | null>(() => {
  void codeObjectInspectorVersion.value
  const id = selectedCodeObjectLayerId.value
  const parsed = id ? parseLayerId(id) : null
  if (!id || !parsed) return null
  const element = elementAtPath(parsed.frameId, parsed.path)
  const host = codeObjectHost(parsed.frameId)
  if (!element || !host) return null
  const style = getComputedStyle(element)
  return {
    attributes: [...element.attributes]
      .filter((attribute) => attribute.name !== SELECTED_ATTRIBUTE)
      .map((attribute) => ({ name: attribute.name, value: attribute.value })),
    classes: [...element.classList],
    computedStyles: INSPECTED_STYLE_PROPERTIES.map((name) => ({
      name,
      value: style.getPropertyValue(name)
    })).filter((entry) => entry.value),
    frameId: parsed.frameId,
    layerId: id,
    name: elementName(element),
    role: element.getAttribute('role') ?? undefined,
    selector: selectorFor(element, host),
    tagName: element.tagName.toLocaleLowerCase()
  }
})

export function notifyCodeObjectInspectorChanged() {
  codeObjectInspectorVersion.value += 1
}

export function selectCodeObjectLayer(id: string) {
  const previous = selectedCodeObjectLayerId.value
  const previousParsed = previous ? parseLayerId(previous) : null
  if (previousParsed) {
    elementAtPath(previousParsed.frameId, previousParsed.path)?.removeAttribute(SELECTED_ATTRIBUTE)
  }
  const parsed = parseLayerId(id)
  if (!parsed) return
  const element = elementAtPath(parsed.frameId, parsed.path)
  if (!element) return
  selectedCodeObjectLayerId.value = id
  element.setAttribute(SELECTED_ATTRIBUTE, 'true')
  notifyCodeObjectInspectorChanged()
}

export function createCodeObjectLayerTreeBridge(): LayerTreeHostBridge {
  const store = useEditorStore()
  const virtualSelectedIds = computed(() => {
    const id = selectedCodeObjectLayerId.value
    return id ? new Set([id]) : new Set<string>()
  })
  const version = computed(() => codeObjectInspectorVersion.value)

  return {
    getVirtualChildren: codeObjectLayers,
    isVirtualId: isCodeObjectLayerId,
    selectVirtual: (id) => {
      const parsed = parseLayerId(id)
      if (!parsed) return
      store.select([parsed.frameId])
      selectCodeObjectLayer(id)
    },
    version,
    virtualSelectedIds
  }
}
