import { parseColor } from '@open-pencil/core/color'
import type { DesignStyleDeclaration } from '@open-pencil/dom-css'
import { sceneNodeToStyle } from '@open-pencil/dom-css/browser'
import type { SceneGraph, SceneNode, VariableType, VariableValue } from '@open-pencil/scene-graph'

import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode,
  SmylrLiveSemanticToken,
  SmylrLiveTokenProvenance
} from '@/app/smylr-live-container/types'

type TokenVariable = {
  token: SmylrLiveSemanticToken
  variableId: string
}

const RESET_VALUES: Record<string, string> = {
  'align-items': 'stretch',
  'align-self': 'auto',
  background: 'none',
  'background-color': 'transparent',
  'background-image': 'none',
  border: 'none',
  'border-bottom-color': 'transparent',
  'border-bottom-left-radius': '0px',
  'border-bottom-right-radius': '0px',
  'border-bottom-style': 'none',
  'border-bottom-width': '0px',
  'border-color': 'transparent',
  'border-left-color': 'transparent',
  'border-left-style': 'none',
  'border-left-width': '0px',
  'border-radius': '0px',
  'border-right-color': 'transparent',
  'border-right-style': 'none',
  'border-right-width': '0px',
  'border-style': 'none',
  'border-top-color': 'transparent',
  'border-top-left-radius': '0px',
  'border-top-right-radius': '0px',
  'border-top-style': 'none',
  'border-top-width': '0px',
  'border-width': '0px',
  'box-shadow': 'none',
  'column-gap': '0px',
  display: 'block',
  'flex-direction': 'row',
  'flex-wrap': 'nowrap',
  'font-family': 'inherit',
  'font-size': 'inherit',
  'font-weight': 'inherit',
  gap: '0px',
  'grid-template-columns': 'none',
  'grid-template-rows': 'none',
  'justify-content': 'flex-start',
  'letter-spacing': 'normal',
  'line-height': 'normal',
  opacity: '1',
  overflow: 'visible',
  padding: '0px',
  'padding-block': '0px',
  'padding-bottom': '0px',
  'padding-inline': '0px',
  'padding-left': '0px',
  'padding-right': '0px',
  'padding-top': '0px',
  'row-gap': '0px',
  'text-align': 'start'
}

const POSITION_PROPERTIES = new Set(['left', 'position', 'top'])

function tokenIdentity(token: SmylrLiveSemanticToken) {
  return [
    token.cssProperty,
    token.cssVariable,
    token.styleValue ?? '',
    ...(token.utilities ?? [])
  ].join('|')
}

function parseCSSLengthToPixels(raw: string | undefined): number | null {
  if (!raw) return null
  const value = raw.replace(/\s+/g, ' ').trim()
  if (!value || value === 'none') return null

  const pxMatch = value.match(/^(-?(?:\d+\.?\d*|\.\d+))(px)?$/i)
  if (pxMatch) {
    const number = Number.parseFloat(pxMatch[1])
    return Number.isFinite(number) ? number : null
  }

  const remMatch = value.match(/^(-?(?:\d+\.?\d*|\.\d+))rem$/i)
  if (remMatch) {
    const number = Number.parseFloat(remMatch[1])
    return Number.isFinite(number) ? number * 16 : null
  }

  const calcMatch = value.match(
    /^calc\(\s*(-?(?:\d+\.?\d*|\.\d+))(px|rem)?\s*([+-])\s*(-?(?:\d+\.?\d*|\.\d+))(px|rem)?\s*\)$/i
  )
  if (calcMatch) {
    const left = Number.parseFloat(calcMatch[1]) * (calcMatch[2]?.toLowerCase() === 'rem' ? 16 : 1)
    const right = Number.parseFloat(calcMatch[4]) * (calcMatch[5]?.toLowerCase() === 'rem' ? 16 : 1)
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null
    return calcMatch[3] === '-' ? left - right : left + right
  }

  const firstNumber = value.match(/-?(?:\d+\.?\d*|\.\d+)/)
  if (!firstNumber) return null
  const number = Number.parseFloat(firstNumber[0])
  return Number.isFinite(number) ? number : null
}

function parseColorLoose(raw: string | undefined): VariableValue | null {
  if (!raw) return null
  const value = raw.trim()
  const direct = parseColor(value)
  if (direct) return direct

  const modern = value.match(
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i
  )
  if (!modern) return null

  const alphaRaw = modern[4]
  let alpha = 1
  if (alphaRaw) {
    alpha = alphaRaw.endsWith('%') ? Number.parseFloat(alphaRaw) / 100 : Number.parseFloat(alphaRaw)
  }
  return {
    a: Number.isFinite(alpha) ? alpha : 1,
    b: Number.parseFloat(modern[3]) / 255,
    g: Number.parseFloat(modern[2]) / 255,
    r: Number.parseFloat(modern[1]) / 255
  }
}

function semanticVariableValue(token: SmylrLiveSemanticToken): {
  type: VariableType
  value: VariableValue
} | null {
  if (token.category === 'spacing' || token.category === 'radius') {
    const value = parseCSSLengthToPixels(token.resolvedValue)
    return value !== null ? { type: 'FLOAT', value } : null
  }
  if (token.category === 'shadow') {
    const raw = token.resolvedValue?.trim()
    if (!raw || raw === 'none') return null
    return { type: 'FLOAT', value: 1 }
  }
  if (
    token.category === 'surface' ||
    token.category === 'border' ||
    token.category === 'chart' ||
    token.category === 'status' ||
    token.category === 'text'
  ) {
    const color = parseColorLoose(token.resolvedValue)
    if (color) return { type: 'COLOR', value: color }
    const opacity = parseCSSLengthToPixels(token.resolvedValue)
    if (opacity !== null && opacity <= 1) return { type: 'FLOAT', value: opacity }
    return { type: 'COLOR', value: { r: 0.85, g: 0.85, b: 0.85, a: 1 } }
  }
  return null
}

function matchesProvenance(token: SmylrLiveSemanticToken, provenance: SmylrLiveTokenProvenance) {
  if (token.cssVariable !== provenance.cssVariable) return false
  if (provenance.styleValue) return provenance.styleValue === token.styleValue
  if (provenance.utility) return token.utilities?.includes(provenance.utility) ?? false
  return true
}

// eslint-disable-next-line complexity -- CSS-to-native binding aliases are intentionally explicit.
function bindingPathsForProperty(property: string): string[] {
  if (property === 'background' || property === 'background-color') return ['fills/0/color']
  if (property === 'color') return ['fills/0/color']
  if (property === 'border-color') return ['strokes/0/color']
  if (property === 'border-radius') return ['cornerRadius']
  if (property === 'opacity') return ['opacity']
  if (property === 'box-shadow') return ['effects/0']
  if (property === 'font-size') return ['fontSize']
  if (property === 'font-weight') return ['fontWeight']
  if (property === 'line-height') return ['lineHeight']
  if (property === 'letter-spacing') return ['letterSpacing']
  if (property === 'gap' || property === 'column-gap' || property === 'row-gap') {
    return ['itemSpacing']
  }
  if (property === 'padding') {
    return ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
  }
  if (property.startsWith('padding-')) {
    const suffix = property.slice('padding-'.length)
    const key = `${suffix[0]?.toUpperCase() ?? ''}${suffix.slice(1)}`
    return [`padding${key}`]
  }
  if (property === 'width' || property === 'height') return [property]
  return []
}

function variableTypeForPath(path: string): VariableType {
  if (path.includes('/color') || path.endsWith('color')) return 'COLOR'
  return 'FLOAT'
}

export function seedLiveInspectorSemanticVariables({
  catalog,
  graph,
  node,
  proxy
}: {
  catalog: SmylrLiveSemanticToken[]
  graph: SceneGraph
  node: SmylrLiveContainerNode
  proxy: SceneNode
}) {
  const collection = graph.createCollection('Smylr tokens')
  const tokenByVariableId = new Map<string, SmylrLiveSemanticToken>()
  const variableByTokenIdentity = new Map<string, TokenVariable>()

  for (const token of catalog) {
    const resolved = semanticVariableValue(token)
    if (!resolved) continue
    const variable = graph.createVariable(
      `${token.label} · ${token.cssVariable}`,
      resolved.type,
      collection.id,
      resolved.value
    )
    tokenByVariableId.set(variable.id, token)
    variableByTokenIdentity.set(tokenIdentity(token), { token, variableId: variable.id })
  }

  const boundVariables = { ...proxy.boundVariables }
  for (const provenance of node.tokenProvenance ?? []) {
    const token = catalog.find((candidate) => matchesProvenance(candidate, provenance))
    if (!token) continue
    const tokenVariable = variableByTokenIdentity.get(tokenIdentity(token))
    if (!tokenVariable) continue
    for (const path of bindingPathsForProperty(provenance.cssProperty)) {
      const variable = graph.variables.get(tokenVariable.variableId)
      if (variable?.type === variableTypeForPath(path)) boundVariables[path] = variable.id
    }
  }
  proxy.boundVariables = boundVariables

  return tokenByVariableId
}

export function findLiveInspectorProxyNode(graph: SceneGraph, liveId: string) {
  return [...graph.nodes.values()].find((candidate) => candidate.name === liveId) ?? null
}

/** Live bridge payloads and scene nodes can be Vue proxies, which structuredClone rejects. */
export function cloneLiveInspectorValue<T>(value: T): T {
  // eslint-disable-next-line unicorn/prefer-structured-clone -- Vue proxy payloads are not structured-cloneable.
  return JSON.parse(JSON.stringify(value)) as T
}

function findDocumentNode(root: SmylrLiveContainerNode, id: string): SmylrLiveContainerNode | null {
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const match = findDocumentNode(child, id)
    if (match) return match
  }
  return null
}

export function draftAdjustedLiveInspectorDocument(
  sourceDocument: SmylrLiveContainerDocument,
  sourceNode: SmylrLiveContainerNode,
  styles: Record<string, string>
) {
  const adjusted = cloneLiveInspectorValue(sourceDocument)
  const adjustedNode = findDocumentNode(adjusted.tree, sourceNode.id)
  if (!adjustedNode) return adjusted

  adjustedNode.computedStyle = { ...adjustedNode.computedStyle, ...styles }
  const width = parseCSSLengthToPixels(styles.width)
  const height = parseCSSLengthToPixels(styles.height)
  if (width !== null) adjustedNode.rect.width = Math.max(1, width)
  if (height !== null) adjustedNode.rect.height = Math.max(1, height)
  return adjusted
}

export function findContainingPageId(graph: SceneGraph, start: SceneNode) {
  let current: SceneNode | undefined = start
  while (current) {
    if (current.type === 'CANVAS') return current.id
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return graph.getPages()[0]?.id
}

function pixels(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function cssComponents(value: string | undefined) {
  const normalized = value?.trim()
  if (!normalized || normalized === 'none') return []

  const components: string[] = []
  let component = ''
  let depth = 0
  for (const character of normalized) {
    if (character === '(') depth += 1
    if (character === ')') depth = Math.max(0, depth - 1)
    if (/\s/.test(character) && depth === 0) {
      if (component) components.push(component)
      component = ''
    } else {
      component += character
    }
  }
  if (component) components.push(component)
  return components
}

function offsetCSSLength(value: string, delta: number) {
  if (delta === 0) return value
  const match = value.match(/^(-?(?:\d+\.?\d*|\.\d+))(px)?$/)
  if (match) return `${Number(match[1]) + delta}px`
  return `calc(${value} + ${delta}px)`
}

function translatedCSSValue(value: string | undefined, deltaX: number, deltaY: number) {
  const [sourceX = '0px', sourceY = '0px', sourceZ] = cssComponents(value)
  const translated = [offsetCSSLength(sourceX, deltaX), offsetCSSLength(sourceY, deltaY)]
  if (sourceZ) translated.push(sourceZ)
  return translated.join(' ')
}

function flippedScaleComponent(value: string, flipped: boolean) {
  if (!flipped) return value
  const numeric = Number(value)
  return Number.isFinite(numeric) ? String(-numeric) : `calc(${value} * -1)`
}

function flippedCSSScale(value: string | undefined, flipX: boolean, flipY: boolean) {
  const [first = '1', second, sourceZ] = cssComponents(value)
  const sourceX = first
  const sourceY = second ?? first
  const scaled = [flippedScaleComponent(sourceX, flipX), flippedScaleComponent(sourceY, flipY)]
  if (sourceZ) scaled.push(sourceZ)
  return scaled.join(' ')
}

function contentBoxAdjustment(styles: SmylrLiveContainerNode['computedStyle'], axis: 'x' | 'y') {
  if (styles?.['box-sizing'] === 'border-box') return 0
  if (axis === 'x') {
    return (
      pixels(styles?.['padding-left']) +
      pixels(styles?.['padding-right']) +
      pixels(styles?.['border-left-width']) +
      pixels(styles?.['border-right-width'])
    )
  }
  return (
    pixels(styles?.['padding-top']) +
    pixels(styles?.['padding-bottom']) +
    pixels(styles?.['border-top-width']) +
    pixels(styles?.['border-bottom-width'])
  )
}

function resetValue(property: string) {
  if (RESET_VALUES[property]) return RESET_VALUES[property]
  if (property.startsWith('border-') && property.endsWith('-radius')) return '0px'
  if (property.startsWith('border-') && property.endsWith('-width')) return '0px'
  if (property.startsWith('border-') && property.endsWith('-style')) return 'none'
  if (property.startsWith('border-') && property.endsWith('-color')) return 'transparent'
  if (property.startsWith('padding-') || property.endsWith('-gap')) return '0px'
  return 'initial'
}

function pathCSSProperty(path: string, node: SceneNode) {
  if (path === 'fills/0/color') return 'background-color'
  if (path === 'strokes/0/color') return 'border-color'
  if (path === 'cornerRadius') return 'border-radius'
  if (path === 'topLeftRadius') return 'border-top-left-radius'
  if (path === 'topRightRadius') return 'border-top-right-radius'
  if (path === 'bottomRightRadius') return 'border-bottom-right-radius'
  if (path === 'bottomLeftRadius') return 'border-bottom-left-radius'
  if (path === 'itemSpacing') return node.layoutMode === 'GRID' ? 'column-gap' : 'gap'
  if (path === 'counterAxisSpacing') {
    return node.layoutMode === 'VERTICAL' ? 'column-gap' : 'row-gap'
  }
  if (path.startsWith('padding')) {
    return `padding-${path
      .slice('padding'.length)
      .replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
      .replace(/^-/, '')}`
  }
  if (path === 'width' || path === 'height') return path
  if (path === 'opacity') return 'opacity'
  if (path === 'fontSize') return 'font-size'
  if (path === 'fontWeight') return 'font-weight'
  if (path === 'lineHeight') return 'line-height'
  if (path === 'letterSpacing') return 'letter-spacing'
  return null
}

function applySemanticBindings(
  styles: Record<string, string>,
  current: SceneNode,
  baseline: SceneNode,
  currentStyle: DesignStyleDeclaration,
  tokenByVariableId: Map<string, SmylrLiveSemanticToken>
) {
  const paths = new Set([
    ...Object.keys(baseline.boundVariables),
    ...Object.keys(current.boundVariables)
  ])
  for (const path of paths) {
    const currentId = current.boundVariables[path]
    const baselineId = baseline.boundVariables[path]
    if (currentId === baselineId) continue
    const property = pathCSSProperty(path, current)
    if (!property) continue
    const token = currentId ? tokenByVariableId.get(currentId) : undefined
    if (token) {
      styles[property] = token.styleValue ?? `var(${token.cssVariable})`
      continue
    }
    styles[property] = currentStyle[property] ?? resetValue(property)
  }
}

export function createLiveInspectorStylePatch({
  baseline,
  current,
  sourceStyles,
  tokenByVariableId
}: {
  baseline: SceneNode
  current: SceneNode
  sourceStyles: SmylrLiveContainerNode['computedStyle']
  tokenByVariableId: Map<string, SmylrLiveSemanticToken>
}) {
  const currentStyle = sceneNodeToStyle(current)
  const baselineStyle = sceneNodeToStyle(baseline)
  const styles: Record<string, string> = {}
  const properties = new Set([...Object.keys(baselineStyle), ...Object.keys(currentStyle)])

  for (const property of properties) {
    if (POSITION_PROPERTIES.has(property)) continue
    const currentValue = currentStyle[property]
    const baselineValue = baselineStyle[property]
    if (currentValue === baselineValue) continue
    styles[property] = currentValue ?? resetValue(property)
  }

  if (current.width !== baseline.width) {
    styles.width = `${Math.max(1, current.width - contentBoxAdjustment(sourceStyles, 'x'))}px`
  }
  if (current.height !== baseline.height) {
    styles.height = `${Math.max(1, current.height - contentBoxAdjustment(sourceStyles, 'y'))}px`
  }

  const deltaX = current.x - baseline.x
  const deltaY = current.y - baseline.y
  if (deltaX !== 0 || deltaY !== 0) {
    styles.translate = translatedCSSValue(sourceStyles?.translate, deltaX, deltaY)
  }

  if (current.rotation !== baseline.rotation) {
    const sourceRotation = pixels(sourceStyles?.rotate)
    styles.rotate = `${sourceRotation + current.rotation - baseline.rotation}deg`
  }
  if (current.flipX !== baseline.flipX || current.flipY !== baseline.flipY) {
    styles.scale = flippedCSSScale(
      sourceStyles?.scale,
      current.flipX !== baseline.flipX,
      current.flipY !== baseline.flipY
    )
  }
  if (current.visible !== baseline.visible) {
    styles.visibility = current.visible ? 'visible' : 'hidden'
  }

  applySemanticBindings(styles, current, baseline, currentStyle, tokenByVariableId)
  return styles
}
