import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode,
  SmylrLiveContainerRect,
  SmylrLiveContainerSource
} from './types'

type IntentEdges = {
  bottom: number
  left: number
  right: number
  top: number
}

type IntentRect = {
  height: number
  width: number
  x: number
  y: number
}

type IntentTarget = {
  ariaLabel?: string
  className?: string
  componentChain?: string[]
  componentName?: string
  role?: string
  selector?: string
  source?: SmylrLiveContainerSource
  tag?: string
}

type IntentChildBox = {
  label: string
  rect: IntentRect
}

type IntentAncestor = {
  background?: string
  borderColor?: string
  gap: string
  label: string
  overflow?: string
  padding: IntentEdges
  radius?: string
  rect: IntentRect
  shadow?: string
}

type IntentLayout = {
  alignItems: string
  flexDirection: string
  flexWrap: string
  gridAutoFlow: string
  gridTemplateColumns: string
  gridTemplateRows: string
  justifyContent: string
}

export type SmylrIntentMeasurement = {
  ancestors: IntentAncestor[]
  background?: string
  border: IntentEdges
  capturedAt: string
  childBoxes: IntentChildBox[]
  className?: string
  color?: string
  display: string
  gap: string
  label: string
  layout?: IntentLayout
  opacity?: string
  overflow: string
  padding: IntentEdges
  pointerEvents?: string
  position: string
  prompt?: string
  radius: string
  rect: IntentRect
  route: string
  shadow: string
  target: IntentTarget
  typography: {
    fontSize: string
    fontWeight: string
    lineHeight: string
  }
  zIndex: string
}

function px(value: number) {
  return `${Math.round(value)}px`
}

function relativeRect(rect: IntentRect, parent?: IntentRect): SmylrLiveContainerRect {
  return {
    height: Math.max(1, Math.round(rect.height)),
    width: Math.max(1, Math.round(rect.width)),
    x: parent ? Math.round(rect.x - parent.x) : 0,
    y: parent ? Math.round(rect.y - parent.y) : 0
  }
}

function edgeStyle(prefix: 'border' | 'padding', edges: IntentEdges) {
  const suffix = prefix === 'border' ? '-width' : ''

  if (
    edges.top === edges.right &&
    edges.right === edges.bottom &&
    edges.bottom === edges.left
  ) {
    return {
      [prefix === 'border' ? 'border-width' : 'padding']: px(edges.top)
    }
  }

  return {
    [`${prefix}-bottom${suffix}`]: px(edges.bottom),
    [`${prefix}-left${suffix}`]: px(edges.left),
    [`${prefix}-right${suffix}`]: px(edges.right),
    [`${prefix}-top${suffix}`]: px(edges.top)
  }
}

function overflowStyle(overflow: string | undefined) {
  if (!overflow) return {}

  const [x, y] = overflow.split('/').map((part) => part.trim())
  const values = [x, y].filter(Boolean)

  if (values.includes('hidden') || values.includes('clip')) {
    return { overflow: 'hidden' }
  }

  if (x && y && x === y) return { overflow: x }
  if (x && !y) return { overflow: x }

  return {
    'overflow-x': x,
    'overflow-y': y
  }
}

function usefulStyleEntries(style: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(style).filter((entry): entry is [string, string] => {
      const value = entry[1]?.trim()
      return Boolean(value && value !== 'auto' && value !== 'normal' && value !== 'none')
    })
  )
}

function targetSource(target: IntentTarget): SmylrLiveContainerSource | undefined {
  if (target.source) return target.source
  if (!target.componentName) return undefined

  return {
    componentName: target.componentName
  }
}

function slugFor(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'container'
}

function tokenHintsFrom(className: string | undefined) {
  if (!className) return []

  return className
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function selectedStyleFor(measurement: SmylrIntentMeasurement) {
  return usefulStyleEntries({
    ...edgeStyle('padding', measurement.padding),
    ...edgeStyle('border', measurement.border),
    ...overflowStyle(measurement.overflow),
    'align-items': measurement.layout?.alignItems,
    'background-color': measurement.background,
    color: measurement.color,
    display: measurement.display,
    'flex-direction': measurement.layout?.flexDirection,
    'flex-wrap': measurement.layout?.flexWrap,
    'font-size': measurement.typography.fontSize,
    'font-weight': measurement.typography.fontWeight,
    gap: measurement.gap,
    'grid-auto-flow': measurement.layout?.gridAutoFlow,
    'grid-template-columns': measurement.layout?.gridTemplateColumns,
    'grid-template-rows': measurement.layout?.gridTemplateRows,
    'justify-content': measurement.layout?.justifyContent,
    'line-height': measurement.typography.lineHeight,
    opacity: measurement.opacity,
    'pointer-events': measurement.pointerEvents,
    position: measurement.position,
    'border-radius': measurement.radius,
    'box-shadow': measurement.shadow,
    'z-index': measurement.zIndex
  })
}

function ancestorStyleFor(ancestor: IntentAncestor) {
  return usefulStyleEntries({
    ...edgeStyle('padding', ancestor.padding),
    ...overflowStyle(ancestor.overflow),
    'background-color': ancestor.background,
    'border-color': ancestor.borderColor,
    'border-radius': ancestor.radius,
    'box-shadow': ancestor.shadow,
    gap: ancestor.gap,
    position: 'relative'
  })
}

function childNodeFor(child: IntentChildBox, parentRect: IntentRect): SmylrLiveContainerNode {
  return {
    id: `child-${slugFor(child.label)}`,
    label: child.label,
    rect: relativeRect(child.rect, parentRect),
    tagName: 'div'
  }
}

function selectedNodeFor(
  measurement: SmylrIntentMeasurement,
  parentRect?: IntentRect
): SmylrLiveContainerNode {
  const className = measurement.className ?? measurement.target.className
  const label = measurement.label || measurement.target.ariaLabel || 'Selected container'

  return {
    attrs: {
      'data-smylr-selector': measurement.target.selector ?? ''
    },
    children: measurement.childBoxes.map((child) => childNodeFor(child, measurement.rect)),
    className,
    computedStyle: selectedStyleFor(measurement),
    id: `selected-${slugFor(label)}`,
    label,
    rect: relativeRect(measurement.rect, parentRect),
    role: measurement.target.role,
    source: targetSource(measurement.target),
    tagName: measurement.target.tag ?? 'div',
    tokenHints: tokenHintsFrom(className)
  }
}

function ancestorNodeFor({
  ancestor,
  child,
  index,
  parentRect
}: {
  ancestor: IntentAncestor
  child: SmylrLiveContainerNode
  index: number
  parentRect?: IntentRect
}): SmylrLiveContainerNode {
  return {
    children: [child],
    computedStyle: ancestorStyleFor(ancestor),
    id: `ancestor-${index + 1}-${slugFor(ancestor.label)}`,
    label: ancestor.label,
    rect: relativeRect(ancestor.rect, parentRect),
    tagName: 'div'
  }
}

function buildTree(measurement: SmylrIntentMeasurement) {
  let child = selectedNodeFor(measurement, measurement.ancestors[0]?.rect)

  for (let index = 0; index < measurement.ancestors.length; index += 1) {
    const ancestor = measurement.ancestors[index]
    child = ancestorNodeFor({
      ancestor,
      child,
      index,
      parentRect: measurement.ancestors[index + 1]?.rect
    })
  }

  return child
}

function ownerMapTextFor(measurement: SmylrIntentMeasurement) {
  const lines = [
    `Selected: ${measurement.label}`,
    `Route: ${measurement.route}`,
    measurement.target.selector ? `Selector: ${measurement.target.selector}` : '',
    measurement.target.source?.filePath
      ? `Source: ${measurement.target.source.filePath}${
          measurement.target.source.lineNumber ? `:${measurement.target.source.lineNumber}` : ''
        }`
      : '',
    ...measurement.ancestors.map(
      (ancestor, index) =>
        `${index + 1}. ${ancestor.label} (${Math.round(ancestor.rect.width)}x${Math.round(
          ancestor.rect.height
        )})`
    )
  ].filter(Boolean)

  return lines.join('\n')
}

export function smylrIntentMeasurementToLiveContainerDocument(
  measurement: SmylrIntentMeasurement
): SmylrLiveContainerDocument {
  const tree = buildTree(measurement)

  return {
    capturedAt: measurement.capturedAt,
    ownerMapText: ownerMapTextFor(measurement),
    route: measurement.route,
    selectedId: `selected-${slugFor(measurement.label)}`,
    title: measurement.label,
    tree
  }
}
