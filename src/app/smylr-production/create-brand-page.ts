import { IS_BROWSER } from '@open-pencil/core/constants'
/**
 * Brand Guidelines board — from real Smylr brand sources:
 *   public/brand/* (icon, wordmark, lockup light/dark)
 *   public/brand/preview.html
 *   src/assets/smylr-brand-paths.ts
 *   DESIGN.md visual thesis
 *
 * Not the design-token grid (Design System page).
 */
import type { Color, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { DEMO_COLORS, gradient, solid, thinStroke } from '../demo/colors'
import { dropShadow } from '../demo/effects'

export const SMYLR_BRAND_PAGE_ID = 'smylr-brand'
export const SMYLR_BRAND_PAGE_KIND = 'smylr-brand-page'
export const SMYLR_BRAND_BOARD_KIND = 'smylr-brand-board'

const PLUGIN_ID = 'smylr-production'
const DEFAULT_FONT_FAMILY = 'Inter'

/** Brand board palette from public/brand/preview.html + icon SVGs */
const BRAND = {
  ink: { r: 0.082, g: 0.22, b: 0.392, a: 1 } satisfies Color, // #153864
  deep: { r: 0.043, g: 0.122, b: 0.239, a: 1 } satisfies Color, // #0b1f3d
  muted: { r: 0.392, g: 0.455, b: 0.545, a: 1 } satisfies Color, // #64748b
  line: { r: 0.859, g: 0.906, b: 0.953, a: 1 } satisfies Color, // #dbe7f3
  page: { r: 0.965, g: 0.976, b: 0.988, a: 1 } satisfies Color, // #f6f9fc
  card: { r: 1, g: 1, b: 1, a: 1 } satisfies Color,
  periwinkle: { r: 0.788, g: 0.898, b: 1, a: 1 } satisfies Color, // #c9e5ff
  sky: { r: 0.608, g: 0.831, b: 1, a: 1 } satisfies Color, // #9bd4ff
  blue: { r: 0.451, g: 0.745, b: 0.988, a: 1 } satisfies Color, // #73befc
  iconShadow: { r: 0.004, g: 0.247, b: 0.412, a: 0.05 } satisfies Color, // #013F69 @5%
  success: { r: 0, g: 0.659, b: 0.332, a: 1 } satisfies Color,
  warning: { r: 0.902, g: 0.675, b: 0.239, a: 1 } satisfies Color,
  danger: { r: 0.741, g: 0.255, b: 0.246, a: 1 } satisfies Color,
  primaryCss: { r: 0.06, g: 0.378, b: 0.98, a: 1 } satisfies Color
}

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { pluginId: PLUGIN_ID, key, value }
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
  maxWidth = 640
) {
  const approxW = Math.min(maxWidth, Math.max(24, Math.ceil(text.length * fontSize * 0.55)))
  return graph.createNode('TEXT', parentId, {
    x,
    y,
    width: approxW,
    height: Math.ceil(fontSize * 1.35),
    name: text.slice(0, 64),
    text,
    fontSize,
    fontWeight,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    fills: [solid(color)]
  })
}

/** Approximate app icon from public/brand/icon-light.svg (gradient tile + smile). */
function addSmylrIconMark(
  graph: SceneGraph,
  parentId: string,
  x: number,
  y: number,
  size: number,
  name: string
) {
  const tile = graph.createNode('FRAME', parentId, {
    x,
    y,
    width: size,
    height: size * (74 / 70),
    name,
    fills: [],
    cornerRadius: size * 0.22
  })
  // Soft shadow plate
  graph.createNode('RECTANGLE', tile.id, {
    x: size * 0.04,
    y: size * 0.05,
    width: size * 0.92,
    height: size * 0.92,
    name: 'Icon shadow plate',
    fills: [solid(BRAND.iconShadow)],
    cornerRadius: size * 0.2
  })
  // Gradient face (#C9E5FF → #73BEFC)
  graph.createNode('RECTANGLE', tile.id, {
    x: size * 0.03,
    y: size * 0.02,
    width: size * 0.94,
    height: size * 0.94,
    name: 'Icon face',
    fills: [
      gradient([
        { color: BRAND.periwinkle, position: 0 },
        { color: BRAND.blue, position: 1 }
      ])
    ],
    cornerRadius: size * 0.2
  })
  // Smile (simplified as white arc-ish ellipse cut)
  graph.createNode('ELLIPSE', tile.id, {
    x: size * 0.22,
    y: size * 0.52,
    width: size * 0.56,
    height: size * 0.28,
    name: 'Smile',
    fills: [solid(DEMO_COLORS.white)]
  })
  graph.createNode('ELLIPSE', tile.id, {
    x: size * 0.22,
    y: size * 0.42,
    width: size * 0.56,
    height: size * 0.28,
    name: 'Smile cut',
    fills: [
      gradient([
        { color: BRAND.periwinkle, position: 0 },
        { color: BRAND.blue, position: 1 }
      ])
    ]
  })
  return tile.id
}

export function createSmylrBrandDesignPage(graph: SceneGraph, pageNode: SceneNode): string {
  graph.updateNode(pageNode.id, {
    name: 'Brand Guidelines',
    pluginData: [
      pluginData('kind', SMYLR_BRAND_PAGE_KIND),
      pluginData('pageId', SMYLR_BRAND_PAGE_ID)
    ]
  })

  const pad = 36
  const boardW = 1240
  const boardH = 860

  const board = graph.createNode('SECTION', pageNode.id, {
    x: 32,
    y: 56,
    width: boardW,
    height: boardH,
    name: 'Brand Guidelines',
    fills: [solid(BRAND.page)],
    strokes: thinStroke(BRAND.line),
    cornerRadius: 8,
    pluginData: [
      pluginData('kind', SMYLR_BRAND_BOARD_KIND),
      pluginData('pageId', SMYLR_BRAND_PAGE_ID)
    ]
  })

  addText(graph, board.id, 'SMYLR BRAND', pad, 16, 11, 700, BRAND.muted, 200)
  addText(graph, board.id, 'Brand Guidelines', pad, 36, 22, 700, BRAND.ink, 400)
  addText(
    graph,
    board.id,
    'Sources: public/brand/* · public/brand/preview.html · src/assets/smylr-brand-paths.ts · DESIGN.md',
    pad,
    66,
    11,
    400,
    BRAND.muted,
    boardW - pad * 2
  )

  // —— Logo / mark ——
  addText(graph, board.id, 'Logo system', pad, 100, 14, 700, BRAND.ink, 200)

  // Light lockup card
  const lightCard = graph.createNode('FRAME', board.id, {
    x: pad,
    y: 128,
    width: 360,
    height: 200,
    name: 'Lockup · light',
    fills: [solid(BRAND.card)],
    strokes: thinStroke(BRAND.line),
    cornerRadius: 16,
    effects: [dropShadow(0, 12, 32, -4, { r: 0.082, g: 0.22, b: 0.392, a: 0.08 })]
  })
  addSmylrIconMark(graph, lightCard.id, 24, 36, 72, 'Icon light')
  addText(graph, lightCard.id, 'Smylr', 120, 56, 36, 700, BRAND.ink, 200)
  addText(graph, lightCard.id, 'Light lockup', 120, 104, 12, 400, BRAND.muted, 200)
  addText(graph, lightCard.id, 'public/brand/lockup-light.svg', 24, 160, 11, 400, BRAND.muted, 300)
  addText(graph, lightCard.id, 'public/brand/icon-light.svg', 24, 176, 11, 400, BRAND.muted, 300)

  // Dark lockup card
  const darkCard = graph.createNode('FRAME', board.id, {
    x: pad + 380,
    y: 128,
    width: 360,
    height: 200,
    name: 'Lockup · dark',
    fills: [solid(BRAND.deep)],
    cornerRadius: 16,
    effects: [dropShadow(0, 12, 32, -4, { r: 0, g: 0, b: 0, a: 0.3 })]
  })
  addSmylrIconMark(graph, darkCard.id, 24, 36, 72, 'Icon dark')
  addText(graph, darkCard.id, 'Smylr', 120, 56, 36, 700, DEMO_COLORS.white, 200)
  addText(graph, darkCard.id, 'Dark lockup', 120, 104, 12, 400, BRAND.sky, 200)
  addText(graph, darkCard.id, 'public/brand/lockup-dark.svg', 24, 160, 11, 400, BRAND.sky, 300)
  addText(graph, darkCard.id, 'public/brand/icon-dark.svg', 24, 176, 11, 400, BRAND.sky, 300)

  // Asset inventory
  const assetsX = pad + 760
  addText(graph, board.id, 'Brand files', assetsX, 100, 14, 700, BRAND.ink, 200)
  const assets = [
    'public/brand/icon-light.svg',
    'public/brand/icon-dark.svg',
    'public/brand/wordmark-light.svg',
    'public/brand/wordmark-dark.svg',
    'public/brand/lockup-light.svg',
    'public/brand/lockup-dark.svg',
    'public/brand/preview.html',
    'src/assets/smylr-brand-paths.ts',
    'src/assets/logo.tsx'
  ]
  assets.forEach((line, i) => {
    addText(graph, board.id, line, assetsX, 128 + i * 22, 12, 400, BRAND.ink, 400)
  })

  // —— Brand colors (from preview.html + product primary) ——
  addText(graph, board.id, 'Brand palette', pad, 360, 14, 700, BRAND.ink, 200)
  const palette: Array<{ label: string; meta: string; color: Color }> = [
    { label: 'Ink', meta: '#153864 · brand ink', color: BRAND.ink },
    { label: 'Deep', meta: '#0b1f3d · dark ground', color: BRAND.deep },
    { label: 'Periwinkle', meta: '#c9e5ff · icon top', color: BRAND.periwinkle },
    { label: 'Sky', meta: '#9bd4ff · brand mid', color: BRAND.sky },
    { label: 'Blue', meta: '#73befc · icon bottom', color: BRAND.blue },
    { label: 'Primary CSS', meta: '--primary · product', color: BRAND.primaryCss }
  ]
  palette.forEach((c, i) => {
    const x = pad + i * 190
    const card = graph.createNode('FRAME', board.id, {
      x,
      y: 390,
      width: 176,
      height: 132,
      name: `${c.label} · ${c.meta}`,
      fills: [solid(BRAND.card)],
      strokes: thinStroke(BRAND.line),
      cornerRadius: 12
    })
    graph.createNode('RECTANGLE', card.id, {
      x: 12,
      y: 12,
      width: 152,
      height: 64,
      name: `Swatch · ${c.label}`,
      fills: [solid(c.color)],
      cornerRadius: 8
    })
    addText(graph, card.id, c.label, 12, 86, 12, 700, BRAND.ink, 150)
    addText(graph, card.id, c.meta, 12, 106, 10, 400, BRAND.muted, 150)
  })

  // —— Visual thesis ——
  addText(graph, board.id, 'Visual thesis · DESIGN.md', pad, 550, 14, 700, BRAND.ink, 320)
  addText(
    graph,
    board.id,
    'Dense, clinical, data-rich interfaces that feel premium but heavily understated. Muted grays and multi-layer shadows create depth; high-chroma color is reserved for status only. Chrome stays monochromatic so the data shines.',
    pad,
    578,
    13,
    400,
    BRAND.ink,
    560
  )

  // Status rule
  addText(
    graph,
    board.id,
    'Status color — only when needed',
    pad + 600,
    550,
    14,
    700,
    BRAND.ink,
    360
  )
  const statuses = [
    { label: 'Success', meta: '--success', color: BRAND.success },
    { label: 'Warning', meta: '--warning', color: BRAND.warning },
    { label: 'Danger', meta: '--destructive', color: BRAND.danger }
  ]
  statuses.forEach((s, i) => {
    const x = pad + 600 + i * 150
    const card = graph.createNode('FRAME', board.id, {
      x,
      y: 580,
      width: 136,
      height: 88,
      name: `${s.label} · ${s.meta}`,
      fills: [solid(BRAND.card)],
      strokes: thinStroke(BRAND.line),
      cornerRadius: 10
    })
    graph.createNode('RECTANGLE', card.id, {
      x: 10,
      y: 10,
      width: 116,
      height: 32,
      name: `Swatch · ${s.label}`,
      fills: [solid(s.color)],
      cornerRadius: 6
    })
    addText(graph, card.id, s.label, 10, 50, 12, 700, BRAND.ink, 110)
    addText(graph, card.id, s.meta, 10, 66, 10, 400, BRAND.muted, 110)
  })

  // Type + principles
  addText(graph, board.id, 'Typography · Quicksand', pad, 700, 14, 700, BRAND.ink, 280)
  addText(
    graph,
    board.id,
    'font-sans / font-display → Quicksand. Prefer text-xs · text-sm · font-medium · font-semibold. Paths: src/assets/smylr-brand-paths.ts',
    pad,
    728,
    12,
    400,
    BRAND.muted,
    560
  )

  addText(graph, board.id, 'Principles', pad + 600, 700, 14, 700, BRAND.ink, 160)
  const principles = [
    'Do: brand SVGs from public/brand (light/dark pairs)',
    'Do: semantic product tokens via Design System page',
    'Don’t: invent hex in components — use CSS variables',
    'Don’t: use status chroma for chrome decoration'
  ]
  principles.forEach((line, i) => {
    addText(graph, board.id, line, pad + 600, 728 + i * 22, 12, 400, BRAND.ink, 520)
  })

  addText(
    graph,
    board.id,
    'Open brand board HTML: /brand/preview.html  ·  Token page: Design System (smylr-tokens)',
    pad,
    820,
    11,
    400,
    BRAND.muted,
    boardW - pad * 2
  )

  return board.id
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    if (IS_BROWSER) {
      window.dispatchEvent(new CustomEvent('smylr-foundations-hmr', { detail: 'brand' }))
    }
  })
}
