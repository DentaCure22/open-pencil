import type { Rect } from '@open-pencil/scene-graph/primitives'

import type {
  SmylrLiveContainerNode,
  SmylrLiveContainerOwner
} from '@/app/smylr-live-container/types'

import type {
  ContextCommentLiveSelection,
  ContextCommentOwner,
  ContextCommentTarget
} from './types'

const LAYOUT_KEYS = [
  'align-items',
  'align-self',
  'display',
  'flex',
  'gap',
  'grid-template-columns',
  'height',
  'inset',
  'justify-content',
  'left',
  'margin',
  'max-width',
  'padding',
  'place-content',
  'place-items',
  'position',
  'right',
  'text-align',
  'top',
  'transform',
  'width'
] as const

const ATTR_KEYS = [
  'aria-label',
  'data-align',
  'data-side',
  'data-slot',
  'data-state',
  'for',
  'href',
  'id',
  'name',
  'placeholder',
  'type'
] as const

function clip(value: string, max: number) {
  const trimmed = value.replaceAll(/\s+/g, ' ').trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

function ownerLine(owner: ContextCommentOwner) {
  const location = [owner.filePath, owner.lineNumber].filter((part) => part !== undefined).join(':')
  return [owner.componentName, location].filter(Boolean).join(' ')
}

function uniqueOwners(owners: readonly ContextCommentOwner[]) {
  const seen = new Set<string>()
  const unique: ContextCommentOwner[] = []
  for (const owner of owners) {
    const key = ownerLine(owner)
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(owner)
  }
  return unique
}

function compactOwners(source: SmylrLiveContainerNode['source']): ContextCommentOwner[] {
  if (!source) return []
  const owners: SmylrLiveContainerOwner[] = [source, ...(source.ownerPath ?? [])]
  return uniqueOwners(
    owners.flatMap((owner) => {
      if (!owner.componentName && !owner.filePath) return []
      return [
        {
          ...(owner.componentName ? { componentName: owner.componentName } : {}),
          ...(owner.filePath ? { filePath: owner.filePath } : {}),
          ...(owner.lineNumber ? { lineNumber: owner.lineNumber } : {})
        }
      ]
    })
  ).slice(0, 8)
}

function compactAttrs(attrs: Record<string, string> | undefined) {
  if (!attrs) return undefined
  const picked = Object.fromEntries(
    ATTR_KEYS.flatMap((key) => {
      const value = attrs[key]?.trim()
      return value ? [[key, clip(value, 80)] as const] : []
    })
  )
  return Object.keys(picked).length > 0 ? picked : undefined
}

function compactLayout(style: Record<string, string> | undefined) {
  if (!style) return undefined
  const picked = Object.fromEntries(
    LAYOUT_KEYS.flatMap((key) => {
      const value = style[key]?.trim()
      return value && value !== 'none' && value !== 'auto' && value !== 'normal'
        ? [[key, clip(value, 64)] as const]
        : []
    })
  )
  return Object.keys(picked).length > 0 ? picked : undefined
}

function formatRect(rect: Rect) {
  return `${Math.round(rect.width)}×${Math.round(rect.height)} at ${Math.round(rect.x)},${Math.round(rect.y)}`
}

function formatElement(selection: ContextCommentLiveSelection) {
  const tag = selection.tagName || 'element'
  const id = selection.attrs?.id ? `#${selection.attrs.id}` : ''
  const classes = (selection.className ?? '').split(/\s+/).filter(Boolean).slice(0, 8).join('.')
  const role = selection.role ? `[role=${selection.role}]` : ''
  return [tag + id, classes ? `.${classes}` : '', role ? ` ${role}` : ''].join('')
}

export function liveSelectionFromNode(
  node: SmylrLiveContainerNode,
  parent?: SmylrLiveContainerNode | null
): ContextCommentLiveSelection {
  const text = node.text?.trim()
  const className = node.className?.trim()
  const tokenHints = node.tokenHints?.filter(Boolean).slice(0, 8)
  const attrs = compactAttrs(node.attrs)
  const layout = compactLayout(node.computedStyle)
  const ownerPath = compactOwners(node.source)
  return {
    ...(attrs ? { attrs } : {}),
    ...(className ? { className: clip(className, 200) } : {}),
    ...(layout ? { layout } : {}),
    localRect: node.rect,
    ...(ownerPath.length ? { ownerPath } : {}),
    ...(parent?.label ? { parentLabel: parent.label } : {}),
    ...(parent?.rect ? { parentRect: parent.rect } : {}),
    ...(node.role ? { role: node.role } : {}),
    ...(node.tagName ? { tagName: node.tagName } : {}),
    ...(text ? { text: clip(text, 40) } : {}),
    ...(tokenHints?.length ? { tokenHints } : {})
  }
}

export function contextCommentTargetLines(target: ContextCommentTarget): string[] {
  const live = target.live
  const id = target.stableIds[0]
  if (!live) {
    const where = target.route || id || target.scope.pageId
    const source = target.source?.filePath
      ? `${target.source.filePath}${target.source.lineNumber ? `:${String(target.source.lineNumber)}` : ''}`
      : ''
    const path = target.path.length > 1 ? target.path.join(' / ') : ''
    return [
      `Target: ${target.label}${where ? ` (${where})` : ''}${source ? ` ${source}` : ''}`,
      ...(id && target.kind === 'selection' ? [`Id: ${id}`] : []),
      ...(path && target.kind === 'selection' ? [`Path: ${path}`] : [])
    ]
  }

  const bounds = live.parentRect
    ? `${formatRect(live.localRect)} in ${live.parentLabel ?? 'parent'} ${formatRect(live.parentRect)}`
    : formatRect(live.localRect)
  const layout = live.layout
    ? Object.entries(live.layout)
        .map(([key, value]) => `${key}:${value}`)
        .join('; ')
    : ''

  return [
    `Target: ${target.label}`,
    ...(target.route ? [`Route: ${target.route}`] : []),
    ...(target.frameId ? [`Board frame: ${target.frameId}`] : []),
    ...(id ? [`Live id: ${id}`] : []),
    `Element: ${formatElement(live)}`,
    ...(live.text ? [`Text: ${live.text}`] : []),
    `Bounds: ${bounds}`,
    ...(layout ? [`Layout: ${layout}`] : []),
    ...(live.ownerPath?.length
      ? ['Owner:', ...live.ownerPath.map((owner) => `- ${ownerLine(owner)}`)]
      : (target.source ? [`Source: ${ownerLine(target.source)}`] : [])),
    ...(target.hierarchy?.parent ? [`Parent: ${target.hierarchy.parent.label}`] : []),
    ...(target.hierarchy?.children.length
      ? [`Children: ${target.hierarchy.children.map((child) => child.label).join(', ')}`]
      : []),
    ...(live.className ? [`Classes: ${live.className}`] : []),
    ...(live.tokenHints?.length ? [`Tokens: ${live.tokenHints.join(', ')}`] : [])
  ]
}
