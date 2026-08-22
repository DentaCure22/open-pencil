import { createHash, randomUUID } from 'node:crypto'

import type { SceneNode } from '@open-pencil/scene-graph'
import { cloneSceneNode } from '@open-pencil/scene-graph/copy'

import type { AuthorityBoardDocument } from './document'

export const AUTHORITY_BOARD_FIXTURE_CONTRACT = 'authority-board-fixture/v1' as const

const AGENT_RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'
const FIXTURE_RESET_RECEIPT_PREFIX = 'fixture-reset-request:'

export type AuthorityBoardFixture = {
  authorityId: string
  contentDocumentId: string
  fixtureId: string
  pageId: string
  semanticHash: string
  snapshot: Map<string, SceneNode>
  sourceContentHash: string
  sourceRevision: number
  workspaceId: string
}

export type AuthorityFixtureResetReceipt = {
  appliedRevision: number
  baseRevision: number
  fixtureId: string
  pageId: string
  requestId: string
  route: 'board_fixture:reset'
  semanticHash: string
  version: 1
}

type CaptureAuthorityBoardFixtureOptions = {
  authorityId: string
  contentDocumentId: string
  document: AuthorityBoardDocument
  pageId: string
  sourceContentHash: string
  sourceRevision: number
  workspaceId: string
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)])
  )
}

function receiptEntries(node: SceneNode | undefined) {
  return (node?.pluginData ?? []).filter((entry) => entry.pluginId === AGENT_RECEIPT_PLUGIN_ID)
}

function semanticNode(node: SceneNode): SceneNode {
  return {
    ...cloneSceneNode(node),
    pluginData: node.pluginData.filter((entry) => entry.pluginId !== AGENT_RECEIPT_PLUGIN_ID)
  }
}

function semanticSnapshotValue(snapshot: Map<string, SceneNode>): unknown {
  return [...snapshot]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, node]) => [id, stableValue(semanticNode(node))])
}

export function authorityFixtureSemanticHash(snapshot: Map<string, SceneNode>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        contract: AUTHORITY_BOARD_FIXTURE_CONTRACT,
        nodes: semanticSnapshotValue(snapshot)
      })
    )
    .digest('hex')
}

export function authorityPageSnapshot(
  document: AuthorityBoardDocument,
  pageId: string
): Map<string, SceneNode> {
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS' || page.parentId !== document.graph.rootId) {
    throw new Error(`Board page "${pageId}" does not exist.`)
  }
  const snapshot = new Map<string, SceneNode>()
  const visit = (node: SceneNode) => {
    snapshot.set(node.id, cloneSceneNode(node))
    for (const childId of node.childIds) {
      const child = document.graph.getNode(childId)
      if (!child || child.parentId !== node.id) {
        throw new Error(`Board fixture subtree is inconsistent at "${childId}".`)
      }
      visit(child)
    }
  }
  visit(page)
  return snapshot
}

export function captureAuthorityBoardFixture(
  options: CaptureAuthorityBoardFixtureOptions
): AuthorityBoardFixture {
  const snapshot = authorityPageSnapshot(options.document, options.pageId)
  const semanticHash = authorityFixtureSemanticHash(snapshot)
  return {
    authorityId: options.authorityId,
    contentDocumentId: options.contentDocumentId,
    fixtureId: `authority-fixture:${randomUUID()}`,
    pageId: options.pageId,
    semanticHash,
    snapshot,
    sourceContentHash: options.sourceContentHash,
    sourceRevision: options.sourceRevision,
    workspaceId: options.workspaceId
  }
}

export function assertAuthorityFixtureTarget(
  fixture: AuthorityBoardFixture,
  target: {
    authorityId: string
    contentDocumentId: string
    pageId: string
    workspaceId: string
  }
): void {
  const mismatches = [
    fixture.authorityId === target.authorityId ? null : 'authority',
    fixture.workspaceId === target.workspaceId ? null : 'workspace',
    fixture.contentDocumentId === target.contentDocumentId ? null : 'content document',
    fixture.pageId === target.pageId ? null : 'page'
  ].filter((value): value is string => value !== null)
  if (mismatches.length > 0) {
    throw new Error(`Board fixture belongs to a different exact target: ${mismatches.join(', ')}.`)
  }
}

function mergedReceipts(baseline: SceneNode, current: SceneNode | undefined) {
  const entries = [...receiptEntries(baseline), ...receiptEntries(current)]
  const unique = new Map(entries.map((entry) => [`${entry.pluginId}\0${entry.key}`, entry]))
  return [...unique.values()]
}

function restoredPluginData(baseline: SceneNode, current: SceneNode | undefined) {
  return [
    ...baseline.pluginData.filter((entry) => entry.pluginId !== AGENT_RECEIPT_PLUGIN_ID),
    ...mergedReceipts(baseline, current)
  ]
}

function restoreChildren(
  document: AuthorityBoardDocument,
  fixture: AuthorityBoardFixture,
  currentNodes: Map<string, SceneNode>,
  parentId: string,
  childIds: string[]
): void {
  for (const [index, childId] of childIds.entries()) {
    const baseline = fixture.snapshot.get(childId)
    if (!baseline || baseline.parentId !== parentId) {
      throw new Error(`Board fixture child "${childId}" is missing or has the wrong parent.`)
    }
    const {
      childIds: baselineChildIds,
      parentId: _parentId,
      pluginData: _pluginData,
      ...rest
    } = baseline
    document.graph.createNode(baseline.type, parentId, {
      ...rest,
      childIds: [],
      pluginData: restoredPluginData(baseline, currentNodes.get(childId))
    })
    document.graph.reorderChild(baseline.id, parentId, index)
    restoreChildren(document, fixture, currentNodes, baseline.id, baselineChildIds)
  }
}

export function restoreAuthorityBoardFixture(
  document: AuthorityBoardDocument,
  fixture: AuthorityBoardFixture
): void {
  const currentPage = document.graph.getNode(fixture.pageId)
  const baselinePage = fixture.snapshot.get(fixture.pageId)
  if (
    currentPage?.type !== 'CANVAS' ||
    currentPage.parentId !== document.graph.rootId ||
    baselinePage?.type !== 'CANVAS' ||
    baselinePage.parentId !== document.graph.rootId
  ) {
    throw new Error(`Board fixture page "${fixture.pageId}" is unavailable or invalid.`)
  }
  if (authorityFixtureSemanticHash(fixture.snapshot) !== fixture.semanticHash) {
    throw new Error(`Board fixture "${fixture.fixtureId}" failed semantic hash validation.`)
  }

  const currentNodes = authorityPageSnapshot(document, fixture.pageId)
  const currentChildIds = currentPage.childIds.slice()
  for (const childId of currentChildIds) document.graph.deleteNode(childId)

  const {
    childIds: baselineChildIds,
    id: _id,
    parentId: _parentId,
    pluginData: _pluginData,
    type: _type,
    ...pageChanges
  } = baselinePage
  document.graph.updateNode(fixture.pageId, {
    ...pageChanges,
    pluginData: restoredPluginData(baselinePage, currentNodes.get(fixture.pageId))
  })
  restoreChildren(document, fixture, currentNodes, fixture.pageId, baselineChildIds)
  document.graph.clearAbsPosCache()
}

export function fixtureResetReceiptKey(requestId: string): string {
  return `${FIXTURE_RESET_RECEIPT_PREFIX}${requestId}`
}

export function addAuthorityFixtureResetReceipt(
  document: AuthorityBoardDocument,
  pageId: string,
  receipt: AuthorityFixtureResetReceipt
): void {
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error(`Board page "${pageId}" does not exist.`)
  document.graph.updateNode(pageId, {
    pluginData: [
      ...page.pluginData,
      {
        key: fixtureResetReceiptKey(receipt.requestId),
        pluginId: AGENT_RECEIPT_PLUGIN_ID,
        value: JSON.stringify(receipt)
      }
    ]
  })
}

export function authorityFixtureResetReceipts(
  document: AuthorityBoardDocument,
  requestId: string
): AuthorityFixtureResetReceipt[] {
  const key = fixtureResetReceiptKey(requestId)
  return document.graph.getPages(true).flatMap((page) =>
    page.pluginData
      .filter((entry) => entry.pluginId === AGENT_RECEIPT_PLUGIN_ID && entry.key === key)
      .map((entry) => {
        try {
          const value = JSON.parse(entry.value) as Partial<AuthorityFixtureResetReceipt>
          if (
            value.version !== 1 ||
            value.route !== 'board_fixture:reset' ||
            typeof value.appliedRevision !== 'number' ||
            typeof value.baseRevision !== 'number' ||
            typeof value.fixtureId !== 'string' ||
            typeof value.pageId !== 'string' ||
            typeof value.requestId !== 'string' ||
            typeof value.semanticHash !== 'string'
          ) {
            throw new Error('invalid fields')
          }
          return value as AuthorityFixtureResetReceipt
        } catch {
          throw new Error(`Fixture reset receipt "${requestId}" is unreadable.`)
        }
      })
  )
}
