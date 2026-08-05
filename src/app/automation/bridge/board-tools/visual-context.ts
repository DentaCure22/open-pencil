import { wcagContrast } from 'culori'

import { BLACK, DEFAULT_FONT_FAMILY, IS_BROWSER } from '@open-pencil/core/constants'
import type { Fill, SceneNode } from '@open-pencil/scene-graph'
import type { Color, Rect } from '@open-pencil/scene-graph/primitives'

import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'
import { editorViewportInsets, visibleElementRect } from '@/app/editor/viewport-insets'

import { nativeTextFits, type NativeTextOperation } from './native/text'
import { nodeBounds } from './readback'

export const LOCAL_LEGIBLE_TEXT_PROFILE = 'local-legible-text-v1' as const
export const MINIMUM_LEGIBLE_SCREEN_TEXT_SIZE = 11

const MINIMUM_TEXT_CONTRAST = 4.5
const MAX_NEARBY_TEXT_STYLES = 3
const WHITE = { ...BLACK, b: 1, g: 1, r: 1 } satisfies Color

export type LocalLegibleTextProfile = typeof LOCAL_LEGIBLE_TEXT_PROFILE

type CompatibleTextStyle = {
  distance: number
  fill: Fill
  node: SceneNode
}

type BoardViewportSnapshot = {
  canvasCss: Rect
  cssPixelsPerBoardUnit: number
  usableBoard: Rect
  usableCss: Rect
}

export type LocalLegibleTextPlan = {
  context: Record<string, unknown>
  nodeProps: Pick<
    SceneNode,
    'fills' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic' | 'letterSpacing' | 'lineHeight'
  >
  profile: LocalLegibleTextProfile
  styleResolution: Record<string, unknown>
}

export type VisualPresentationEvidence = {
  acknowledged: boolean
  frame?: { scene_version: number }
}

type ObservableAppearance = 'dark' | 'light' | 'unknown'

function colorContrast(left: Color, right: Color): number {
  return wcagContrast({ mode: 'rgb', ...left }, { mode: 'rgb', ...right })
}

function opaqueColor(color: Color): Color {
  return { r: color.r, g: color.g, b: color.b, a: 1 }
}

function observableAppearance(value: unknown): ObservableAppearance {
  return value === 'dark' || value === 'light' ? value : 'unknown'
}

function uiAppearanceSnapshot() {
  const unavailable = () => ({
    color_scheme: 'unknown' as const,
    source: 'headless_unavailable' as const,
    theme: 'unknown' as const
  })
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') {
    return unavailable()
  }
  const rootValue: unknown = Reflect.get(document, 'documentElement')
  if (!(rootValue instanceof HTMLElement)) {
    return unavailable()
  }
  const root = rootValue
  const inlineColorScheme = root.style.colorScheme.trim()
  const computedColorScheme =
    inlineColorScheme || typeof getComputedStyle !== 'function'
      ? inlineColorScheme
      : getComputedStyle(root).colorScheme
  return {
    color_scheme: observableAppearance(computedColorScheme),
    source: 'document.documentElement' as const,
    theme: observableAppearance(root.dataset.theme)
  }
}

function pageSurfaceSnapshot(target: AutomationTarget) {
  return {
    background: opaqueColor(target.store.state.pageColor),
    kind: 'solid_page' as const,
    source: 'editor.state.pageColor' as const
  }
}

export function boardAppearanceSnapshot(target: AutomationTarget) {
  return {
    surface: pageSurfaceSnapshot(target),
    ui: uiAppearanceSnapshot()
  }
}

function fullyOpaqueSolidFill(node: SceneNode): Fill | null {
  const fill = node.fills.find(
    (candidate) =>
      candidate.type === 'SOLID' &&
      candidate.visible &&
      candidate.opacity * candidate.color.a * node.opacity >= 0.999
  )
  return fill ?? null
}

function solidFill(color: Color): Fill {
  return {
    color: opaqueColor(color),
    opacity: 1,
    type: 'SOLID',
    visible: true
  }
}

function centerDistance(left: Rect, right: Rect): number {
  const leftX = left.x + left.width / 2
  const leftY = left.y + left.height / 2
  const rightX = right.x + right.width / 2
  const rightY = right.y + right.height / 2
  return Math.hypot(leftX - rightX, leftY - rightY)
}

function compatibleTextStyles(target: AutomationTarget, anchorId: string): CompatibleTextStyle[] {
  const anchor = target.store.graph.getNode(anchorId)
  if (!anchor) return []
  const anchorBounds = nodeBounds(target, anchor)
  return [...target.store.graph.getDescendants(target.pageId)]
    .flatMap((node): CompatibleTextStyle[] => {
      if (node.type !== 'TEXT' || !node.visible || node.width <= 0 || node.height <= 0) return []
      const fill = fullyOpaqueSolidFill(node)
      if (!fill) return []
      return [
        {
          distance:
            node.id === anchorId ? 0 : centerDistance(anchorBounds, nodeBounds(target, node)),
          fill,
          node
        }
      ]
    })
    .sort((left, right) => {
      const leftIsAnchor = left.node.id === anchorId
      const rightIsAnchor = right.node.id === anchorId
      if (leftIsAnchor !== rightIsAnchor) return leftIsAnchor ? -1 : 1
      return left.distance - right.distance || left.node.id.localeCompare(right.node.id)
    })
    .slice(0, MAX_NEARBY_TEXT_STYLES)
}

function canvasCssBounds(): Rect {
  const canvas = visibleElementRect('[data-test-id="canvas-area"]')
  if (canvas) {
    return { height: canvas.height, width: canvas.width, x: canvas.left, y: canvas.top }
  }
  return {
    height: IS_BROWSER ? window.innerHeight : 600,
    width: IS_BROWSER ? window.innerWidth : 800,
    x: 0,
    y: 0
  }
}

function viewportSnapshot(target: AutomationTarget): BoardViewportSnapshot {
  const canvasCss = canvasCssBounds()
  const insets = editorViewportInsets()
  const left = Math.max(0, insets.left ?? 0)
  const right = Math.max(0, insets.right ?? 0)
  const top = Math.max(0, insets.top ?? 0)
  const bottom = Math.max(0, insets.bottom ?? 0)
  const relativeUsable = {
    height: Math.max(1, canvasCss.height - top - bottom),
    width: Math.max(1, canvasCss.width - left - right),
    x: left,
    y: top
  }
  const zoom = target.store.state.zoom
  return {
    canvasCss,
    cssPixelsPerBoardUnit: zoom,
    usableBoard: {
      height: relativeUsable.height / zoom,
      width: relativeUsable.width / zoom,
      x: (relativeUsable.x - target.store.state.panX) / zoom,
      y: (relativeUsable.y - target.store.state.panY) / zoom
    },
    usableCss: {
      height: relativeUsable.height,
      width: relativeUsable.width,
      x: canvasCss.x + relativeUsable.x,
      y: canvasCss.y + relativeUsable.y
    }
  }
}

function viewportResult(snapshot: BoardViewportSnapshot) {
  return {
    canvas_css: snapshot.canvasCss,
    css_pixels_per_board_unit: snapshot.cssPixelsPerBoardUnit,
    usable_board: snapshot.usableBoard,
    usable_css: snapshot.usableCss
  }
}

function nearbyStyleResult(style: CompatibleTextStyle, surface: Color) {
  const foreground = opaqueColor(style.fill.color)
  return {
    distance_from_anchor: style.distance,
    foreground,
    node_id: style.node.id,
    style: {
      font_family: style.node.fontFamily,
      font_size: style.node.fontSize,
      font_weight: style.node.fontWeight,
      italic: style.node.italic,
      letter_spacing: style.node.letterSpacing,
      line_height: style.node.lineHeight
    },
    surface_contrast_ratio: colorContrast(foreground, surface)
  }
}

function readableForeground(preferred: Color | null, surface: Color) {
  if (preferred && colorContrast(preferred, surface) >= MINIMUM_TEXT_CONTRAST) {
    return { color: opaqueColor(preferred), source: 'sampled_text_style' }
  }
  const blackContrast = colorContrast(BLACK, surface)
  const whiteContrast = colorContrast(WHITE, surface)
  return {
    color: whiteContrast >= blackContrast ? WHITE : BLACK,
    source: 'page_contrast_fallback'
  }
}

function resolvedTypographySource(
  source: CompatibleTextStyle | undefined,
  anchorId: string | undefined
): 'native_default' | 'nearest_text' | 'selected_text' {
  if (!source) return 'native_default'
  return source.node.id === anchorId ? 'selected_text' : 'nearest_text'
}

function resolveTextNodeProps(
  operation: Pick<NativeTextOperation, 'explicitFontSize' | 'fontSize'>,
  source: CompatibleTextStyle | undefined,
  surface: Color
) {
  const foreground = readableForeground(source ? opaqueColor(source.fill.color) : null, surface)
  const resolvedFontSize = operation.explicitFontSize
    ? operation.fontSize
    : (source?.node.fontSize ?? operation.fontSize)
  const typographyScale =
    source && source.node.fontSize > 0 ? resolvedFontSize / source.node.fontSize : 1
  const sourceLineHeight = source?.node.lineHeight
  const nodeProps: LocalLegibleTextPlan['nodeProps'] = {
    fills: [solidFill(foreground.color)],
    fontFamily: source?.node.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontSize: resolvedFontSize,
    fontWeight: source?.node.fontWeight ?? 400,
    italic: source?.node.italic ?? false,
    letterSpacing: (source?.node.letterSpacing ?? 0) * typographyScale,
    lineHeight:
      sourceLineHeight === null || sourceLineHeight === undefined
        ? null
        : sourceLineHeight * typographyScale
  }
  return { colorSource: foreground.source, nodeProps }
}

export function parseLocalLegibleTextProfile(value: unknown): LocalLegibleTextProfile | null {
  if (value === undefined) return null
  if (!isUnknownRecord(value) || value.profile !== LOCAL_LEGIBLE_TEXT_PROFILE) {
    throw new Error(
      `visual.profile must be "${LOCAL_LEGIBLE_TEXT_PROFILE}" when visual context is requested.`
    )
  }
  return LOCAL_LEGIBLE_TEXT_PROFILE
}

export function createLocalLegibleTextPlan(
  target: AutomationTarget,
  operation: Pick<NativeTextOperation, 'explicitFontSize' | 'fontSize' | 'placementTarget'>
): LocalLegibleTextPlan {
  const surfaceAppearance = pageSurfaceSnapshot(target)
  const surface = surfaceAppearance.background
  const anchorId =
    operation.placementTarget.kind === 'anchor'
      ? operation.placementTarget.anchorId
      : operation.placementTarget.kind === 'relative'
        ? operation.placementTarget.objectId
        : undefined
  const nearby = anchorId ? compatibleTextStyles(target, anchorId) : []
  const source = nearby.at(0)
  const { colorSource, nodeProps } = resolveTextNodeProps(operation, source, surface)
  const typographySource = resolvedTypographySource(source, anchorId)

  return {
    context: {
      nearby_text_styles: nearby.map((style) => nearbyStyleResult(style, surface)),
      page_id: target.pageId,
      profile: LOCAL_LEGIBLE_TEXT_PROFILE,
      surface: surfaceAppearance,
      viewport: viewportResult(viewportSnapshot(target))
    },
    nodeProps,
    profile: LOCAL_LEGIBLE_TEXT_PROFILE,
    styleResolution: {
      color_source: colorSource,
      font_size_source: operation.explicitFontSize ? 'explicit_request' : typographySource,
      resolved: {
        fill: nodeProps.fills[0],
        font_family: nodeProps.fontFamily,
        font_size: nodeProps.fontSize,
        font_weight: nodeProps.fontWeight,
        italic: nodeProps.italic,
        letter_spacing: nodeProps.letterSpacing,
        line_height: nodeProps.lineHeight
      },
      source_node_id: source?.node.id,
      typography_source: typographySource
    }
  }
}

function intersectionArea(left: Rect, right: Rect): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  )
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  )
  return width * height
}

export function verifyLocalLegibleText(
  target: AutomationTarget,
  node: SceneNode,
  presentation: VisualPresentationEvidence,
  requiredSceneRevision: number
) {
  const viewport = viewportSnapshot(target)
  const bounds = nodeBounds(target, node)
  const screenBounds = {
    height: bounds.height * target.store.state.zoom,
    width: bounds.width * target.store.state.zoom,
    x: viewport.canvasCss.x + bounds.x * target.store.state.zoom + target.store.state.panX,
    y: viewport.canvasCss.y + bounds.y * target.store.state.zoom + target.store.state.panY
  }
  const area = Math.max(1, screenBounds.width * screenBounds.height)
  const visibleFraction = intersectionArea(screenBounds, viewport.usableCss) / area
  const surface = opaqueColor(target.store.state.pageColor)
  const fill = fullyOpaqueSolidFill(node)
  const foreground = fill ? opaqueColor(fill.color) : null
  const contrastRatio = foreground ? colorContrast(foreground, surface) : 0
  const effectiveTextSize = node.fontSize * target.store.state.zoom
  const textFits = nativeTextFits(node)
  const renderedSceneRevision = presentation.frame?.scene_version
  let status: 'failed' | 'not-proven' | 'passed' | 'render-timeout'
  if (!presentation.acknowledged) status = 'render-timeout'
  else if (renderedSceneRevision === undefined || renderedSceneRevision < requiredSceneRevision) {
    status = 'not-proven'
  } else if (
    contrastRatio < MINIMUM_TEXT_CONTRAST ||
    effectiveTextSize < MINIMUM_LEGIBLE_SCREEN_TEXT_SIZE ||
    !textFits ||
    visibleFraction < 0.99
  ) {
    status = 'failed'
  } else {
    status = 'passed'
  }

  return {
    contrast_ratio: contrastRatio,
    effective_text_size_css_px: effectiveTextSize,
    foreground,
    node_id: node.id,
    rendered_scene_revision: renderedSceneRevision,
    required_scene_revision: requiredSceneRevision,
    screen_bounds: screenBounds,
    status,
    surface,
    text_fits: textFits,
    usable_viewport_css: viewport.usableCss,
    visible_fraction: visibleFraction
  }
}
