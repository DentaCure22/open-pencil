import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
/**
 * Design-layer outline for Smylr foundations parents (pages / boards).
 *
 * Keep it complete and simple:
 * - Page: show boards + live frames (hide decorative washes/rules only).
 * - Board: show section folders for token groups, and include every token row.
 * - Nested frames: recurse fully — do not drop containers.
 * - Expansion is owned by LayerTreeRoot.
 */
import type { LayerNode } from '@open-pencil/vue'

import { SMYLR_BRAND_BOARD_KIND, SMYLR_BRAND_PAGE_KIND } from './create-brand-page'
import {
  SMYLR_TOKENS_DARK_BOARD_KIND,
  SMYLR_TOKENS_LIGHT_BOARD_KIND,
  SMYLR_TOKENS_PAGE_KIND
} from './create-tokens-page'

const PLUGIN_ID = 'smylr-production'
const LIVE_APP_KIND = 'live-app-frame'
const DESIGN_SECTION_PREFIX = 'design:section:'
const CONTAINER_TYPES = new Set<SceneNode['type']>([
  'FRAME',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'INSTANCE',
  'COMPONENT_SET'
])

export function isDesignSectionId(id: string): boolean {
  return id.startsWith(DESIGN_SECTION_PREFIX)
}

/** sectionId → first real node id (for selection) */
const sectionAnchorById = new Map<string, string>()

export function designSectionAnchorId(sectionId: string): string | null {
  return sectionAnchorById.get(sectionId) ?? null
}

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find((e) => e.pluginId === PLUGIN_ID && e.key === key)?.value
}

function kindOf(node: SceneNode): string | undefined {
  return pluginValue(node, 'kind')
}

function isWashOrRule(node: SceneNode): boolean {
  const n = node.name.toLowerCase()
  if (n.includes(' wash')) return true
  if (n.endsWith(' rule') || n.includes(' rule')) return true
  if (n.startsWith('band rule')) return true
  return false
}

function isTokenRow(node: SceneNode): boolean {
  return kindOf(node) === 'smylr-token-row'
}

function isSceneNode(node: SceneNode | undefined): node is SceneNode {
  return node !== undefined
}

function isContainerNode(node: SceneNode): boolean {
  return CONTAINER_TYPES.has(node.type)
}

function isBoardFrame(node: SceneNode): boolean {
  const k = kindOf(node)
  return (
    k === SMYLR_TOKENS_LIGHT_BOARD_KIND ||
    k === SMYLR_TOKENS_DARK_BOARD_KIND ||
    k === SMYLR_BRAND_BOARD_KIND ||
    k === LIVE_APP_KIND ||
    (node.type === 'FRAME' &&
      (node.name.startsWith('Design System ·') ||
        node.name.startsWith('Live Smylr App') ||
        /brand/i.test(node.name)))
  )
}

function isSectionTitleText(node: SceneNode): boolean {
  if (node.type !== 'TEXT') return false
  const t = (node.text || node.name || '').trim()
  if (t.length < 2 || t.length > 28) return false
  // SURFACES, TEXT, BORDERS, STATUS, RADIUS, ELEVATION, SPACING…
  return t === t.toUpperCase() && /[A-Z]/.test(t) && !t.includes('·')
}

function shortBoardName(node: SceneNode): string {
  const k = kindOf(node)
  if (k === SMYLR_TOKENS_LIGHT_BOARD_KIND) return 'Light'
  if (k === SMYLR_TOKENS_DARK_BOARD_KIND) return 'Dark'
  if (k === SMYLR_BRAND_BOARD_KIND) return 'Brand'
  if (k === LIVE_APP_KIND) {
    return node.name.replace(/^Live Smylr App\s*\/\s*/i, '').trim() || node.name
  }
  const parts = node.name.split('·').map((p) => p.trim())
  if (parts.length >= 2) return parts.slice(1).join(' · ')
  return node.name
}

function toLayer(node: SceneNode, children?: LayerNode[], name = node.name): LayerNode {
  return {
    id: node.id,
    name,
    type: node.type,
    layoutMode: node.layoutMode,
    visible: node.visible,
    locked: node.locked,
    children: children && children.length > 0 ? children : undefined
  }
}

function tokenRowLayer(node: SceneNode): LayerNode {
  const label = pluginValue(node, 'label')
  const name = label || node.name.split('·')[0]?.trim() || node.name
  return toLayer(node, undefined, name)
}

function prettySectionName(title: string): string {
  const t = title.trim()
  if (!t) return 'Section'
  // STATUS → Status, SURFACES → Surfaces; keep short all-caps if 1–2 chars
  if (t.length <= 2) return t
  return t.charAt(0) + t.slice(1).toLowerCase()
}

/**
 * Board interior: group token rows under section headers; keep all tokens.
 * Only hide pure decorative washes/rules.
 */
function outlineBoardChildren(graph: SceneGraph, board: SceneNode): LayerNode[] {
  const kids = board.childIds.map((id) => graph.getNode(id)).filter(isSceneNode)

  const out: LayerNode[] = []
  let sectionTitle: SceneNode | null = null
  let sectionTitleText = ''
  let sectionTokens: SceneNode[] = []

  const flushSection = () => {
    if (!sectionTitleText && sectionTokens.length === 0) {
      sectionTitle = null
      sectionTokens = []
      return
    }
    const title = sectionTitleText || 'Other'
    const sectionId = `${DESIGN_SECTION_PREFIX}${board.id}:${title.toLowerCase()}`
    const anchor = sectionTokens[0]?.id ?? sectionTitle?.id
    if (anchor) sectionAnchorById.set(sectionId, anchor)

    out.push({
      id: sectionId,
      name: prettySectionName(title),
      type: 'FRAME',
      layoutMode: 'NONE',
      visible: true,
      locked: true,
      virtual: true,
      children: sectionTokens.length > 0 ? sectionTokens.map(tokenRowLayer) : undefined
    })
    sectionTitle = null
    sectionTitleText = ''
    sectionTokens = []
  }

  for (const kid of kids) {
    if (isWashOrRule(kid)) continue

    if (isSectionTitleText(kid)) {
      flushSection()
      sectionTitle = kid
      sectionTitleText = (kid.text || kid.name || 'Section').trim()
      continue
    }

    // Token rows always land in a section (create "Other" if needed)
    if (isTokenRow(kid)) {
      if (!sectionTitleText) sectionTitleText = 'Other'
      sectionTokens.push(kid)
      continue
    }

    // Nested frames / groups — full recurse, never drop
    if (isContainerNode(kid)) {
      flushSection()
      const nested = outlineBoardChildren(graph, kid)
      out.push(toLayer(kid, nested, kid.name))
      continue
    }

    // Board chrome titles (keep main titles, skip tiny subtitles)
    if (kid.type === 'TEXT') {
      const t = (kid.text || kid.name || '').trim()
      if (t === ':root' || t === '.dark') continue
      if (!sectionTitleText && t.length > 0) {
        out.push(toLayer(kid, undefined, t))
      }
      continue
    }

    // Status chips / rects inside a section
    if (sectionTitleText && kid.type === 'RECTANGLE') {
      sectionTokens.push(kid)
      continue
    }

    // Anything else non-decorative. Keep leaf rectangles too: a rectangle can
    // be a real container surface, not just board chrome.
    flushSection()
    out.push(toLayer(kid))
  }

  flushSection()
  return out
}

/**
 * Page-level: every board + live frame. Hide decorative washes only.
 */
function outlinePageChildren(graph: SceneGraph, page: SceneNode): LayerNode[] {
  const kids = page.childIds.map((id) => graph.getNode(id)).filter(isSceneNode)

  const out: LayerNode[] = []
  for (const kid of kids) {
    if (isWashOrRule(kid)) continue

    const k = kindOf(kid)

    if (k === LIVE_APP_KIND) {
      // Children filled by live getVirtualChildren in LayerTreeRoot
      out.push(toLayer(kid, undefined, shortBoardName(kid)))
      continue
    }

    if (
      k === SMYLR_TOKENS_LIGHT_BOARD_KIND ||
      k === SMYLR_TOKENS_DARK_BOARD_KIND ||
      k === SMYLR_BRAND_BOARD_KIND
    ) {
      const sections = outlineBoardChildren(graph, kid)
      out.push(toLayer(kid, sections, shortBoardName(kid)))
      continue
    }

    // Other containers on the page — include fully.
    if (isContainerNode(kid)) {
      const nested = outlineBoardChildren(graph, kid)
      out.push(toLayer(kid, nested, shortBoardName(kid)))
      continue
    }

    // Do not silently drop valid page-level leaf layers.
    out.push(toLayer(kid))
  }
  return out
}

function isFoundationsPage(page: SceneNode): boolean {
  const k = kindOf(page)
  return (
    k === SMYLR_TOKENS_PAGE_KIND ||
    k === SMYLR_BRAND_PAGE_KIND ||
    k === 'smylr-production-page' ||
    page.name === 'Design System' ||
    page.name === 'Brand Guidelines'
  )
}

function isPageNode(node: SceneNode): boolean {
  // Native OpenPencil scene pages use CANVAS. Keep this explicit so ordinary
  // pages stay on the native full-tree path unless Smylr structure is present.
  return node.type === 'CANVAS'
}

/**
 * Concise-but-complete outline for a scene parent.
 * Returns undefined only when this parent should use the default full recurse.
 */
export function getDesignOutlineChildren(
  graph: SceneGraph,
  parent: SceneNode
): LayerNode[] | undefined {
  if (isPageNode(parent)) {
    const hasSmylrStructure = parent.childIds.some((id) => {
      const n = graph.getNode(id)
      return n ? isBoardFrame(n) || isWashOrRule(n) || kindOf(n) === LIVE_APP_KIND : false
    })
    if (hasSmylrStructure || isFoundationsPage(parent)) {
      return outlinePageChildren(graph, parent)
    }
  }

  const k = kindOf(parent)
  if (
    k === SMYLR_TOKENS_LIGHT_BOARD_KIND ||
    k === SMYLR_TOKENS_DARK_BOARD_KIND ||
    k === SMYLR_BRAND_BOARD_KIND
  ) {
    return outlineBoardChildren(graph, parent)
  }

  return undefined
}
