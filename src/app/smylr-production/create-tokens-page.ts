/**
 * Design System tokens — Light board + Dark board (side by side).
 *
 * Flat glass surfaces · no card-in-card rows · text stays inside bounds.
 * Example clean layout for HMR iteration.
 */
import type { Color, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { DEMO_COLORS, solid, thinStroke } from '../demo/colors'
import { blurEffect, dropShadow } from '../demo/effects'
import {
  SMYLR_TOKEN_DEFINITIONS,
  tokenPreviewDark,
  tokenPreviewLight,
  tokenValueDark,
  tokenValueLight,
  type SmylrTokenDefinition
} from './smylr-token-catalog'

export const SMYLR_TOKENS_PAGE_ID = 'smylr-tokens'
export const SMYLR_TOKENS_PAGE_KIND = 'smylr-tokens-page'
export const SMYLR_TOKENS_BOARD_KIND = 'smylr-tokens-board'
export const SMYLR_TOKENS_LIGHT_BOARD_KIND = 'smylr-tokens-board-light'
export const SMYLR_TOKENS_DARK_BOARD_KIND = 'smylr-tokens-board-dark'

const PLUGIN_ID = 'smylr-production'
const DEFAULT_FONT_FAMILY = 'Inter'

type ThemeMode = 'light' | 'dark'

type ThemeChrome = {
  mode: ThemeMode
  /** Soft glass wash on the board */
  glass: Color
  glassOpacity: number
  ink: Color
  muted: Color
  accent: Color
  hairline: Color
  swatchStroke: Color
  title: string
  subtitle: string
}

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { pluginId: PLUGIN_ID, key, value }
}

const LIGHT: ThemeChrome = {
  mode: 'light',
  glass: { r: 1, g: 1, b: 1, a: 1 },
  glassOpacity: 0.62,
  ink: { r: 0.12, g: 0.13, b: 0.15, a: 1 },
  muted: { r: 0.45, g: 0.47, b: 0.5, a: 1 },
  accent: { r: 0.15, g: 0.45, b: 0.95, a: 1 },
  hairline: { r: 0.8, g: 0.86, b: 0.92, a: 0.9 },
  swatchStroke: { r: 0.75, g: 0.8, b: 0.86, a: 1 },
  title: 'Light · EDIT WORKS',
  subtitle: ':root'
}

const DARK: ThemeChrome = {
  mode: 'dark',
  glass: { r: 0.12, g: 0.14, b: 0.2, a: 1 },
  glassOpacity: 0.78,
  ink: { r: 0.96, g: 0.97, b: 0.99, a: 1 },
  muted: { r: 0.62, g: 0.68, b: 0.78, a: 1 },
  accent: { r: 0.45, g: 0.72, b: 1, a: 1 },
  hairline: { r: 0.32, g: 0.38, b: 0.48, a: 0.9 },
  swatchStroke: { r: 0.4, g: 0.45, b: 0.55, a: 1 },
  title: 'Dark · EDIT WORKS',
  subtitle: '.dark'
}

/** Soft page backdrop behind glass boards */
const PAGE_WASH_LIGHT: Color = { r: 0.93, g: 0.95, b: 0.98, a: 1 }
const PAGE_WASH_DARK: Color = { r: 0.08, g: 0.09, b: 0.11, a: 1 }

const ROW_H = 40
const ROW_GAP = 2
const COL_W = 248
const COL_GAP = 28
const PAD = 28
const TITLE_H = 22
const BAND_GAP = 32
const HEADER_H = 56
const SWATCH = 28

function ellipsize(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= 1) return '…'
  return `${text.slice(0, maxChars - 1)}…`
}

function addText(
  graph: SceneGraph,
  parentId: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fontWeight: 400 | 700,
  color: Color,
  maxWidth: number
) {
  return graph.createNode('TEXT', parentId, {
    x,
    y,
    width: Math.max(12, maxWidth),
    height: Math.ceil(fontSize * 1.35),
    name: text.slice(0, 48),
    text,
    fontSize,
    fontWeight,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAutoResize: 'HEIGHT',
    textTruncation: 'ENDING',
    maxLines: 1,
    fills: [solid(color)]
  })
}

function byVar(cssVariable: string): SmylrTokenDefinition | undefined {
  return SMYLR_TOKEN_DEFINITIONS.find((t) => t.cssVariable === cssVariable)
}

function byCategory(category: string): SmylrTokenDefinition[] {
  return SMYLR_TOKEN_DEFINITIONS.filter((t) => t.category === category)
}

function themePreview(token: SmylrTokenDefinition, mode: ThemeMode): Color {
  if (mode === 'dark') return tokenPreviewDark(token) ?? DEMO_COLORS.gray200
  return tokenPreviewLight(token) ?? DEMO_COLORS.gray200
}

function themeValue(token: SmylrTokenDefinition, mode: ThemeMode): string {
  return mode === 'dark' ? tokenValueDark(token) : tokenValueLight(token)
}

function themeShadow(token: SmylrTokenDefinition, mode: ThemeMode) {
  if (mode === 'dark' && token.shadowDark) return token.shadowDark
  return token.shadow ?? { x: 0, y: 2, blur: 6, spread: 0, a: 0.12 }
}

/** Flat token line: swatch + labels only (no row card). */
function addFlatToken(
  graph: SceneGraph,
  parentId: string,
  token: SmylrTokenDefinition,
  chrome: ThemeChrome,
  x: number,
  y: number,
  width: number
) {
  const util = token.utilities?.[0]
  const meta = ellipsize(util ? `${token.cssVariable} · ${util}` : token.cssVariable, 32)
  const label = ellipsize(token.label, 26)
  const kind = token.previewKind ?? 'color'
  const plugin = [
    pluginData('kind', 'smylr-token-row'),
    pluginData('theme', chrome.mode),
    pluginData('cssVariable', token.cssVariable),
    pluginData('label', token.label),
    pluginData('value', themeValue(token, chrome.mode))
  ]

  if (kind === 'radius') {
    const r = Math.min(token.radiusPx ?? 8, SWATCH / 2)
    graph.createNode('RECTANGLE', parentId, {
      x,
      y: y + 6,
      width: SWATCH,
      height: SWATCH,
      name: `${token.label} · ${token.cssVariable}`,
      fills: [solid(chrome.glass, chrome.mode === 'dark' ? 0.4 : 0.9)],
      strokes: thinStroke(chrome.accent),
      cornerRadius: r,
      pluginData: plugin
    })
  } else if (kind === 'shadow') {
    const s = themeShadow(token, chrome.mode)
    graph.createNode('RECTANGLE', parentId, {
      x,
      y: y + 6,
      width: SWATCH,
      height: SWATCH,
      name: `${token.label} · ${token.cssVariable}`,
      fills: [solid(chrome.mode === 'dark' ? { r: 0.22, g: 0.23, b: 0.26, a: 1 } : DEMO_COLORS.white)],
      cornerRadius: 6,
      effects: [dropShadow(s.x, s.y, s.blur, s.spread, { r: 0, g: 0, b: 0, a: s.a })],
      pluginData: plugin
    })
  } else if (kind === 'spacing') {
    const bar = Math.min(SWATCH + 8, Math.max(8, token.spacingPx ?? 12))
    graph.createNode('RECTANGLE', parentId, {
      x,
      y: y + 14,
      width: bar,
      height: 10,
      name: `${token.label} · ${token.cssVariable}`,
      fills: [solid(chrome.accent)],
      cornerRadius: 3,
      pluginData: plugin
    })
  } else {
    graph.createNode('RECTANGLE', parentId, {
      x,
      y: y + 6,
      width: SWATCH,
      height: SWATCH,
      name: `${token.label} · ${token.cssVariable}`,
      fills: [solid(themePreview(token, chrome.mode))],
      strokes: thinStroke(chrome.swatchStroke),
      cornerRadius: 7,
      pluginData: plugin
    })
  }

  const textX = x + SWATCH + 12
  const textW = Math.max(40, width - SWATCH - 16)
  addText(graph, parentId, label, textX, y + 4, 12, 700, chrome.ink, textW)
  addText(graph, parentId, meta, textX, y + 22, 10, 400, chrome.muted, textW)
}

function columnHeight(count: number): number {
  return TITLE_H + 8 + count * (ROW_H + ROW_GAP)
}

function addColumn(
  graph: SceneGraph,
  parentId: string,
  title: string,
  tokens: SmylrTokenDefinition[],
  chrome: ThemeChrome,
  x: number,
  y: number,
  width: number
) {
  addText(graph, parentId, title.toUpperCase(), x, y, 11, 700, chrome.muted, width)
  // Soft rule under section title (not a nested container)
  graph.createNode('RECTANGLE', parentId, {
    x,
    y: y + 18,
    width: Math.min(width, 40),
    height: 2,
    name: `${title} rule`,
    fills: [solid(chrome.accent, 0.45)],
    cornerRadius: 1
  })
  tokens.forEach((token, i) => {
    addFlatToken(
      graph,
      parentId,
      token,
      chrome,
      x,
      y + TITLE_H + 8 + i * (ROW_H + ROW_GAP),
      width
    )
  })
}

/** Status as one flat strip of families — solid/tint/border chips, no cards. */
function addStatusStrip(
  graph: SceneGraph,
  parentId: string,
  chrome: ThemeChrome,
  x: number,
  y: number,
  width: number
): number {
  addText(graph, parentId, 'STATUS', x, y, 11, 700, chrome.muted, 80)
  graph.createNode('RECTANGLE', parentId, {
    x: x + 56,
    y: y + 6,
    width: 32,
    height: 2,
    name: 'Status rule',
    fills: [solid(chrome.accent, 0.45)],
    cornerRadius: 1
  })

  const families = [
    { name: 'Success', keys: ['--success', '--success-tint', '--success-border'] as const },
    { name: 'Warning', keys: ['--warning', '--warning-tint', '--warning-border'] as const },
    { name: 'Destructive', keys: ['--destructive', '--destructive-tint', '--destructive-border'] as const },
    { name: 'Primary', keys: ['--primary', '--primary-tint', '--primary-border'] as const }
  ]

  const famW = Math.floor((width - 12 * 3) / 4)
  const bodyY = y + TITLE_H + 4

  families.forEach((fam, fi) => {
    const fx = x + fi * (famW + 12)
    addText(graph, parentId, fam.name, fx, bodyY, 12, 700, chrome.ink, famW)
    fam.keys.forEach((cssVar, i) => {
      const token = byVar(cssVar)
      if (!token) return
      const sx = fx + i * 36
      graph.createNode('RECTANGLE', parentId, {
        x: sx,
        y: bodyY + 22,
        width: 30,
        height: 30,
        name: `${fam.name} · ${cssVar}`,
        fills: [solid(themePreview(token, chrome.mode))],
        strokes: thinStroke(chrome.swatchStroke),
        cornerRadius: 8,
        pluginData: [
          pluginData('kind', 'smylr-token-row'),
          pluginData('theme', chrome.mode),
          pluginData('cssVariable', cssVar),
          pluginData('label', fam.name)
        ]
      })
    })
  })

  return TITLE_H + 4 + 56
}

function buildThemeBoard(
  graph: SceneGraph,
  pageNodeId: string,
  chrome: ThemeChrome,
  x: number,
  y: number
): string {
  const surfaces = byCategory('surface')
  const textTokens = byCategory('text')
  const borders = byCategory('border')
  const charts = byCategory('chart')
  const radii = byCategory('radius')
  const shadows = byCategory('shadow')
  const spacing = byCategory('spacing')

  const cols = 4
  const boardInnerW = COL_W * cols + COL_GAP * (cols - 1)
  const boardW = PAD * 2 + boardInnerW

  const row1H = Math.max(
    columnHeight(surfaces.length),
    columnHeight(textTokens.length),
    columnHeight(borders.length),
    columnHeight(charts.length)
  )
  const statusH = TITLE_H + 4 + 56
  const row3H = Math.max(
    columnHeight(radii.length),
    columnHeight(shadows.length),
    columnHeight(spacing.length)
  )
  const boardH = HEADER_H + row1H + BAND_GAP + statusH + BAND_GAP + row3H + PAD

  const kind =
    chrome.mode === 'light' ? SMYLR_TOKENS_LIGHT_BOARD_KIND : SMYLR_TOKENS_DARK_BOARD_KIND

  // Soft ambient behind glass (reads through BACKGROUND_BLUR)
  const ambient = chrome.mode === 'light' ? PAGE_WASH_LIGHT : PAGE_WASH_DARK
  graph.createNode('RECTANGLE', pageNodeId, {
    x: x - 8,
    y: y - 8,
    width: boardW + 16,
    height: boardH + 16,
    name: `${chrome.title} wash`,
    fills: [solid(ambient)],
    cornerRadius: 18
  })

  // Single glass board — content is flat children, not nested cards
  const board = graph.createNode('FRAME', pageNodeId, {
    x,
    y,
    width: boardW,
    height: boardH,
    name: `Design System · ${chrome.title}`,
    fills: [solid(chrome.glass, chrome.glassOpacity)],
    strokes: thinStroke(chrome.hairline),
    cornerRadius: 16,
    clipsContent: true,
    effects: [
      blurEffect('BACKGROUND_BLUR', chrome.mode === 'light' ? 20 : 24),
      dropShadow(0, 12, 40, -8, {
        r: 0.08,
        g: 0.12,
        b: 0.2,
        a: chrome.mode === 'light' ? 0.1 : 0.35
      })
    ],
    pluginData: [
      pluginData('kind', kind),
      pluginData('pageId', SMYLR_TOKENS_PAGE_ID),
      pluginData('theme', chrome.mode)
    ]
  })

  // Light board: title on the right (obvious layout edit). Dark stays left.
  const titleMaxW = 320
  const titleX =
    chrome.mode === 'light' ? Math.max(PAD, boardW - PAD - titleMaxW) : PAD
  const subX = chrome.mode === 'light' ? Math.max(PAD, boardW - PAD - 160) : PAD
  addText(graph, board.id, chrome.title, titleX, 16, 22, 700, chrome.ink, titleMaxW)
  addText(graph, board.id, chrome.subtitle, subX, 42, 12, 400, chrome.muted, 160)
  // Clean header only — no demo ping lines

  const y1 = HEADER_H
  addColumn(graph, board.id, 'Surfaces', surfaces, chrome, PAD, y1, COL_W)
  addColumn(graph, board.id, 'Text', textTokens, chrome, PAD + COL_W + COL_GAP, y1, COL_W)
  addColumn(graph, board.id, 'Borders', borders, chrome, PAD + 2 * (COL_W + COL_GAP), y1, COL_W)
  addColumn(graph, board.id, 'Charts', charts, chrome, PAD + 3 * (COL_W + COL_GAP), y1, COL_W)

  const y2 = HEADER_H + row1H + BAND_GAP
  // Hairline separator instead of a nested panel
  graph.createNode('RECTANGLE', board.id, {
    x: PAD,
    y: y2 - 16,
    width: boardInnerW,
    height: 1,
    name: 'Band rule',
    fills: [solid(chrome.hairline)]
  })
  addStatusStrip(graph, board.id, chrome, PAD, y2, boardInnerW)

  const y3 = y2 + statusH + BAND_GAP
  graph.createNode('RECTANGLE', board.id, {
    x: PAD,
    y: y3 - 16,
    width: boardInnerW,
    height: 1,
    name: 'Band rule 2',
    fills: [solid(chrome.hairline)]
  })
  const bottomW = Math.floor((boardInnerW - COL_GAP * 2) / 3)
  addColumn(graph, board.id, 'Radius', radii, chrome, PAD, y3, bottomW)
  addColumn(graph, board.id, 'Elevation', shadows, chrome, PAD + bottomW + COL_GAP, y3, bottomW)
  addColumn(graph, board.id, 'Spacing', spacing, chrome, PAD + 2 * (bottomW + COL_GAP), y3, bottomW)

  return board.id
}

export function createSmylrTokensDesignPage(graph: SceneGraph, pageNode: SceneNode): string {
  graph.updateNode(pageNode.id, {
    name: 'Design System',
    pluginData: [
      pluginData('kind', SMYLR_TOKENS_PAGE_KIND),
      pluginData('pageId', SMYLR_TOKENS_PAGE_ID)
    ]
  })

  const boardGap = 56
  const lightId = buildThemeBoard(graph, pageNode.id, LIGHT, 48, 64)
  const lightNode = graph.getNode(lightId)
  const lightW = lightNode?.width ?? 1100
  buildThemeBoard(graph, pageNode.id, DARK, 48 + lightW + boardGap, 64)

  return lightId
}

export function isSmylrTokensPageNode(node: SceneNode | null | undefined): boolean {
  if (!node) return false
  return node.pluginData.some(
    (entry) =>
      entry.pluginId === PLUGIN_ID &&
      entry.key === 'kind' &&
      entry.value === SMYLR_TOKENS_PAGE_KIND
  )
}

// Vite HMR: when THIS file saves, tell the editor to rebuild boards in place.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('smylr-foundations-hmr', { detail: 'tokens' }))
    }
  })
}
