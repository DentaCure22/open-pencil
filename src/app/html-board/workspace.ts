import { ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'
import {
  normalizeWorkLifecycleState,
  type WorkLifecycleStatus,
  type WorkLifecycleTransitionReceipt
} from '@/app/flow-state'

import { htmlBoardRegisteredLiveComponentRoutes } from './components'

const PLUGIN_ID = 'openpencil-html-board'
const BOARD_KIND = 'html-board'
const DEFAULT_VIEWPORT = { height: 900, width: 1440 } as const
export const HTML_BOARD_SCHEMA_VERSION = 6 as const
export const HTML_BOARD_BRIDGE_KIND = 'OPENPENCIL_HTML_BOARD_V1' as const

export type HtmlBoardMode = 'design' | 'inspect' | 'interact'

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
export type HtmlBoardWorkflowStatus =
  | 'approved'
  | 'change-set'
  | 'draft'
  | 'in-review'
  | 'implementing'
  | 'preferred'
  | 'production'
  | 'verified'

export type HtmlBoardChangeSetStatus =
  | 'approved'
  | 'proposed'
  | 'source-verified'
  | 'workspace-checked'

export type HtmlBoardVerificationEvidence = {
  realAppVerified: true
  sourcePatchId: string
  testCommand: string
  testPassed: true
  verifiedBy: string
}

export type HtmlBoardSourceBindingKind = 'component' | 'page' | 'stylesheet' | 'token'
export type HtmlBoardSourceBindingVerification = 'declared' | 'repository-verified'

export type HtmlBoardSourceBinding = {
  attachedTo: HtmlBoardRevisionRef
  filePath: string
  id: string
  kind: HtmlBoardSourceBindingKind
  repository: string
  route: string
  selector: string
  symbol: string
  verification: HtmlBoardSourceBindingVerification
}

export type HtmlBoardSourceBindingInput = Omit<
  HtmlBoardSourceBinding,
  'attachedTo' | 'id' | 'verification'
>

export type HtmlBoardChangeSet = {
  acceptanceCriteria: string[]
  evidence: HtmlBoardVerificationEvidence | null
  id: string
  source: HtmlBoardRevisionRef
  sourceTargets: HtmlBoardSourceBinding[]
  sourceApplicationStatus: 'not-applied' | 'verified'
  sourceUnchanged: boolean
  status: HtmlBoardChangeSetStatus
}

export type HtmlBoardRevisionComment = {
  attachedTo: HtmlBoardRevisionRef
  body: string
  id: string
  status: 'open' | 'resolved'
}

export type HtmlBoardReview = {
  feedbackWanted: string
  notEvaluating: string
  requestedAt: HtmlBoardRevisionRef
}

export type HtmlBoardWorkflow = {
  changeSet: HtmlBoardChangeSet | null
  history?: WorkLifecycleTransitionReceipt[]
  name: string
  origin: HtmlBoardRevisionRef | null
  relation: HtmlBoardWorkflowRelation
  review: HtmlBoardReview | null
  status: HtmlBoardWorkflowStatus
}

export type CreateHtmlBoardFrameOptions = {
  frameId?: string
  frameName?: string
  initialWorkflow?: HtmlBoardWorkflow
}

export type HtmlBoardComponentControl = {
  binding: string
  options: string[]
  type: 'boolean' | 'select' | 'text'
}

export type HtmlBoardElementSelection = {
  boardId: string
  className: string
  componentControls: Record<string, HtmlBoardComponentControl>
  componentId: string
  componentName: string
  componentProps: Record<string, string>
  componentVariant: string
  id: string
  rect: Rect
  selector: string
  slotAccepts: string[]
  slotChildCount: number
  slotLabel: string
  slotName: string
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
    changeSet: null,
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
    ...node.pluginData.filter(
      (entry) => entry.pluginId !== PLUGIN_ID || !['document', 'kind'].includes(entry.key)
    ),
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

type HtmlBoardStoredRecord = { [key: string]: unknown }

function isHtmlBoardStoredRecord(value: unknown): value is HtmlBoardStoredRecord {
  return Boolean(value) && typeof value === 'object'
}

function objectProperty(value: unknown, key: string): unknown {
  if (!isHtmlBoardStoredRecord(value)) return undefined
  return value[key]
}

function stringProperty(value: unknown, key: string): string {
  const property = objectProperty(value, key)
  return typeof property === 'string' ? property : ''
}

function normalizedHtmlBoardSourceBindingInput(
  input: HtmlBoardSourceBindingInput
): HtmlBoardSourceBindingInput | null {
  const repository = input.repository.trim()
  const rawPath = input.filePath.trim().replaceAll('\\', '/')
  const pathParts = rawPath.split('/').filter((part) => part && part !== '.')
  if (
    !repository ||
    !rawPath ||
    !['component', 'page', 'stylesheet', 'token'].includes(input.kind) ||
    rawPath.startsWith('/') ||
    pathParts.length === 0 ||
    pathParts.includes('..')
  ) {
    return null
  }
  return {
    filePath: pathParts.join('/'),
    kind: input.kind,
    repository,
    route: input.route.trim(),
    selector: input.selector.trim(),
    symbol: input.symbol.trim()
  }
}

function validHtmlBoardSourceBinding(value: unknown): HtmlBoardSourceBinding | null {
  const attachedTo = validRevisionRef(objectProperty(value, 'attachedTo'))
  const normalized = normalizedHtmlBoardSourceBindingInput({
    filePath: stringProperty(value, 'filePath'),
    kind: stringProperty(value, 'kind') as HtmlBoardSourceBindingKind,
    repository: stringProperty(value, 'repository'),
    route: stringProperty(value, 'route'),
    selector: stringProperty(value, 'selector'),
    symbol: stringProperty(value, 'symbol')
  })
  const id = stringProperty(value, 'id').trim()
  const candidateVerification = stringProperty(value, 'verification')
  const verification = ['declared', 'repository-verified'].includes(candidateVerification)
    ? (candidateVerification as HtmlBoardSourceBindingVerification)
    : null
  if (!attachedTo || !normalized || !verification || !id) return null
  return {
    ...normalized,
    attachedTo,
    id,
    verification
  }
}

function defaultHtmlBoardWorkflow(node: SceneNode): HtmlBoardWorkflow {
  return {
    changeSet: null,
    history: [],
    name: node.name || 'Production',
    origin: null,
    relation: 'root',
    review: null,
    status: 'production'
  }
}

function validHtmlBoardWorkflowRelation(
  value: unknown,
  fallback: HtmlBoardWorkflowRelation
): HtmlBoardWorkflowRelation {
  const relation = stringProperty(value, 'relation')
  return ['branch', 'next-state', 'root'].includes(relation)
    ? (relation as HtmlBoardWorkflowRelation)
    : fallback
}

function validHtmlBoardWorkflowStatus(
  value: unknown,
  fallback: HtmlBoardWorkflowStatus
): HtmlBoardWorkflowStatus {
  const status = stringProperty(value, 'status')
  return [
    'approved',
    'change-set',
    'draft',
    'in-review',
    'implementing',
    'preferred',
    'production',
    'verified'
  ].includes(status)
    ? (status as HtmlBoardWorkflowStatus)
    : fallback
}

function validHtmlBoardReview(value: unknown): HtmlBoardReview | null {
  const requestedAt = validRevisionRef(objectProperty(value, 'requestedAt'))
  const feedbackWanted = stringProperty(value, 'feedbackWanted')
  const notEvaluating = stringProperty(value, 'notEvaluating')
  return requestedAt &&
    typeof objectProperty(value, 'feedbackWanted') === 'string' &&
    typeof objectProperty(value, 'notEvaluating') === 'string'
    ? {
        feedbackWanted,
        notEvaluating,
        requestedAt
      }
    : null
}

function validHtmlBoardVerificationEvidence(value: unknown): HtmlBoardVerificationEvidence | null {
  if (
    objectProperty(value, 'realAppVerified') !== true ||
    objectProperty(value, 'testPassed') !== true
  ) {
    return null
  }
  const sourcePatchId = objectProperty(value, 'sourcePatchId')
  const testCommand = objectProperty(value, 'testCommand')
  const verifiedBy = objectProperty(value, 'verifiedBy')
  if (
    typeof sourcePatchId !== 'string' ||
    typeof testCommand !== 'string' ||
    typeof verifiedBy !== 'string'
  ) {
    return null
  }
  return {
    realAppVerified: true,
    sourcePatchId,
    testCommand,
    testPassed: true,
    verifiedBy
  }
}

function validHtmlBoardSourceBindings(value: unknown): HtmlBoardSourceBinding[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((target) => {
    const valid = validHtmlBoardSourceBinding(target)
    return valid ? [valid] : []
  })
}

function validHtmlBoardChangeSet(value: unknown): HtmlBoardChangeSet | null {
  const changeSetSource = validRevisionRef(objectProperty(value, 'source'))
  const candidateStatus = stringProperty(value, 'status')
  const changeSetStatus = ['approved', 'proposed', 'source-verified', 'workspace-checked'].includes(
    candidateStatus
  )
    ? (candidateStatus as HtmlBoardChangeSetStatus)
    : null
  const id = objectProperty(value, 'id')
  const acceptanceCriteria = objectProperty(value, 'acceptanceCriteria')
  if (
    !changeSetSource ||
    !changeSetStatus ||
    typeof id !== 'string' ||
    !Array.isArray(acceptanceCriteria)
  ) {
    return null
  }
  return {
    acceptanceCriteria: acceptanceCriteria.filter(
      (criterion): criterion is string =>
        typeof criterion === 'string' && criterion.trim().length > 0
    ),
    evidence: validHtmlBoardVerificationEvidence(objectProperty(value, 'evidence')),
    id,
    source: changeSetSource,
    sourceTargets: validHtmlBoardSourceBindings(objectProperty(value, 'sourceTargets')),
    sourceApplicationStatus:
      objectProperty(value, 'sourceApplicationStatus') === 'verified' ? 'verified' : 'not-applied',
    sourceUnchanged:
      typeof objectProperty(value, 'sourceUnchanged') === 'boolean'
        ? (objectProperty(value, 'sourceUnchanged') as boolean)
        : true,
    status: changeSetStatus
  }
}

function htmlBoardWorkLifecycleStatus(status: HtmlBoardWorkflowStatus): WorkLifecycleStatus {
  return status === 'production' ? 'reference' : status
}

function validHtmlBoardWorkflow(value: unknown, fallback: HtmlBoardWorkflow): HtmlBoardWorkflow {
  const name = objectProperty(value, 'name')
  const status = validHtmlBoardWorkflowStatus(value, fallback.status)
  return {
    changeSet: validHtmlBoardChangeSet(objectProperty(value, 'changeSet')),
    history: normalizeWorkLifecycleState(
      {
        history: objectProperty(value, 'history'),
        status: htmlBoardWorkLifecycleStatus(status)
      },
      htmlBoardWorkLifecycleStatus(status)
    ).history,
    name: typeof name === 'string' ? name : fallback.name,
    origin: validRevisionRef(objectProperty(value, 'origin')),
    relation: validHtmlBoardWorkflowRelation(value, fallback.relation),
    review: validHtmlBoardReview(objectProperty(value, 'review')),
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
  return Object.fromEntries(
    keys.map((key) => [key, String(candidate?.[key])])
  ) as HtmlBoardArtifactMetadata
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
        artifact:
          validHtmlBoardArtifact(snapshot.artifact) ?? htmlBoardArtifactMetadata(snapshot.html),
        css: snapshot.css,
        html: snapshot.html,
        js: typeof snapshot.js === 'string' ? snapshot.js : '',
        label:
          typeof snapshot.label === 'string' ? snapshot.label : `Revision ${snapshot.revision}`,
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
        ([1, 2, 3, 4, 5, HTML_BOARD_SCHEMA_VERSION] as number[]).includes(
          Number(parsed.schemaVersion)
        ) &&
        parsed.format === 'html' &&
        typeof parsed.html === 'string' &&
        typeof parsed.css === 'string'
      ) {
        const revision = Number.isInteger(parsed.revision)
          ? Math.max(1, Number(parsed.revision))
          : 1
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
  return node?.type === 'FRAME' && pluginValue(node, 'kind') === BOARD_KIND
}

export function htmlBoardContent(node: SceneNode): { css: string; html: string; js: string } {
  const document = htmlBoardDocument(node)
  return { css: document.css, html: document.html, js: document.js }
}

export function htmlBoardComments(node: SceneNode): HtmlBoardRevisionComment[] {
  const stored = pluginValue(node, 'comments')
  if (!stored) return []
  try {
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((value) => {
      const candidate = value as Partial<HtmlBoardRevisionComment>
      const attachedTo = validRevisionRef(candidate.attachedTo)
      if (
        !attachedTo ||
        typeof candidate.id !== 'string' ||
        typeof candidate.body !== 'string' ||
        !['open', 'resolved'].includes(String(candidate.status))
      ) {
        return []
      }
      return [
        {
          attachedTo,
          body: candidate.body,
          id: candidate.id,
          status: candidate.status as HtmlBoardRevisionComment['status']
        }
      ]
    })
  } catch {
    return []
  }
}

export function htmlBoardSourceBindings(node: SceneNode): HtmlBoardSourceBinding[] {
  const stored = pluginValue(node, 'source-bindings')
  if (!stored) return []
  try {
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((value) => {
      const binding = validHtmlBoardSourceBinding(value)
      return binding ? [binding] : []
    })
  } catch {
    return []
  }
}

function sameRevisionRef(left: HtmlBoardRevisionRef, right: HtmlBoardRevisionRef) {
  return (
    left.boardId === right.boardId &&
    left.revision === right.revision &&
    left.schemaVersion === right.schemaVersion
  )
}

export function htmlBoardSourceBindingsForCurrentRevision(node: SceneNode) {
  const current = htmlBoardRevisionRef(node)
  return htmlBoardSourceBindings(node).filter((binding) =>
    sameRevisionRef(binding.attachedTo, current)
  )
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
  if (status === 'preferred') return 'Preferred'
  if (status === 'change-set') return 'Change set'
  if (status === 'approved') return 'Approved'
  if (status === 'implementing') return 'Implementing'
  if (status === 'verified') return 'Verified'
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
[data-openpencil-live-component="true"] { visibility: hidden !important; pointer-events: none !important; }
</style><script data-openpencil-bridge>
(() => {
  const KIND = 'OPENPENCIL_HTML_BOARD_V1'
  const TRUSTED_COMPONENT_ROUTES = new Set(${JSON.stringify(htmlBoardRegisteredLiveComponentRoutes())})
  const STYLE_PROPERTIES = ['display', 'position', 'width', 'height', 'margin', 'padding', 'gap', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'border-radius']
  const NativeDate = Date
  const nativeApply = Reflect.apply
  const nativeDateToISOString = Date.prototype.toISOString
  const nativePortPostMessage = MessagePort.prototype.postMessage
  let mode = 'design'
  let hovered = null
  let selected = null
  let hostPort = null
  let surfaceBasis = null
  let trustedInteractionSequence = 0

  function liveComponentPayload() {
    const components = []
    for (const frame of document.querySelectorAll('iframe[data-openpencil-live-component="true"]')) {
      const route = frame.getAttribute('data-openpencil-renderer-route') || ''
      if (!TRUSTED_COMPONENT_ROUTES.has(route)) continue
      const wrapper = frame.closest('[data-openpencil-component-id]')
      const componentId = wrapper?.getAttribute('data-openpencil-component-id') || ''
      const rect = frame.getBoundingClientRect()
      if (!componentId || rect.width <= 0 || rect.height <= 0) continue
      components.push({
        componentId,
        rect: { height: rect.height, width: rect.width, x: rect.x, y: rect.y },
        route
      })
      if (components.length >= 12) break
    }
    return components
  }

  function publishLiveComponents() {
    sendToHost({ action: 'live-components', payload: liveComponentPayload() })
  }

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
    const componentControls = {}
    for (const property of STYLE_PROPERTIES) styles[property] = computed.getPropertyValue(property)
    for (const attribute of element.attributes) {
      if (attribute.name.startsWith('data-openpencil-prop-')) {
        componentProps[attribute.name.replace('data-openpencil-prop-', '')] = attribute.value
      }
    }
    for (const name of Object.keys(componentProps)) {
      const declaredType = element.getAttribute('data-openpencil-control-' + name) || 'text'
      const type = ['boolean', 'select', 'text'].includes(declaredType) ? declaredType : 'text'
      const options = (element.getAttribute('data-openpencil-options-' + name) || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 12)
      componentControls[name] = {
        binding: element.getAttribute('data-openpencil-bind-' + name) || 'metadata',
        options,
        type
      }
    }
    return {
      className: typeof element.className === 'string' ? element.className : '',
      componentControls,
      componentId: element.getAttribute('data-openpencil-component-id') || '',
      componentName: element.getAttribute('data-openpencil-component') || '',
      componentProps,
      componentVariant: element.getAttribute('data-openpencil-variant') || '',
      id: element.id || '',
      rect: { height: rect.height, width: rect.width, x: rect.x, y: rect.y },
      selector: selectorFor(element),
      slotAccepts: (element.getAttribute('data-openpencil-slot-accepts') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 12),
      slotChildCount: element.children.length,
      slotLabel: element.getAttribute('data-openpencil-slot-label') || '',
      slotName: element.getAttribute('data-openpencil-slot') || '',
      styles,
      tagName: element.tagName.toLowerCase(),
      text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140)
    }
  }

  function sendToHost(message) {
    const payload = { ...message, kind: KIND }
    if (hostPort) nativeApply(nativePortPostMessage, hostPort, [payload])
    else parent.postMessage(payload, '*')
  }

  function sendPrivateToHost(message) {
    if (!hostPort) return
    nativeApply(nativePortPostMessage, hostPort, [{ ...message, kind: KIND }])
  }

  function observeTrustedInteraction(event, kind) {
    if (!event.isTrusted || mode !== 'interact' || !hostPort) return
    trustedInteractionSequence += 1
    sendPrivateToHost({
      action: 'trusted-interaction',
      payload: {
        kind,
        occurredAt: nativeApply(nativeDateToISOString, new NativeDate(), []),
        sequence: trustedInteractionSequence
      }
    })
  }

  function applySurfaceView(rendererViewId) {
    if (
      typeof rendererViewId !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(rendererViewId)
    ) return false
    const views = Array.from(document.querySelectorAll('[data-view]'))
    if (!views.some((element) => element.getAttribute('data-view') === rendererViewId)) return false
    for (const element of views) {
      element.classList.toggle('is-active', element.getAttribute('data-view') === rendererViewId)
    }
    for (const element of document.querySelectorAll('[data-view-target]')) {
      element.classList.toggle(
        'is-active',
        element.getAttribute('data-view-target') === rendererViewId
      )
    }
    document.documentElement.dataset.openpencilSurfaceView = rendererViewId
    return true
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
    if (message.action === 'set-surface-view') {
      const rendererViewId =
        typeof message.rendererViewId === 'string' ? message.rendererViewId : ''
      sendToHost({
        action: 'surface-view-applied',
        payload: { applied: applySurfaceView(rendererViewId), rendererViewId }
      })
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
    if (message.action === 'surface-state') {
      const state = message.payload
      const artifactRevision = state?.artifactRevision
      const surfaceRevision = state?.surface?.revision
      const workspaceRevision = state?.workspaceRevision
      const surfaceRunId = state?.surface?.id
      if (
        Number.isInteger(artifactRevision) && artifactRevision > 0 &&
        Number.isInteger(surfaceRevision) && surfaceRevision > 0 &&
        Number.isInteger(workspaceRevision) && workspaceRevision > 0 &&
        typeof surfaceRunId === 'string' && surfaceRunId
      ) {
        surfaceBasis = {
          expected: { artifactRevision, surfaceRevision, workspaceRevision },
          surfaceRunId
        }
      }
    }
    if (message.action === 'surface-event-result' || message.action === 'surface-state') {
      document.dispatchEvent(new CustomEvent('openpencil:' + message.action, {
        detail: message.payload
      }))
    }
  }

  document.addEventListener('openpencil:surface-event', (event) => {
    if (!(event instanceof CustomEvent)) return
    if (
      surfaceBasis &&
      event.detail &&
      typeof event.detail === 'object' &&
      event.detail.surfaceRunId === surfaceBasis.surfaceRunId
    ) {
      event.detail.expected = { ...surfaceBasis.expected }
    }
    sendToHost({ action: 'surface-event', payload: event.detail })
  })

  document.addEventListener('pointerdown', (event) => observeTrustedInteraction(event, 'pointerdown'), true)
  document.addEventListener('keydown', (event) => observeTrustedInteraction(event, 'keydown'), true)
  document.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    sendToHost({
      action: 'canvas-wheel',
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      deltaMode: event.deltaMode,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      metaKey: event.metaKey
    })
  }, { capture: true, passive: false })

  window.addEventListener('message', (event) => {
    if (event.source !== parent) return
    const message = event.data
    if (!message || message.kind !== KIND) return
    if (message.action === 'connect' && event.ports[0]) {
      event.stopImmediatePropagation()
      hostPort?.close()
      hostPort = event.ports[0]
      hostPort.onmessage = (portEvent) => handleHostMessage(portEvent.data)
      hostPort.start()
      sendToHost({ action: 'ready' })
      publishLiveComponents()
      return
    }
    handleHostMessage(message)
  }, true)

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

  publishLiveComponents()
  sendToHost({ action: 'ready' })
})()
</script>`

export function htmlBoardSrcdoc(node: SceneNode): string {
  const { css, html, js } = htmlBoardContent(node)
  const style = `<style data-openpencil-html-board>html,body{margin:0;min-height:100%;}${css}</style>`
  const safeJs = js.replace(/<\/script/gi, '<\\/script')
  const userScript = js.trim() ? `<script data-openpencil-html-board-js>${safeJs}</script>` : ''
  if (/<html[\s>]/i.test(html)) {
    const withBridge = /<head[\s>]/i.test(html)
      ? html.replace(/<head([^>]*)>/i, `<head$1>${style}${HTML_BOARD_BRIDGE}`)
      : html.replace(/<html([^>]*)>/i, `<html$1><head>${style}${HTML_BOARD_BRIDGE}</head>`)
    if (/<\/body>/i.test(withBridge)) return withBridge.replace(/<\/body>/i, `${userScript}</body>`)
    if (/<\/html>/i.test(withBridge)) return withBridge.replace(/<\/html>/i, `${userScript}</html>`)
    return `${withBridge}${userScript}`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${style}${HTML_BOARD_BRIDGE}</head><body>${html}${userScript}</body></html>`
}

export function createHtmlBoardFrame(
  store: EditorStore,
  html: string,
  css: string,
  js = '',
  options: CreateHtmlBoardFrameOptions = {}
): SceneNode {
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
      `Regenerate ${artifact?.artifactId ?? 'HTML artifact'}`,
      true
    )
    store.select([existingArtifactBoard.id])
    return existingArtifactBoard
  }
  const x =
    siblings.length > 0 ? Math.max(...siblings.map((node) => node.x + node.width)) + 120 : 96
  const frameOptions = {
    clipsContent: true,
    cornerRadius: 12,
    fills: [],
    height: viewport.height,
    name: options.frameName ?? 'HTML Board',
    pluginData: [],
    strokes: [],
    width: viewport.width,
    x,
    y: 88
  }
  const frame = options.frameId
    ? store.graph.createNodeWithId(
        options.frameId,
        'FRAME',
        store.state.currentPageId,
        frameOptions
      )
    : store.graph.createNode('FRAME', store.state.currentPageId, frameOptions)
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
        options.initialWorkflow ?? {
          changeSet: null,
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

export function htmlBoardViewportInsets() {
  const panelGap = 14
  if (globalThis.innerWidth >= 1100) {
    const leftPanel = globalThis.document
      .querySelector<HTMLElement>('[data-test-id="layers-panel"]')
      ?.getBoundingClientRect()
    const toolbar = globalThis.document
      .querySelector<HTMLElement>('[data-test-id="toolbar"]')
      ?.getBoundingClientRect()
    const boardDock = globalThis.document
      .querySelector<HTMLElement>('[data-test-id="board-dock"]')
      ?.getBoundingClientRect()
    return {
      bottom: boardDock?.height ? Math.ceil(globalThis.innerHeight - boardDock.top) + panelGap : 72,
      left: leftPanel?.width ? Math.ceil(leftPanel.right) + panelGap : panelGap,
      right: panelGap,
      top: toolbar?.height ? Math.ceil(toolbar.bottom) + panelGap : 32
    }
  }
  if (globalThis.innerWidth >= 720) {
    return { bottom: 72, left: 232, right: 232, top: 32 }
  }
  return { bottom: 112, left: 16, right: 16, top: 80 }
}

export function updateHtmlBoardFrame(
  store: EditorStore,
  frameId: string,
  html: string,
  css: string,
  js: string,
  label = 'Update HTML board',
  allowProtected = false
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const current = htmlBoardDocument(frame)
  if (current.html === html && current.css === css && current.js === js) return false
  if (
    ['approved', 'change-set', 'production', 'verified'].includes(current.workflow.status) &&
    !(allowProtected && current.workflow.status === 'production')
  ) {
    return false
  }
  const workflow =
    current.workflow.status === 'in-review' || current.workflow.status === 'preferred'
      ? { ...current.workflow, changeSet: null, review: null, status: 'draft' as const }
      : current.workflow
  const next = nextHtmlBoardDocument(
    current,
    {
      css,
      html,
      js,
      viewport: { height: frame.height, width: frame.width },
      workflow
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

export function approveHtmlBoardDecisionSurface(store: EditorStore, frameId: string): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const current = htmlBoardDocument(frame)
  if (
    ![
      'evidence-brief-surface',
      'flow-studio-surface',
      'interactive-program-surface',
      'record-explorer-surface',
      'sequential-presentation-surface',
      'spatial-map-surface',
      'weekly-decision-surface'
    ].includes(current.artifact?.kind ?? '') ||
    !['draft', 'in-review'].includes(current.workflow.status)
  ) {
    return false
  }
  const next = nextHtmlBoardDocument(
    current,
    {
      css: current.css,
      html: current.html,
      js: current.js,
      viewport: current.viewport,
      workflow: { ...current.workflow, name: 'Approved decision', status: 'approved' }
    },
    'Approve interactive decision surface'
  )
  store.updateNodeWithUndo(
    frame.id,
    { pluginData: boardPluginData(frame, next) },
    'Approve interactive decision surface'
  )
  store.requestRender()
  return true
}
