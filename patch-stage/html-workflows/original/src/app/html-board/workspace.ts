import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'
import { ref } from 'vue'

import type { EditorStore } from '@/app/editor/active-store'

const PLUGIN_ID = 'openpencil-html-board'
const BOARD_KIND = 'html-board'
const DEFAULT_VIEWPORT = { height: 900, width: 1440 } as const
export const HTML_BOARD_SCHEMA_VERSION = 3 as const
export const HTML_BOARD_BRIDGE_KIND = 'OPENPENCIL_HTML_BOARD_V1' as const

export type HtmlBoardMode = 'design' | 'inspect' | 'interact'
export type HtmlBoardStyleScope = 'base' | 'phone' | 'tablet'

export type HtmlBoardRevisionSnapshot = {
  css: string
  html: string
  js: string
  label: string
  revision: number
  viewport: { height: number; width: number }
}

export type HtmlBoardRevisionRef = {
  boardId: string
  revision: number
  schemaVersion: typeof HTML_BOARD_SCHEMA_VERSION
}

export type HtmlBoardElementSelection = {
  boardId: string
  className: string
  componentName: string
  componentProps: Record<string, string>
  componentVariant: string
  id: string
  rect: Rect
  selector: string
  styles: Record<string, string>
  tagName: string
  text: string
}

export const htmlBoardElementSelection = ref<HtmlBoardElementSelection | null>(null)

export type HtmlBoardDocument = {
  css: string
  format: 'html'
  html: string
  js: string
  label: string
  revision: number
  revisions: HtmlBoardRevisionSnapshot[]
  runtime: 'sandboxed-browser'
  schemaVersion: typeof HTML_BOARD_SCHEMA_VERSION
  viewport: { height: number; width: number }
}

type StoredHtmlBoardDocument = Partial<Omit<HtmlBoardDocument, 'schemaVersion'>> & {
  schemaVersion?: number
}

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { pluginId: PLUGIN_ID, key, value }
}

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

function viewportDimension(html: string, key: 'height' | 'width', fallback: number): number {
  const match = html.match(new RegExp(`data-openpencil-${key}=["'](\\d+)["']`, 'i'))
  const value = Number(match?.[1] ?? fallback)
  return Math.max(240, Math.min(3840, value))
}

function htmlBoardDocumentData(
  html: string,
  css: string,
  js = '',
  viewport = inferHtmlBoardViewport(html),
  revision = 1,
  revisions: HtmlBoardRevisionSnapshot[] = [],
  label = 'Created HTML board'
): HtmlBoardDocument {
  return {
    css,
    format: 'html',
    html,
    js,
    label,
    revision,
    revisions,
    runtime: 'sandboxed-browser',
    schemaVersion: HTML_BOARD_SCHEMA_VERSION,
    viewport
  }
}

function boardPluginData(node: SceneNode, document: HtmlBoardDocument) {
  return [
    ...node.pluginData.filter((entry) => entry.pluginId !== PLUGIN_ID),
    pluginData('kind', BOARD_KIND),
    pluginData('document', JSON.stringify(document))
  ]
}

function validViewport(value: unknown, fallback: { height: number; width: number }) {
  const viewport = value as Partial<{ height: number; width: number }> | null
  return {
    height: typeof viewport?.height === 'number' ? viewport.height : fallback.height,
    width: typeof viewport?.width === 'number' ? viewport.width : fallback.width
  }
}

function validRevisionSnapshots(value: unknown): HtmlBoardRevisionSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const snapshot = candidate as Partial<HtmlBoardRevisionSnapshot>
    if (
      typeof snapshot.html !== 'string' ||
      typeof snapshot.css !== 'string' ||
      !Number.isInteger(snapshot.revision) ||
      Number(snapshot.revision) < 1
    ) {
      return []
    }
    return [
      {
        css: snapshot.css,
        html: snapshot.html,
        js: typeof snapshot.js === 'string' ? snapshot.js : '',
        label: typeof snapshot.label === 'string' ? snapshot.label : `Revision ${snapshot.revision}`,
        revision: Number(snapshot.revision),
        viewport: validViewport(snapshot.viewport, DEFAULT_VIEWPORT)
      }
    ]
  })
}

export function htmlBoardDocument(node: SceneNode): HtmlBoardDocument {
  const stored = pluginValue(node, 'document')
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as StoredHtmlBoardDocument
      if (
        ([1, 2, HTML_BOARD_SCHEMA_VERSION] as number[]).includes(Number(parsed.schemaVersion)) &&
        parsed.format === 'html' &&
        typeof parsed.html === 'string' &&
        typeof parsed.css === 'string'
      ) {
        const revision = Number.isInteger(parsed.revision) ? Math.max(1, Number(parsed.revision)) : 1
        return htmlBoardDocumentData(
          parsed.html,
          parsed.css,
          typeof parsed.js === 'string' ? parsed.js : '',
          validViewport(parsed.viewport, { height: node.height, width: node.width }),
          revision,
          validRevisionSnapshots(parsed.revisions).filter((snapshot) => snapshot.revision < revision),
          typeof parsed.label === 'string' ? parsed.label : 'Imported HTML board'
        )
      }
    } catch (error) {
      console.warn('Ignored incompatible HTML board document:', error)
      // Fall through to the legacy two-field representation.
    }
  }
  return htmlBoardDocumentData(
    pluginValue(node, 'html') ?? '',
    pluginValue(node, 'css') ?? '',
    pluginValue(node, 'js') ?? '',
    { height: node.height, width: node.width }
  )
}

export function isHtmlBoardFrame(node: SceneNode | null | undefined): boolean {
  return Boolean(node && node.type === 'FRAME' && pluginValue(node, 'kind') === BOARD_KIND)
}

export function htmlBoardContent(node: SceneNode): { css: string; html: string; js: string } {
  const document = htmlBoardDocument(node)
  return { css: document.css, html: document.html, js: document.js }
}

export function htmlBoardRevisionRef(node: SceneNode): HtmlBoardRevisionRef {
  const document = htmlBoardDocument(node)
  return {
    boardId: node.id,
    revision: document.revision,
    schemaVersion: HTML_BOARD_SCHEMA_VERSION
  }
}

export function htmlBoardRevision(
  node: SceneNode,
  revision: number
): HtmlBoardRevisionSnapshot | null {
  const document = htmlBoardDocument(node)
  if (document.revision === revision) {
    return {
      css: document.css,
      html: document.html,
      js: document.js,
      label: document.label,
      revision: document.revision,
      viewport: document.viewport
    }
  }
  return document.revisions.find((snapshot) => snapshot.revision === revision) ?? null
}

function nextHtmlBoardDocument(
  current: HtmlBoardDocument,
  next: Pick<HtmlBoardDocument, 'css' | 'html' | 'js' | 'viewport'>,
  label: string
): HtmlBoardDocument {
  const previous: HtmlBoardRevisionSnapshot = {
    css: current.css,
    html: current.html,
    js: current.js,
    label: current.label,
    revision: current.revision,
    viewport: current.viewport
  }
  return htmlBoardDocumentData(
    next.html,
    next.css,
    next.js,
    next.viewport,
    current.revision + 1,
    [...current.revisions, previous],
    label
  )
}

export function inferHtmlBoardViewport(html: string): { height: number; width: number } {
  return {
    height: viewportDimension(html, 'height', DEFAULT_VIEWPORT.height),
    width: viewportDimension(html, 'width', DEFAULT_VIEWPORT.width)
  }
}

const HTML_BOARD_BRIDGE = `<style data-openpencil-bridge-style>
[data-openpencil-inspected="hover"] { outline: 2px solid cornflowerblue !important; outline-offset: -2px !important; cursor: crosshair !important; }
[data-openpencil-inspected="selected"] { outline: 2px solid royalblue !important; outline-offset: -2px !important; box-shadow: inset 0 0 0 1px white !important; }
</style><script data-openpencil-bridge>
(() => {
  const KIND = 'OPENPENCIL_HTML_BOARD_V1'
  const STYLE_PROPERTIES = ['display', 'position', 'width', 'height', 'margin', 'padding', 'gap', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'border-radius']
  let mode = 'design'
  let hovered = null
  let selected = null
  let hostPort = null

  function activeMode() {
    const nameMode = window.name.startsWith('openpencil-') ? window.name.slice(11) : ''
    return ['design', 'inspect', 'interact'].includes(nameMode) ? nameMode : mode
  }

  function clearMark(element) {
    if (element instanceof Element) element.removeAttribute('data-openpencil-inspected')
  }

  function mark(element, state) {
    if (!(element instanceof Element)) return
    if (state === 'hover' && element === selected) return
    element.setAttribute('data-openpencil-inspected', state)
  }

  function selectorFor(element) {
    if (element.id) return '#' + CSS.escape(element.id)
    const parts = []
    let current = element
    while (current && current !== document.documentElement && parts.length < 5) {
      if (current.id) {
        parts.unshift('#' + CSS.escape(current.id))
        break
      }
      let part = current.tagName.toLowerCase()
      const parent = current.parentElement
      if (parent) {
        const sameTag = Array.from(parent.children).filter((child) => child.tagName === current.tagName)
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(current) + 1) + ')'
      }
      parts.unshift(part)
      current = parent
    }
    return parts.join(' > ')
  }

  function selectionPayload(element) {
    const rect = element.getBoundingClientRect()
    const computed = getComputedStyle(element)
    const styles = {}
    const componentProps = {}
    for (const property of STYLE_PROPERTIES) styles[property] = computed.getPropertyValue(property)
    for (const attribute of element.attributes) {
      if (attribute.name.startsWith('data-openpencil-prop-')) {
        componentProps[attribute.name.replace('data-openpencil-prop-', '')] = attribute.value
      }
    }
    return {
      className: typeof element.className === 'string' ? element.className : '',
      componentName: element.getAttribute('data-openpencil-component') || '',
      componentProps,
      componentVariant: element.getAttribute('data-openpencil-variant') || '',
      id: element.id || '',
      rect: { height: rect.height, width: rect.width, x: rect.x, y: rect.y },
      selector: selectorFor(element),
      styles,
      tagName: element.tagName.toLowerCase(),
      text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140)
    }
  }

  function sendToHost(message) {
    const payload = { ...message, kind: KIND }
    if (hostPort) hostPort.postMessage(payload)
    else parent.postMessage(payload, '*')
  }

  function handleHostMessage(message) {
    if (!message || message.kind !== KIND) return
    if (message.action === 'set-mode') {
      mode = message.mode
      document.documentElement.dataset.openpencilMode = mode
      if (mode !== 'inspect') {
        clearMark(hovered)
        clearMark(selected)
        hovered = null
        selected = null
      }
    }
    if (message.action === 'set-selection' && typeof message.selector === 'string') {
      try {
        const element = document.querySelector(message.selector)
        if (element) {
          clearMark(selected)
          selected = element
          hovered = element
          mark(selected, 'selected')
          sendToHost({ action: 'selection', payload: selectionPayload(selected) })
        }
      } catch {
        // The selector is advisory and may become stale after source edits.
      }
    }
  }

  window.addEventListener('message', (event) => {
    const message = event.data
    if (!message || message.kind !== KIND) return
    if (message.action === 'connect' && event.ports[0]) {
      hostPort?.close()
      hostPort = event.ports[0]
      hostPort.onmessage = (portEvent) => handleHostMessage(portEvent.data)
      hostPort.start()
      sendToHost({ action: 'ready' })
      return
    }
    handleHostMessage(message)
  })

  document.addEventListener('pointerover', (event) => {
    if (activeMode() !== 'inspect' || !(event.target instanceof Element)) return
    if (hovered && hovered !== selected) clearMark(hovered)
    hovered = event.target
    mark(hovered, 'hover')
  }, true)

  document.addEventListener('click', (event) => {
    if (activeMode() !== 'inspect' || !(event.target instanceof Element)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    clearMark(selected)
    selected = event.target
    hovered = selected
    mark(selected, 'selected')
    sendToHost({ action: 'selection', payload: selectionPayload(selected) })
  }, true)

  sendToHost({ action: 'ready' })
})()
</script>`

export function htmlBoardSrcdoc(node: SceneNode): string {
  const { css, html, js } = htmlBoardContent(node)
  const style = `<style data-openpencil-html-board>html,body{margin:0;min-height:100%;}${css}</style>`
  const safeJs = js.replace(/<\/script/gi, '<\\/script')
  const userScript = js.trim()
    ? `<script data-openpencil-html-board-js>${safeJs}</script>`
    : ''
  const runtime = `${userScript}${HTML_BOARD_BRIDGE}`
  if (/<html[\s>]/i.test(html)) {
    const withStyle = /<\/head>/i.test(html)
      ? html.replace(/<\/head>/i, `${style}</head>`)
      : html.replace(/<html([^>]*)>/i, `<html$1><head>${style}</head>`)
    if (/<\/body>/i.test(withStyle)) return withStyle.replace(/<\/body>/i, `${runtime}</body>`)
    if (/<\/html>/i.test(withStyle)) return withStyle.replace(/<\/html>/i, `${runtime}</html>`)
    return `${withStyle}${runtime}`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${style}</head><body>${html}${runtime}</body></html>`
}

export function createHtmlBoardFrame(store: EditorStore, html: string, css: string, js = ''): SceneNode {
  const viewport = inferHtmlBoardViewport(html)
  const siblings = store.graph.getChildren(store.state.currentPageId)
  const x = siblings.length > 0 ? Math.max(...siblings.map((node) => node.x + node.width)) + 120 : 96
  const frame = store.graph.createNode('FRAME', store.state.currentPageId, {
    clipsContent: true,
    cornerRadius: 12,
    fills: [],
    height: viewport.height,
    name: 'HTML Board',
    pluginData: [],
    strokes: [],
    width: viewport.width,
    x,
    y: 88
  })
  store.graph.updateNode(frame.id, {
    pluginData: boardPluginData(frame, htmlBoardDocumentData(html, css, js, viewport))
  })
  store.select([frame.id])
  store.requestRender()
  return frame
}

const EDITABLE_STYLE_PROPERTIES = new Set([
  'background-color',
  'border-radius',
  'color',
  'display',
  'font-size',
  'gap',
  'padding'
])

export type HtmlBoardCssToken = { name: string; value: string }

export function htmlBoardCssTokens(css: string): HtmlBoardCssToken[] {
  const tokens = new Map<string, string>()
  for (const match of css.matchAll(/(--[A-Za-z][\w-]*)\s*:\s*([^;{}]+);/g)) {
    const name = match[1]
    const value = match[2]?.trim()
    if (name && value) tokens.set(name, value)
  }
  return [...tokens].map(([name, value]) => ({ name, value }))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function styleScopeLabel(scope: HtmlBoardStyleScope): string {
  if (scope === 'phone') return '@media (max-width: 600px)'
  if (scope === 'tablet') return '@media (min-width: 601px) and (max-width: 1024px)'
  return ''
}

export function htmlBoardViewportStyleScope(node: SceneNode): HtmlBoardStyleScope {
  if (node.width <= 600) return 'phone'
  if (node.width <= 1024) return 'tablet'
  return 'base'
}

export function htmlBoardCssWithStyleOverride(
  css: string,
  selector: string,
  declarations: Record<string, string>,
  scope: HtmlBoardStyleScope
): string {
  const safeSelector = selector.trim()
  if (!safeSelector || /[{}]/.test(safeSelector)) return css
  const entries = Object.entries(declarations).filter(([property, value]) => {
    return EDITABLE_STYLE_PROPERTIES.has(property) && value.trim().length > 0 && !/[;{}]/.test(value)
  })
  if (entries.length === 0) return css

  const markerKey = `${scope}:${encodeURIComponent(safeSelector)}`
  const start = `/* openpencil-style:${markerKey} */`
  const end = `/* /openpencil-style:${markerKey} */`
  const declarationText = entries
    .map(([property, value]) => `  ${property}: ${value.trim()};`)
    .join('\n')
  const rule = `${safeSelector} {\n${declarationText}\n}`
  const media = styleScopeLabel(scope)
  const scopedRule = media ? `${media} {\n${rule.replace(/^/gm, '  ')}\n}` : rule
  const block = `${start}\n${scopedRule}\n${end}`
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'g')
  if (pattern.test(css)) return css.replace(pattern, block)
  return `${css.trimEnd()}\n\n${block}\n`
}

export function htmlBoardCssWithTokenOverride(css: string, name: string, value: string): string {
  const safeName = name.trim()
  const safeValue = value.trim()
  if (!/^--[A-Za-z][\w-]*$/.test(safeName) || !safeValue || /[;{}]/.test(safeValue)) return css
  const markerKey = encodeURIComponent(safeName)
  const start = `/* openpencil-token:${markerKey} */`
  const end = `/* /openpencil-token:${markerKey} */`
  const block = `${start}\n:root { ${safeName}: ${safeValue}; }\n${end}`
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'g')
  if (pattern.test(css)) return css.replace(pattern, block)
  return `${css.trimEnd()}\n\n${block}\n`
}

export function updateHtmlBoardFrame(
  store: EditorStore,
  frameId: string,
  html: string,
  css: string,
  js: string,
  label = 'Update HTML board'
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const current = htmlBoardDocument(frame)
  if (current.html === html && current.css === css && current.js === js) return false
  const next = nextHtmlBoardDocument(
    current,
    {
      css,
      html,
      js,
      viewport: { height: frame.height, width: frame.width }
    },
    label
  )
  store.updateNodeWithUndo(
    frame.id,
    {
      pluginData: boardPluginData(frame, next)
    },
    label
  )
  store.requestRender()
  return true
}

export function updateHtmlBoardStyleOverride(
  store: EditorStore,
  frameId: string,
  selector: string,
  declarations: Record<string, string>,
  scope: HtmlBoardStyleScope
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const content = htmlBoardContent(frame)
  const nextCss = htmlBoardCssWithStyleOverride(content.css, selector, declarations, scope)
  if (nextCss === content.css) return false
  return updateHtmlBoardFrame(store, frameId, content.html, nextCss, content.js, 'Style HTML element')
}

export function updateHtmlBoardTokenOverride(
  store: EditorStore,
  frameId: string,
  name: string,
  value: string
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const content = htmlBoardContent(frame)
  const nextCss = htmlBoardCssWithTokenOverride(content.css, name, value)
  if (nextCss === content.css) return false
  return updateHtmlBoardFrame(store, frameId, content.html, nextCss, content.js, 'Update design token')
}

export function updateHtmlBoardViewport(
  store: EditorStore,
  frameId: string,
  viewport: { height: number; width: number },
  label: string
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const current = htmlBoardDocument(frame)
  if (frame.width === viewport.width && frame.height === viewport.height) return false
  const next = nextHtmlBoardDocument(
    current,
    { css: current.css, html: current.html, js: current.js, viewport },
    label
  )
  store.updateNodeWithUndo(
    frame.id,
    {
      height: viewport.height,
      pluginData: boardPluginData(frame, next),
      width: viewport.width
    },
    label
  )
  store.requestRender()
  return true
}
