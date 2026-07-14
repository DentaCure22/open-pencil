import type { Color, SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'
import { ref } from 'vue'

import type { EditorStore } from '@/app/editor/active-store'
import { solid, thinStroke } from '../demo/colors'
import {
  htmlBoardRegisteredComponentById,
  type HtmlBoardRegisteredComponent
} from './components'
import {
  mergedHtmlBoardSourceBindings,
  repositoryVerifiedHtmlBoardComponentSources
} from './component-sources'
import { ensureHtmlBoardGuide } from './guide'

const PLUGIN_ID = 'openpencil-html-board'
const BOARD_KIND = 'html-board'
const DEFAULT_VIEWPORT = { height: 900, width: 1440 } as const
export const HTML_BOARD_SCHEMA_VERSION = 6 as const
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
export type HtmlBoardWorkflowStatus =
  | 'approved'
  | 'change-set'
  | 'draft'
  | 'in-review'
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

export type HtmlBoardImplementationRequest = {
  artifact: HtmlBoardArtifactMetadata | null
  authorization: {
    explicitRequired: true
    status: 'required'
    visibleDiffRequired: true
  }
  board: HtmlBoardRevisionRef & { name: string }
  changeSet: {
    acceptanceCriteria: string[]
    id: string
    status: HtmlBoardChangeSetStatus
  }
  kind: 'openpencil-html-implementation-request'
  nextRequiredStep: string
  receipt: {
    sourceApplicationStatus: 'not-applied'
    sourceUnchanged: true
  }
  source: { css: string; html: string; js: string }
  targets: HtmlBoardSourceBinding[]
}

export type HtmlBoardReview = {
  feedbackWanted: string
  notEvaluating: string
  requestedAt: HtmlBoardRevisionRef
}

export type HtmlBoardWorkflow = {
  changeSet: HtmlBoardChangeSet | null
  name: string
  origin: HtmlBoardRevisionRef | null
  relation: HtmlBoardWorkflowRelation
  review: HtmlBoardReview | null
  status: HtmlBoardWorkflowStatus
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

function boardPluginDataWithComments(node: SceneNode, comments: HtmlBoardRevisionComment[]) {
  return [
    ...node.pluginData.filter((entry) => entry.pluginId !== PLUGIN_ID || entry.key !== 'comments'),
    pluginData('comments', JSON.stringify(comments))
  ]
}

function boardPluginDataWithSourceBindings(node: SceneNode, bindings: HtmlBoardSourceBinding[]) {
  return [
    ...node.pluginData.filter(
      (entry) => entry.pluginId !== PLUGIN_ID || entry.key !== 'source-bindings'
    ),
    pluginData('source-bindings', JSON.stringify(bindings))
  ]
}

function boardPluginDataWithDocumentAndSourceBindings(
  node: SceneNode,
  document: HtmlBoardDocument,
  bindings: HtmlBoardSourceBinding[]
) {
  return [
    ...node.pluginData.filter(
      (entry) =>
        entry.pluginId !== PLUGIN_ID ||
        !['document', 'kind', 'source-bindings'].includes(entry.key)
    ),
    pluginData('kind', BOARD_KIND),
    pluginData('document', JSON.stringify(document)),
    pluginData('source-bindings', JSON.stringify(bindings))
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
  const verification = ['declared', 'repository-verified'].includes(
    candidateVerification
  )
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
  if (!changeSetSource || !changeSetStatus || typeof id !== 'string' || !Array.isArray(acceptanceCriteria)) {
    return null
  }
  return {
    acceptanceCriteria: acceptanceCriteria.filter(
      (criterion): criterion is string => typeof criterion === 'string' && criterion.trim().length > 0
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

function validHtmlBoardWorkflow(value: unknown, fallback: HtmlBoardWorkflow): HtmlBoardWorkflow {
  const name = objectProperty(value, 'name')
  return {
    changeSet: validHtmlBoardChangeSet(objectProperty(value, 'changeSet')),
    name: typeof name === 'string' ? name : fallback.name,
    origin: validRevisionRef(objectProperty(value, 'origin')),
    relation: validHtmlBoardWorkflowRelation(value, fallback.relation),
    review: validHtmlBoardReview(objectProperty(value, 'review')),
    status: validHtmlBoardWorkflowStatus(value, fallback.status)
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
        ([1, 2, 3, 4, 5, HTML_BOARD_SCHEMA_VERSION] as number[]).includes(
          Number(parsed.schemaVersion)
        ) &&
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
  return htmlBoardSourceBindings(node).filter((binding) => sameRevisionRef(binding.attachedTo, current))
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
  const TRUSTED_COMPONENT_ROUTE = new RegExp(
    '^/open-pencil-renderer\\\\?component=[a-z0-9-]+&embed=1$'
  )
  const STYLE_PROPERTIES = ['display', 'position', 'width', 'height', 'margin', 'padding', 'gap', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'border-radius']
  let mode = 'design'
  let hovered = null
  let selected = null
  let hostPort = null

  function liveComponentPayload() {
    const components = []
    for (const frame of document.querySelectorAll('iframe[data-openpencil-live-component="true"]')) {
      const route = frame.getAttribute('data-openpencil-renderer-route') || ''
      if (!TRUSTED_COMPONENT_ROUTE.test(route)) continue
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
      publishLiveComponents()
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

  publishLiveComponents()
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
      `Regenerate ${artifact?.artifactId ?? 'HTML artifact'}`,
      true
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

const WORKFLOW_COLOR = {
  amber: { r: 0.85, g: 0.48, b: 0.08, a: 1 } satisfies Color,
  blue: { r: 0.2, g: 0.39, b: 0.91, a: 1 } satisfies Color,
  green: { r: 0.08, g: 0.52, b: 0.3, a: 1 } satisfies Color,
  greenSoft: { r: 0.9, g: 0.98, b: 0.93, a: 1 } satisfies Color,
  ink: { r: 0.08, g: 0.1, b: 0.16, a: 1 } satisfies Color,
  line: { r: 0.85, g: 0.87, b: 0.91, a: 1 } satisfies Color,
  muted: { r: 0.38, g: 0.42, b: 0.5, a: 1 } satisfies Color,
  white: { r: 1, g: 1, b: 1, a: 1 } satisfies Color,
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
    changeSet: null,
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
  store.zoomToSelection(htmlBoardViewportInsets())
  store.select([target.id])
  store.requestRender()
  return target
}

export function htmlBoardViewportInsets() {
  if (globalThis.innerWidth >= 1100) {
    return { bottom: 72, left: 280, right: 300, top: 32 }
  }
  if (globalThis.innerWidth >= 720) {
    return { bottom: 72, left: 232, right: 232, top: 32 }
  }
  return { bottom: 112, left: 16, right: 16, top: 80 }
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

function workflowText(
  store: EditorStore,
  parentId: string,
  text: string,
  y: number,
  options: { color?: Color; size?: number; weight?: 400 | 600 | 700; width?: number } = {}
) {
  return store.graph.createNode('TEXT', parentId, {
    fills: [solid(options.color ?? WORKFLOW_COLOR.ink)],
    fontFamily: 'Inter',
    fontSize: options.size ?? 11,
    fontWeight: options.weight ?? 400,
    height: Math.ceil((options.size ?? 11) * 1.45),
    name: text.slice(0, 64),
    text,
    textAutoResize: 'HEIGHT',
    width: options.width ?? 280,
    x: 18,
    y
  })
}

function createHtmlBoardCommentMarker(
  store: EditorStore,
  frame: SceneNode,
  comment: HtmlBoardRevisionComment,
  markerIndex: number
) {
  const x = frame.x + frame.width - 220 - markerIndex * 252
  const y = frame.y - 40
  const dot = store.graph.createNode('ELLIPSE', store.state.currentPageId, {
    fills: [solid(WORKFLOW_COLOR.amber)],
    height: 18,
    name: `Comment on r${comment.attachedTo.revision}`,
    pluginData: [
      pluginData('kind', 'html-board-comment-marker'),
      pluginData('boardId', frame.id),
      pluginData('commentId', comment.id),
      pluginData('revision', String(comment.attachedTo.revision))
    ],
    width: 18,
    x,
    y
  })
  const labelText = `r${comment.attachedTo.revision} · ${comment.body.slice(0, 46)}`
  const label = store.graph.createNode('TEXT', store.state.currentPageId, {
    fills: [solid(WORKFLOW_COLOR.muted)],
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: 600,
    height: 18,
    name: labelText,
    pluginData: [
      pluginData('kind', 'html-board-comment-label'),
      pluginData('boardId', frame.id),
      pluginData('commentId', comment.id)
    ],
    text: labelText,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    width: 210,
    x: x + 26,
    y: y + 1
  })
  return [dot, label]
}

export function addHtmlBoardComment(store: EditorStore, frameId: string, body: string): boolean {
  const frame = store.graph.getNode(frameId)
  const commentBody = body.trim()
  if (!frame || !isHtmlBoardFrame(frame) || !commentBody) return false
  const comments = htmlBoardComments(frame)
  const attachedTo = htmlBoardRevisionRef(frame)
  const comment: HtmlBoardRevisionComment = {
    attachedTo,
    body: commentBody,
    id: `comment-${frame.id}-r${attachedTo.revision}-${comments.length + 1}`,
    status: 'open'
  }
  const previousSelection = new Set(store.state.selectedIds)
  store.undo.runBatch('Comment on HTML board revision', () => {
    store.updateNodeWithUndo(
      frame.id,
      { pluginData: boardPluginDataWithComments(frame, [...comments, comment]) },
      'Attach revision comment'
    )
    const created = createHtmlBoardCommentMarker(store, frame, comment, comments.length)
    pushCreatedHtmlWorkflowUndo(
      store,
      created,
      previousSelection,
      frame.id,
      'Add revision comment marker'
    )
  })
  store.select([frame.id])
  store.requestRender()
  return true
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

export function upsertHtmlBoardSourceBinding(
  store: EditorStore,
  frameId: string,
  input: HtmlBoardSourceBindingInput
): boolean {
  const frame = store.graph.getNode(frameId)
  const normalized = normalizedHtmlBoardSourceBindingInput(input)
  if (!frame || !isHtmlBoardFrame(frame) || !normalized) return false
  if (htmlBoardWorkflow(frame).status !== 'preferred') return false
  const attachedTo = htmlBoardRevisionRef(frame)
  const bindings = htmlBoardSourceBindings(frame)
  const existingIndex = bindings.findIndex(
    (binding) =>
      sameRevisionRef(binding.attachedTo, attachedTo) &&
      binding.kind === normalized.kind &&
      binding.repository === normalized.repository &&
      binding.filePath === normalized.filePath &&
      binding.symbol === normalized.symbol
  )
  const nextBinding: HtmlBoardSourceBinding = {
    ...normalized,
    attachedTo,
    id:
      existingIndex !== -1
        ? bindings[existingIndex].id
        : `source-${frame.id}-r${attachedTo.revision}-${bindings.length + 1}`,
    verification: 'declared'
  }
  const nextBindings = [...bindings]
  if (existingIndex !== -1) nextBindings.splice(existingIndex, 1, nextBinding)
  else nextBindings.push(nextBinding)
  if (JSON.stringify(nextBindings) === JSON.stringify(bindings)) return false
  store.updateNodeWithUndo(
    frame.id,
    { pluginData: boardPluginDataWithSourceBindings(frame, nextBindings) },
    'Map HTML board source target'
  )
  store.requestRender()
  return true
}

export function clearHtmlBoardSourceBindingsForCurrentRevision(
  store: EditorStore,
  frameId: string
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  if (htmlBoardWorkflow(frame).status !== 'preferred') return false
  const current = htmlBoardRevisionRef(frame)
  const bindings = htmlBoardSourceBindings(frame)
  const nextBindings = bindings.filter((binding) => !sameRevisionRef(binding.attachedTo, current))
  if (nextBindings.length === bindings.length) return false
  store.updateNodeWithUndo(
    frame.id,
    { pluginData: boardPluginDataWithSourceBindings(frame, nextBindings) },
    'Clear HTML board source targets'
  )
  store.requestRender()
  return true
}

function changeSetCard(store: EditorStore, boardId: string) {
  return store.graph
    .getChildren(store.state.currentPageId)
    .find(
      (node) =>
        pluginValue(node, 'kind') === 'html-board-change-set' &&
        pluginValue(node, 'boardId') === boardId
    )
}

function changeSetStatusLabel(status: HtmlBoardChangeSetStatus) {
  if (status === 'workspace-checked') return 'Workspace checked · source still unchanged'
  if (status === 'source-verified') return 'Source verified in the real app'
  if (status === 'approved') return 'Approved for implementation planning'
  return 'Proposal only · source unchanged'
}

function compactSourceTarget(changeSet: HtmlBoardChangeSet) {
  const first = changeSet.sourceTargets[0]
  if (!first) return 'No source target'
  const location = `${first.repository}/${first.filePath}`
  const compact = location.length > 42 ? `…${location.slice(-41)}` : location
  const remaining = changeSet.sourceTargets.length - 1
  return remaining > 0 ? `${compact} · +${remaining}` : compact
}

function createHtmlBoardChangeSetCard(
  store: EditorStore,
  frame: SceneNode,
  changeSet: HtmlBoardChangeSet
) {
  const card = store.graph.createNode('SECTION', store.state.currentPageId, {
    cornerRadius: 14,
    fills: [solid(WORKFLOW_COLOR.white)],
    height: 156,
    name: `Change set · ${changeSet.id}`,
    pluginData: [
      pluginData('kind', 'html-board-change-set'),
      pluginData('boardId', frame.id),
      pluginData('changeSetId', changeSet.id)
    ],
    strokes: thinStroke(WORKFLOW_COLOR.line),
    width: 320,
    x: frame.x + frame.width - 320,
    y: frame.y + frame.height + 28
  })
  const eyebrow = workflowText(store, card.id, 'DECISION EDGE', 16, {
    color: WORKFLOW_COLOR.violet,
    size: 10,
    weight: 700
  })
  const title = workflowText(store, card.id, 'Preferred → change set', 38, {
    size: 16,
    weight: 700
  })
  const source = workflowText(
    store,
    card.id,
    `Exact source · ${changeSet.source.boardId} r${changeSet.source.revision} · schema v${changeSet.source.schemaVersion}`,
    68,
    { color: WORKFLOW_COLOR.muted, size: 10 }
  )
  const criteria = workflowText(
    store,
    card.id,
    `${changeSet.acceptanceCriteria.length} acceptance criteria`,
    91,
    { color: WORKFLOW_COLOR.muted, size: 10, weight: 600 }
  )
  const target = workflowText(store, card.id, compactSourceTarget(changeSet), 111, {
    color: WORKFLOW_COLOR.muted,
    size: 10,
    weight: 600
  })
  const status = workflowText(store, card.id, changeSetStatusLabel(changeSet.status), 133, {
    color: WORKFLOW_COLOR.green,
    size: 10,
    weight: 600
  })
  store.graph.updateNode(status.id, {
    pluginData: [pluginData('kind', 'html-board-change-set-status')]
  })
  return [card, eyebrow, title, source, criteria, target, status]
}

function updateHtmlBoardChangeSetCard(
  store: EditorStore,
  frameId: string,
  changeSet: HtmlBoardChangeSet,
  label: string
) {
  const card = changeSetCard(store, frameId)
  if (!card) return
  const status = store.graph
    .getChildren(card.id)
    .find((node) => pluginValue(node, 'kind') === 'html-board-change-set-status')
  if (!status) return
  const verified = changeSet.status === 'source-verified'
  store.updateNodeWithUndo(
    card.id,
    {
      fills: [solid(verified ? WORKFLOW_COLOR.greenSoft : WORKFLOW_COLOR.white)],
      strokes: thinStroke(verified ? WORKFLOW_COLOR.green : WORKFLOW_COLOR.line)
    },
    label
  )
  store.updateNodeWithUndo(
    status.id,
    {
      fills: [solid(WORKFLOW_COLOR.green)],
      name: changeSetStatusLabel(changeSet.status),
      text: changeSetStatusLabel(changeSet.status)
    },
    label
  )
}

function updateHtmlBoardWorkflow(
  store: EditorStore,
  frame: SceneNode,
  current: HtmlBoardDocument,
  workflow: HtmlBoardWorkflow,
  label: string
) {
  const next = nextHtmlBoardDocument(
    current,
    {
      css: current.css,
      html: current.html,
      js: current.js,
      viewport: current.viewport,
      workflow
    },
    label
  )
  store.updateNodeWithUndo(frame.id, { pluginData: boardPluginData(frame, next) }, label)
  return next
}

export function markHtmlBoardPreferred(store: EditorStore, frameId: string): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const current = htmlBoardDocument(frame)
  if (current.workflow.status !== 'in-review') return false
  const next = nextHtmlBoardDocument(
    current,
    {
      css: current.css,
      html: current.html,
      js: current.js,
      viewport: current.viewport,
      workflow: { ...current.workflow, changeSet: null, status: 'preferred' }
    },
    'Mark HTML revision Preferred'
  )
  const attachedTo: HtmlBoardRevisionRef = {
    boardId: frame.id,
    revision: next.revision,
    schemaVersion: HTML_BOARD_SCHEMA_VERSION
  }
  const verified = repositoryVerifiedHtmlBoardComponentSources(next.html, attachedTo)
  const bindings = mergedHtmlBoardSourceBindings(htmlBoardSourceBindings(frame), verified)
  store.updateNodeWithUndo(
    frame.id,
    { pluginData: boardPluginDataWithDocumentAndSourceBindings(frame, next, bindings) },
    'Mark HTML revision Preferred'
  )
  store.requestRender()
  return true
}

export function createHtmlBoardChangeSet(
  store: EditorStore,
  frameId: string,
  acceptanceCriteria: string[]
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const current = htmlBoardDocument(frame)
  const criteria = [...new Set(acceptanceCriteria.map((value) => value.trim()).filter(Boolean))]
  const source = htmlBoardRevisionRef(frame)
  const sourceTargets = htmlBoardSourceBindingsForCurrentRevision(frame)
  if (
    current.workflow.status !== 'preferred' ||
    criteria.length === 0 ||
    sourceTargets.length === 0
  ) {
    return false
  }
  const changeSet: HtmlBoardChangeSet = {
    acceptanceCriteria: criteria,
    evidence: null,
    id: `change-set-${frame.id}-r${source.revision}`,
    source,
    sourceTargets,
    sourceApplicationStatus: 'not-applied',
    sourceUnchanged: true,
    status: 'proposed'
  }
  const previousSelection = new Set(store.state.selectedIds)
  store.undo.runBatch('Create HTML change set', () => {
    updateHtmlBoardWorkflow(
      store,
      frame,
      current,
      { ...current.workflow, changeSet, status: 'change-set' },
      'Create HTML change set'
    )
    const created = createHtmlBoardChangeSetCard(store, frame, changeSet)
    pushCreatedHtmlWorkflowUndo(
      store,
      created,
      previousSelection,
      frame.id,
      'Create HTML change set card'
    )
  })
  store.select([frame.id])
  store.requestRender()
  return true
}

export function approveHtmlBoardChangeSet(store: EditorStore, frameId: string): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const current = htmlBoardDocument(frame)
  const changeSet = current.workflow.changeSet
  if (current.workflow.status !== 'change-set' || changeSet?.status !== 'proposed') return false
  const approved: HtmlBoardChangeSet = { ...changeSet, status: 'approved' }
  store.undo.runBatch('Approve HTML change set', () => {
    updateHtmlBoardWorkflow(
      store,
      frame,
      current,
      { ...current.workflow, changeSet: approved, status: 'approved' },
      'Approve HTML change set'
    )
    updateHtmlBoardChangeSetCard(store, frame.id, approved, 'Update change set decision card')
  })
  store.requestRender()
  return true
}

export function checkHtmlBoardChangeSetReadiness(node: SceneNode): {
  ok: boolean
  reasons: string[]
} {
  const document = htmlBoardDocument(node)
  const changeSet = document.workflow.changeSet
  const reasons: string[] = []
  if (!changeSet) return { ok: false, reasons: ['No change set is attached'] }
  if (changeSet.status !== 'approved') reasons.push('Change set is not approved')
  if (changeSet.acceptanceCriteria.length === 0) reasons.push('Acceptance criteria are missing')
  if (changeSet.sourceTargets.length === 0) reasons.push('Source targets are missing')
  if (changeSet.source.boardId !== node.id) reasons.push('Preferred source board does not match')
  if (
    changeSet.sourceTargets.some(
      (target) => !sameRevisionRef(target.attachedTo, changeSet.source) || !target.filePath
    )
  ) {
    reasons.push('Source targets do not match the exact Preferred revision')
  }
  const source = htmlBoardRevision(node, changeSet.source.revision)
  if (!source) reasons.push('Preferred source revision is missing')
  if (
    source &&
    (source.html !== document.html || source.css !== document.css || source.js !== document.js)
  ) {
    reasons.push('Board source changed after the Preferred revision')
  }
  return { ok: reasons.length === 0, reasons }
}

export function markHtmlBoardChangeSetWorkspaceChecked(
  store: EditorStore,
  frameId: string
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const readiness = checkHtmlBoardChangeSetReadiness(frame)
  if (!readiness.ok) return false
  const current = htmlBoardDocument(frame)
  const changeSet = current.workflow.changeSet
  if (!changeSet) return false
  const checked: HtmlBoardChangeSet = { ...changeSet, status: 'workspace-checked' }
  store.undo.runBatch('Check HTML change set readiness', () => {
    updateHtmlBoardWorkflow(
      store,
      frame,
      current,
      { ...current.workflow, changeSet: checked },
      'Check HTML change set readiness'
    )
    updateHtmlBoardChangeSetCard(store, frame.id, checked, 'Update change set decision card')
  })
  store.requestRender()
  return true
}

export function htmlBoardImplementationRequest(node: SceneNode): {
  ok: boolean
  reasons: string[]
  request: HtmlBoardImplementationRequest | null
} {
  const document = htmlBoardDocument(node)
  const changeSet = document.workflow.changeSet
  const reasons: string[] = []
  if (!changeSet) return { ok: false, reasons: ['No change set is attached'], request: null }
  if (changeSet.status !== 'workspace-checked') {
    reasons.push('Change set has not passed workspace readiness')
  }
  if (changeSet.sourceTargets.length === 0) reasons.push('Source targets are missing')
  const preferredSource = htmlBoardRevision(node, changeSet.source.revision)
  if (!preferredSource) reasons.push('Preferred source revision is missing')
  if (reasons.length > 0 || !preferredSource) return { ok: false, reasons, request: null }
  return {
    ok: true,
    reasons: [],
    request: {
      artifact: preferredSource.artifact,
      authorization: {
        explicitRequired: true,
        status: 'required',
        visibleDiffRequired: true
      },
      board: {
        ...changeSet.source,
        name: node.name
      },
      changeSet: {
        acceptanceCriteria: [...changeSet.acceptanceCriteria],
        id: changeSet.id,
        status: changeSet.status
      },
      kind: 'openpencil-html-implementation-request',
      nextRequiredStep:
        'Resolve each repository target, produce a visible source diff, obtain explicit authorization, apply the approved diff, run focused tests, and verify the real app.',
      receipt: {
        sourceApplicationStatus: 'not-applied',
        sourceUnchanged: true
      },
      source: {
        css: preferredSource.css,
        html: preferredSource.html,
        js: preferredSource.js
      },
      targets: changeSet.sourceTargets.map((target) => ({ ...target }))
    }
  }
}

export function verifyHtmlBoardChangeSet(
  store: EditorStore,
  frameId: string,
  evidence: HtmlBoardVerificationEvidence
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const current = htmlBoardDocument(frame)
  const changeSet = current.workflow.changeSet
  if (
    changeSet?.status !== 'workspace-checked' ||
    evidence.realAppVerified !== true ||
    evidence.testPassed !== true ||
    !evidence.sourcePatchId.trim() ||
    !evidence.testCommand.trim() ||
    !evidence.verifiedBy.trim()
  ) {
    return false
  }
  const verified: HtmlBoardChangeSet = {
    ...changeSet,
    evidence: {
      ...evidence,
      sourcePatchId: evidence.sourcePatchId.trim(),
      testCommand: evidence.testCommand.trim(),
      verifiedBy: evidence.verifiedBy.trim()
    },
    sourceApplicationStatus: 'verified',
    sourceUnchanged: false,
    status: 'source-verified'
  }
  store.undo.runBatch('Verify HTML change set', () => {
    updateHtmlBoardWorkflow(
      store,
      frame,
      current,
      { ...current.workflow, changeSet: verified, status: 'verified' },
      'Verify HTML change set'
    )
    updateHtmlBoardChangeSetCard(store, frame.id, verified, 'Update change set decision card')
  })
  store.requestRender()
  return true
}

export function htmlBoardHandoff(node: SceneNode) {
  const document = htmlBoardDocument(node)
  const changeSet = document.workflow.changeSet
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
      sourceApplicationStatus: changeSet?.sourceApplicationStatus ?? 'not-applied',
      sourceUnchanged: changeSet?.sourceUnchanged ?? true
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

function htmlAttributeValue(openingTag: string, name: string): string | null {
  const match = new RegExp(
    `\\s+${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i'
  ).exec(openingTag)
  return match ? (match[1] ?? match[2] ?? '') : null
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeHtmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function openingTagWithAttribute(openingTag: string, name: string, value: string): string {
  const encoded = escapeHtmlAttribute(value)
  const pattern = new RegExp(
    `\\s+${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*')`,
    'i'
  )
  if (pattern.test(openingTag)) return openingTag.replace(pattern, ` ${name}="${encoded}"`)
  const closing = openingTag.endsWith('/>') ? '/>' : '>'
  return `${openingTag.slice(0, -closing.length).trimEnd()} ${name}="${encoded}"${closing}`
}

export function htmlBoardHtmlWithComponentProp(
  html: string,
  componentName: string,
  propName: string,
  value: string,
  componentId = ''
): string {
  const safeComponentName = componentName.trim()
  const safeComponentId = componentId.trim()
  const safePropName = propName.trim().toLowerCase()
  if (!safeComponentName || !/^[a-z][a-z0-9-]{0,47}$/.test(safePropName)) return html
  if (safeComponentId && !/^[a-z][a-z0-9-]{0,79}$/i.test(safeComponentId)) return html

  const candidates = [...html.matchAll(/<([A-Za-z][\w:-]*)(?:\s[^<>]*?)?\s*\/?>/g)]
    .map((match) => ({
      end: (match.index ?? -1) + match[0].length,
      openingTag: match[0],
      start: match.index ?? -1,
      tagName: match[1]
    }))
    .filter(
      (candidate) =>
        candidate.start >= 0 &&
        (safeComponentId
          ? htmlAttributeValue(candidate.openingTag, 'data-openpencil-component-id') ===
            safeComponentId
          : htmlAttributeValue(candidate.openingTag, 'data-openpencil-component') ===
            safeComponentName)
    )
  if (candidates.length !== 1) return html

  const target = candidates[0]
  const propAttribute = `data-openpencil-prop-${safePropName}`
  const binding =
    htmlAttributeValue(target.openingTag, `data-openpencil-bind-${safePropName}`) ?? 'metadata'
  let nextOpeningTag = openingTagWithAttribute(target.openingTag, propAttribute, value)
  if (binding.startsWith('attribute:')) {
    const boundAttribute = binding.slice('attribute:'.length).trim().toLowerCase()
    if (/^(?:aria|data)-[a-z][\w-]*$/.test(boundAttribute)) {
      nextOpeningTag = openingTagWithAttribute(nextOpeningTag, boundAttribute, value)
    }
  }

  const withOpeningTag = `${html.slice(0, target.start)}${nextOpeningTag}${html.slice(target.end)}`
  if (binding !== 'text') return withOpeningTag

  const contentStart = target.start + nextOpeningTag.length
  const closingMatch = new RegExp(`</${escapeRegExp(target.tagName)}\\s*>`, 'i').exec(
    withOpeningTag.slice(contentStart)
  )
  if (!closingMatch) return withOpeningTag
  const contentEnd = contentStart + closingMatch.index
  return `${withOpeningTag.slice(0, contentStart)}${escapeHtmlText(value)}${withOpeningTag.slice(contentEnd)}`
}

type HtmlOpeningTagCandidate = {
  end: number
  openingTag: string
  start: number
  tagName: string
}

function htmlOpeningTagCandidates(html: string): HtmlOpeningTagCandidate[] {
  return [...html.matchAll(/<([A-Za-z][\w:-]*)(?:\s[^<>]*?)?\s*\/?>/g)]
    .map((match) => ({
      end: (match.index ?? -1) + match[0].length,
      openingTag: match[0],
      start: match.index ?? -1,
      tagName: match[1]
    }))
    .filter((candidate) => candidate.start >= 0)
}

function htmlClosingTagStart(html: string, target: HtmlOpeningTagCandidate): number | null {
  if (/\/\s*>$/.test(target.openingTag)) return null
  const tagPattern = new RegExp(
    `<\\/?${escapeRegExp(target.tagName)}(?:\\s[^<>]*?)?\\s*\\/?>`,
    'gi'
  )
  tagPattern.lastIndex = target.end
  let depth = 1
  for (let match = tagPattern.exec(html); match; match = tagPattern.exec(html)) {
    if (/^<\s*\//.test(match[0])) {
      depth -= 1
      if (depth === 0) return match.index
    } else if (!/\/\s*>$/.test(match[0])) {
      depth += 1
    }
  }
  return null
}

function indentHtmlBlock(value: string, indent: string): string {
  const lines = value.trim().split('\n')
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0)
  const minIndent = indents.length ? Math.min(...indents) : 0
  return lines.map((line) => `${indent}${line.slice(minIndent)}`).join('\n')
}

function nextHtmlBoardComponentInstanceId(
  html: string,
  component: HtmlBoardRegisteredComponent
): string {
  const pattern = new RegExp(
    `data-openpencil-component-id=["']${escapeRegExp(component.id)}-(\\d+)["']`,
    'gi'
  )
  const existing = [...html.matchAll(pattern)].map((match) => Number(match[1]) || 0)
  return `${component.id}-${Math.max(0, ...existing) + 1}`
}

export function htmlBoardHtmlWithSlotComponent(
  html: string,
  slotName: string,
  registeredComponentId: string
): string {
  const safeSlotName = slotName.trim()
  const component = htmlBoardRegisteredComponentById(registeredComponentId.trim())
  if (!component || !/^[a-z][a-z0-9-]{0,79}$/i.test(safeSlotName)) return html

  const candidates = htmlOpeningTagCandidates(html).filter(
    (candidate) =>
      htmlAttributeValue(candidate.openingTag, 'data-openpencil-slot') === safeSlotName
  )
  if (candidates.length !== 1) return html

  const target = candidates[0]
  const accepted = (htmlAttributeValue(target.openingTag, 'data-openpencil-slot-accepts') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (!accepted.includes(component.componentName)) return html

  const closingStart = htmlClosingTagStart(html, target)
  if (closingStart === null) return html
  const lineStart = html.lastIndexOf('\n', target.start - 1) + 1
  const slotIndent = html.slice(lineStart, target.start).match(/^\s*/)?.[0] ?? ''
  const childIndent = `${slotIndent}  `
  const currentInner = html.slice(target.end, closingStart).trim()
  const instanceId = nextHtmlBoardComponentInstanceId(html, component)
  const parts = [currentInner, component.render(instanceId)].filter(Boolean)
  const nextInner = `\n${parts.map((part) => indentHtmlBlock(part, childIndent)).join('\n')}\n${slotIndent}`
  return `${html.slice(0, target.end)}${nextInner}${html.slice(closingStart)}`
}

export function htmlBoardCssWithRegisteredComponent(
  css: string,
  registeredComponentId: string
): string {
  const component = htmlBoardRegisteredComponentById(registeredComponentId.trim())
  if (!component) return css
  const start = `/* openpencil-component:${component.id} */`
  const end = `/* /openpencil-component:${component.id} */`
  if (css.includes(start)) return css
  return `${css.trimEnd()}\n\n${start}\n${component.css}\n${end}\n`
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

export function updateHtmlBoardComponentProp(
  store: EditorStore,
  frameId: string,
  componentName: string,
  propName: string,
  value: string,
  componentId = ''
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const content = htmlBoardContent(frame)
  const nextHtml = htmlBoardHtmlWithComponentProp(
    content.html,
    componentName,
    propName,
    value,
    componentId
  )
  if (nextHtml === content.html) return false
  return updateHtmlBoardFrame(
    store,
    frameId,
    nextHtml,
    content.css,
    content.js,
    `Update ${componentName} ${propName}`
  )
}

export function insertHtmlBoardRegisteredComponent(
  store: EditorStore,
  frameId: string,
  slotName: string,
  registeredComponentId: string
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const component = htmlBoardRegisteredComponentById(registeredComponentId)
  if (!component) return false
  const content = htmlBoardContent(frame)
  const nextHtml = htmlBoardHtmlWithSlotComponent(content.html, slotName, registeredComponentId)
  if (nextHtml === content.html) return false
  const nextCss = htmlBoardCssWithRegisteredComponent(content.css, registeredComponentId)
  return updateHtmlBoardFrame(
    store,
    frameId,
    nextHtml,
    nextCss,
    content.js,
    `Add ${component.label} to ${slotName}`
  )
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
  if (['approved', 'change-set', 'production', 'verified'].includes(current.workflow.status)) {
    return false
  }
  const workflow =
    current.workflow.status === 'in-review' || current.workflow.status === 'preferred'
      ? { ...current.workflow, changeSet: null, review: null, status: 'draft' as const }
      : current.workflow
  const next = nextHtmlBoardDocument(
    current,
    { css: current.css, html: current.html, js: current.js, viewport, workflow },
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
