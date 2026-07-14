import type { Color, SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'
import { ref } from 'vue'

import type { EditorStore } from '@/app/editor/active-store'
import { solid } from '@/app/demo/colors'
import { ensureHtmlBoardGuide } from '@/app/html-board/guide'

const PLUGIN_ID = 'openpencil-html-board'
const BOARD_KIND = 'html-board'
const DEFAULT_VIEWPORT = { height: 900, width: 1440 } as const
export const HTML_BOARD_SCHEMA_VERSION = 4 as const
export const HTML_BOARD_BRIDGE_KIND = 'OPENPENCIL_HTML_BOARD_V1' as const

export type HtmlBoardMode = 'design' | 'inspect' | 'interact'
export type HtmlBoardStyleScope = 'base' | 'phone' | 'tablet'

export type HtmlBoardRevisionSnapshot = {
  artifact: HtmlBoardArtifactMetadata | null
  css: string
  html: string
  js: string
  label: string
  revision: number
  viewport: { height: number; width: number }
  workflow: HtmlBoardWorkflow
}

export type HtmlBoardRevisionRef = {
  boardId: string
  revision: number
  schemaVersion: number
}

export type HtmlBoardArtifactMetadata = {
  artifactId: string
  diagramType: string
  editingModel: string
  kind: string
  renderFormat: string
  renderer: string
  source: string
  sourceHash: string
  title: string
}

export type HtmlBoardWorkflowRelation = 'branch' | 'next-state' | 'root'
export type HtmlBoardWorkflowStatus = 'draft' | 'in-review' | 'production'

export type HtmlBoardReview = {
  feedbackWanted: string
  notEvaluating: string
  requestedAt: HtmlBoardRevisionRef
}

export type HtmlBoardWorkflow = {
  name: string
  origin: HtmlBoardRevisionRef | null
  relation: HtmlBoardWorkflowRelation
  review: HtmlBoardReview | null
  status: HtmlBoardWorkflowStatus
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
  artifact: HtmlBoardArtifactMetadata | null
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
  workflow: HtmlBoardWorkflow
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
  label = 'Created HTML board',
  workflow: HtmlBoardWorkflow = {
    name: 'Production',
    origin: null,
    relation: 'root',
    review: null,
    status: 'production'
  },
  artifact: HtmlBoardArtifactMetadata | null = htmlBoardArtifactMetadata(html)
): HtmlBoardDocument {
  return {
    artifact,
    css,
    format: 'html',
    html,
    js,
    label,
    revision,
    revisions,
    runtime: 'sandboxed-browser',
    schemaVersion: HTML_BOARD_SCHEMA_VERSION,
    viewport,
    workflow
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

function validRevisionRef(value: unknown): HtmlBoardRevisionRef | null {
  const candidate = value as Partial<HtmlBoardRevisionRef> | null
  if (
    typeof candidate?.boardId !== 'string' ||
    !Number.isInteger(candidate.revision) ||
    Number(candidate.revision) < 1 ||
    !Number.isInteger(candidate.schemaVersion) ||
    Number(candidate.schemaVersion) < 1
  ) {
    return null
  }
  return {
    boardId: candidate.boardId,
    revision: Number(candidate.revision),
    schemaVersion: Number(candidate.schemaVersion)
  }
}

function defaultHtmlBoardWorkflow(node: SceneNode): HtmlBoardWorkflow {
  return {
    name: node.name || 'Production',
    origin: null,
    relation: 'root',
    review: null,
    status: 'production'
  }
}

function validHtmlBoardWorkflow(value: unknown, fallback: HtmlBoardWorkflow): HtmlBoardWorkflow {
  const candidate = value as Partial<HtmlBoardWorkflow> | null
  const relation = ['branch', 'next-state', 'root'].includes(String(candidate?.relation))
    ? (candidate?.relation as HtmlBoardWorkflowRelation)
    : fallback.relation
  const status = ['draft', 'in-review', 'production'].includes(String(candidate?.status))
    ? (candidate?.status as HtmlBoardWorkflowStatus)
    : fallback.status
  const reviewCandidate = candidate?.review as Partial<HtmlBoardReview> | null
  const requestedAt = validRevisionRef(reviewCandidate?.requestedAt)
  const review =
    requestedAt &&
    typeof reviewCandidate?.feedbackWanted === 'string' &&
    typeof reviewCandidate.notEvaluating === 'string'
      ? {
          feedbackWanted: reviewCandidate.feedbackWanted,
          notEvaluating: reviewCandidate.notEvaluating,
          requestedAt
        }
      : null
  return {
    name: typeof candidate?.name === 'string' ? candidate.name : fallback.name,
    origin: validRevisionRef(candidate?.origin),
    relation,
    review,
    status
  }
}

function validHtmlBoardArtifact(value: unknown): HtmlBoardArtifactMetadata | null {
  const candidate = value as Partial<HtmlBoardArtifactMetadata> | null
  const keys = [
    'artifactId',
    'diagramType',
    'editingModel',
    'kind',
    'renderFormat',
    'renderer',
    'source',
    'sourceHash',
    'title'
  ] as const
  if (keys.some((key) => typeof candidate?.[key] !== 'string')) return null
  return Object.fromEntries(keys.map((key) => [key, String(candidate?.[key])])) as HtmlBoardArtifactMetadata
}

export function htmlBoardArtifactMetadata(html: string): HtmlBoardArtifactMetadata | null {
  const match = html.match(
    /<script\b[^>]*\bdata-openpencil-artifact(?:\s*=\s*["'][^"']*["'])?[^>]*>([\s\S]*?)<\/script\s*>/i
  )
  if (!match?.[1]) return null
  try {
    return validHtmlBoardArtifact(JSON.parse(match[1]))
  } catch {
    return null
  }
}

function validRevisionSnapshots(
  value: unknown,
  fallbackWorkflow: HtmlBoardWorkflow
): HtmlBoardRevisionSnapshot[] {
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
        artifact: validHtmlBoardArtifact(snapshot.artifact) ?? htmlBoardArtifactMetadata(snapshot.html),
        css: snapshot.css,
        html: snapshot.html,
        js: typeof snapshot.js === 'string' ? snapshot.js : '',
        label: typeof snapshot.label === 'string' ? snapshot.label : `Revision ${snapshot.revision}`,
        revision: Number(snapshot.revision),
        viewport: validViewport(snapshot.viewport, DEFAULT_VIEWPORT),
        workflow: validHtmlBoardWorkflow(snapshot.workflow, fallbackWorkflow)
      }
    ]
  })
}

export function htmlBoardDocument(node: SceneNode): HtmlBoardDocument {
  const fallbackWorkflow = defaultHtmlBoardWorkflow(node)
  const stored = pluginValue(node, 'document')
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as StoredHtmlBoardDocument
      if (
        ([1, 2, 3, HTML_BOARD_SCHEMA_VERSION] as number[]).includes(Number(parsed.schemaVersion)) &&
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
          validRevisionSnapshots(parsed.revisions, fallbackWorkflow).filter(
            (snapshot) => snapshot.revision < revision
          ),
          typeof parsed.label === 'string' ? parsed.label : 'Imported HTML board',
          validHtmlBoardWorkflow(parsed.workflow, fallbackWorkflow),
          validHtmlBoardArtifact(parsed.artifact) ?? htmlBoardArtifactMetadata(parsed.html)
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
    { height: node.height, width: node.width },
    1,
    [],
    'Created HTML board',
    fallbackWorkflow,
    htmlBoardArtifactMetadata(pluginValue(node, 'html') ?? '')
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

export function htmlBoardWorkflow(node: SceneNode): HtmlBoardWorkflow {
  return htmlBoardDocument(node).workflow
}

export function htmlBoardWorkflowStatusLabel(status: HtmlBoardWorkflowStatus): string {
  if (status === 'in-review') return 'In review'
  if (status === 'draft') return 'Draft'
  return 'Production'
}

export function htmlBoardRevision(
  node: SceneNode,
  revision: number
): HtmlBoardRevisionSnapshot | null {
  const document = htmlBoardDocument(node)
  if (document.revision === revision) {
    return {
      artifact: document.artifact,
      css: document.css,
      html: document.html,
      js: document.js,
      label: document.label,
      revision: document.revision,
      viewport: document.viewport,
      workflow: document.workflow
    }
  }
  return document.revisions.find((snapshot) => snapshot.revision === revision) ?? null
}

function nextHtmlBoardDocument(
  current: HtmlBoardDocument,
  next: Pick<HtmlBoardDocument, 'css' | 'html' | 'js' | 'viewport'> & {
    workflow?: HtmlBoardWorkflow
  },
  label: string
): HtmlBoardDocument {
  const previous: HtmlBoardRevisionSnapshot = {
    artifact: current.artifact,
    css: current.css,
    html: current.html,
    js: current.js,
    label: current.label,
    revision: current.revision,
    viewport: current.viewport,
    workflow: current.workflow
  }
  return htmlBoardDocumentData(
    next.html,
    next.css,
    next.js,
    next.viewport,
    current.revision + 1,
    [...current.revisions, previous],
    label,
    next.workflow ?? current.workflow,
    htmlBoardArtifactMetadata(next.html) ?? current.artifact
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
  const artifact = htmlBoardArtifactMetadata(html)
  const existingArtifactBoard = artifact
    ? siblings.find(
        (candidate) =>
          isHtmlBoardFrame(candidate) &&
          htmlBoardDocument(candidate).artifact?.artifactId === artifact.artifactId
      )
    : null
  if (existingArtifactBoard) {
    updateHtmlBoardFrame(
      store,
      existingArtifactBoard.id,
      html,
      css,
      js,
      `Regenerate ${artifact?.artifactId ?? 'HTML artifact'}`
    )
    store.select([existingArtifactBoard.id])
    return existingArtifactBoard
  }
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
    pluginData: boardPluginData(
      frame,
      htmlBoardDocumentData(
        html,
        css,
        js,
        viewport,
        1,
        [],
        'Created HTML board',
        {
          name: 'Production',
          origin: null,
          relation: 'root',
          review: null,
          status: 'production'
        },
        artifact
      )
    )
  })
  store.select([frame.id])
  store.requestRender()
  return frame
}

const WORKFLOW_COLOR = {
  blue: { r: 0.2, g: 0.39, b: 0.91, a: 1 } satisfies Color,
  violet: { r: 0.45, g: 0.31, b: 0.91, a: 1 } satisfies Color
}

function relatedHtmlBoards(store: EditorStore, sourceId: string, relation: HtmlBoardWorkflowRelation) {
  return store.graph
    .getChildren(store.state.currentPageId)
    .filter(isHtmlBoardFrame)
    .filter((candidate) => {
      const workflow = htmlBoardWorkflow(candidate)
      return workflow.relation === relation && workflow.origin?.boardId === sourceId
    })
}

function createWorkflowLink(
  store: EditorStore,
  source: SceneNode,
  target: SceneNode,
  relation: 'branch' | 'next-state',
  sourceRevision: number
): SceneNode[] {
  const pageId = store.state.currentPageId
  const color = relation === 'branch' ? WORKFLOW_COLOR.violet : WORKFLOW_COLOR.blue
  const vertical = relation === 'branch'
  const gap = vertical ? target.y - (source.y + source.height) : target.x - (source.x + source.width)
  const line = store.graph.createNode('RECTANGLE', pageId, {
    cornerRadius: 2,
    fills: [solid(color)],
    height: vertical ? Math.max(24, gap - 80) : 3,
    name: relation === 'branch' ? 'HTML edit branch' : 'HTML flow link',
    pluginData: [
      { pluginId: PLUGIN_ID, key: 'kind', value: 'html-board-workflow-link' },
      { pluginId: PLUGIN_ID, key: 'relation', value: relation },
      { pluginId: PLUGIN_ID, key: 'sourceBoardId', value: source.id },
      { pluginId: PLUGIN_ID, key: 'targetBoardId', value: target.id }
    ],
    width: vertical ? 3 : Math.max(24, gap - 80),
    x: vertical ? source.x + source.width / 2 - 1.5 : source.x + source.width + 40,
    y: vertical ? source.y + source.height + 40 : source.y + source.height / 2 - 1.5
  })
  const labelText = relation === 'branch' ? `EDIT BRANCH · from r${sourceRevision}` : `NEXT STATE · from r${sourceRevision}`
  const label = store.graph.createNode('TEXT', pageId, {
    fills: [solid(color)],
    fontFamily: 'Inter',
    fontSize: 12,
    fontWeight: 700,
    height: 18,
    name: labelText,
    text: labelText,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    width: 170,
    x: vertical ? line.x + 16 : line.x,
    y: vertical ? line.y + line.height / 2 - 9 : line.y - 26
  })
  return [line, label]
}

function pushCreatedHtmlWorkflowUndo(
  store: EditorStore,
  created: SceneNode[],
  previousSelection: Set<string>,
  targetId: string,
  label: string
) {
  const snapshots = created.map((node) => structuredClone(node))
  store.undo.push({
    label,
    forward: () => {
      for (const snapshot of snapshots) {
        store.graph.createNode(snapshot.type, snapshot.parentId ?? store.state.currentPageId, {
          ...structuredClone(snapshot),
          childIds: []
        })
      }
      store.select([targetId])
      store.requestRender()
    },
    inverse: () => {
      for (const node of created.toReversed()) store.graph.deleteNode(node.id)
      store.select([...previousSelection])
      store.requestRender()
    }
  })
}

function createRelatedHtmlBoard(
  store: EditorStore,
  sourceId: string,
  relation: 'branch' | 'next-state'
): SceneNode | null {
  const source = store.graph.getNode(sourceId)
  if (!source || !isHtmlBoardFrame(source)) return null
  const current = htmlBoardDocument(source)
  const origin = htmlBoardRevisionRef(source)
  const existingCount = relatedHtmlBoards(store, source.id, relation).length
  const gap = 196
  const sequence = existingCount + 1
  const x = relation === 'branch' ? source.x : source.x + (source.width + gap) * sequence
  const y = relation === 'branch' ? source.y + (source.height + gap) * sequence : source.y
  const relationName = relation === 'branch' ? `Edit draft ${sequence}` : `Next state ${sequence}`
  const actionLabel = relation === 'branch' ? 'Create HTML edit branch' : 'Create HTML flow state'
  const previousSelection = new Set(store.state.selectedIds)

  const guide = ensureHtmlBoardGuide(store.graph, store.state.currentPageId, {
    x: source.x,
    y: source.y
  })
  const target = store.graph.createNode('FRAME', store.state.currentPageId, {
    clipsContent: true,
    cornerRadius: 12,
    fills: [],
    height: source.height,
    name: `${source.name} · ${relationName}`,
    pluginData: [],
    strokes: [],
    width: source.width,
    x,
    y
  })
  const workflow: HtmlBoardWorkflow = {
    name: relationName,
    origin,
    relation,
    review: null,
    status: 'draft'
  }
  store.graph.updateNode(target.id, {
    pluginData: boardPluginData(
      target,
      htmlBoardDocumentData(
        current.html,
        current.css,
        current.js,
        { height: target.height, width: target.width },
        1,
        [],
        `${relationName} from ${source.id} r${current.revision}`,
        workflow,
        current.artifact
      )
    )
  })
  const created = [target, ...createWorkflowLink(store, source, target, relation, current.revision)]
  pushCreatedHtmlWorkflowUndo(store, created, previousSelection, target.id, actionLabel)
  store.select([guide.id, source.id, target.id])
  store.zoomToSelection()
  store.select([target.id])
  store.requestRender()
  return target
}

export function createHtmlBoardBranch(store: EditorStore, sourceId: string): SceneNode | null {
  return createRelatedHtmlBoard(store, sourceId, 'branch')
}

export function createHtmlBoardFlowState(store: EditorStore, sourceId: string): SceneNode | null {
  return createRelatedHtmlBoard(store, sourceId, 'next-state')
}

export function requestHtmlBoardReview(store: EditorStore, frameId: string): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const current = htmlBoardDocument(frame)
  if (current.workflow.status === 'production' || current.workflow.status === 'in-review') return false
  const nextRevision = current.revision + 1
  const workflow: HtmlBoardWorkflow = {
    ...current.workflow,
    review: {
      feedbackWanted: 'Visual hierarchy, responsive behavior, and interaction clarity',
      notEvaluating: 'Production implementation or source application',
      requestedAt: {
        boardId: frame.id,
        revision: nextRevision,
        schemaVersion: HTML_BOARD_SCHEMA_VERSION
      }
    },
    status: 'in-review'
  }
  const next = nextHtmlBoardDocument(
    current,
    {
      css: current.css,
      html: current.html,
      js: current.js,
      viewport: current.viewport,
      workflow
    },
    'Send HTML edit to review'
  )
  store.updateNodeWithUndo(
    frame.id,
    { pluginData: boardPluginData(frame, next) },
    'Send HTML edit to review'
  )
  store.requestRender()
  return true
}

export function htmlBoardHandoff(node: SceneNode) {
  const document = htmlBoardDocument(node)
  return {
    board: {
      id: node.id,
      name: node.name,
      revision: document.revision,
      schemaVersion: document.schemaVersion,
      viewport: document.viewport
    },
    artifact: document.artifact,
    kind: 'openpencil-html-handoff',
    receipt: {
      sourceApplicationStatus: 'not-applied',
      sourceUnchanged: true
    },
    source: {
      css: document.css,
      html: document.html,
      js: document.js
    },
    workflow: document.workflow
  }
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
