import { computed, ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
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
  return element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 48) ?? ''
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
