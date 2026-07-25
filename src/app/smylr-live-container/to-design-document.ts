import { DEFAULT_FONT_FAMILY } from '@open-pencil/core/constants'
import type {
  DesignDocument,
  DesignElement,
  DesignNode,
  DesignStyleDeclaration
} from '@open-pencil/dom-css'

import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode,
  SmylrLiveContainerPage,
  SmylrLiveContainerPageFace
} from './types'

const SOURCE_COMPONENT_ATTR = 'data-smylr-component'
const SOURCE_FILE_ATTR = 'data-smylr-source'
const SOURCE_ID_ATTR = 'data-smylr-container-id'
const SOURCE_LABEL_ATTR = 'data-smylr-label'

function rectStyleFor(node: SmylrLiveContainerNode): DesignStyleDeclaration {
  return {
    height: `${node.rect.height}px`,
    left: `${node.rect.x}px`,
    position: 'absolute',
    top: `${node.rect.y}px`,
    width: `${node.rect.width}px`
  }
}

const TEXT_LIKE_TAGS = new Set([
  'a',
  'button',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'label',
  'p',
  'span',
  'strong'
])

/** Only these styles belong on a native text leaf; box styles force FRAME. */
const TYPOGRAPHY_STYLE_KEYS = new Set([
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'line-height',
  'opacity',
  'text-align',
  'visibility'
])

function isTextPrimaryNode(node: SmylrLiveContainerNode): boolean {
  const text = node.text?.trim()
  if (!text) return false
  // Storybook-backed primitives use data-slot on their real rendered root.
  // Keep that root as a native frame so its computed fill, border, radius,
  // padding, and shadow survive; its text is emitted as a child below.
  if (node.attrs?.['data-slot']) return false
  const tag = (node.tagName ?? '').toLowerCase()
  if (!TEXT_LIKE_TAGS.has(tag)) return false
  if (node.children && node.children.length > 0) return false
  return true
}

function typographyStyleFor(node: SmylrLiveContainerNode): DesignStyleDeclaration {
  const style = Object.fromEntries(
    Object.entries(node.computedStyle ?? {}).filter(([key]) => TYPOGRAPHY_STYLE_KEYS.has(key))
  )
  const firstFamily = style['font-family']
    ?.split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '')
  if (
    firstFamily &&
    /^(?:quicksand|ui-sans-serif|system-ui|-apple-system|blinkmacsystemfont|sans-serif)$/i.test(
      firstFamily
    )
  ) {
    style['font-family'] = DEFAULT_FONT_FAMILY
  }
  return style
}

function styledTextChildFor(node: SmylrLiveContainerNode): DesignElement {
  return {
    attrs: {
      id: `${node.id}:text`,
      [SOURCE_LABEL_ATTR]: `${node.label} text`
    },
    children: [{ text: node.text?.trim() ?? '', type: 'text' }],
    computedStyle: typographyStyleFor(node),
    inlineStyle: {},
    tagName: 'span',
    type: 'element'
  }
}

function sourceAttrsFor(node: SmylrLiveContainerNode): Record<string, string> {
  const attrs: Record<string, string> = {
    id: node.id,
    [SOURCE_ID_ATTR]: node.id,
    [SOURCE_LABEL_ATTR]: node.label
  }

  if (node.className) attrs.class = node.className
  if (node.role) attrs.role = node.role
  if (node.source?.componentName) {
    attrs[SOURCE_COMPONENT_ATTR] = node.source.componentName
  }
  if (node.source?.filePath) {
    attrs[SOURCE_FILE_ATTR] = node.source.lineNumber
      ? `${node.source.filePath}:${node.source.lineNumber}`
      : node.source.filePath
  }
  if (node.tokenHints && node.tokenHints.length > 0) {
    attrs['data-smylr-token-hints'] = node.tokenHints.join(' ')
  }

  return { ...attrs, ...node.attrs }
}

type DesignNodeOptions = {
  overlayContainers?: boolean
}

function childNodesFor(node: SmylrLiveContainerNode, options: DesignNodeOptions): DesignNode[] {
  if (isTextPrimaryNode(node) && !options.overlayContainers) {
    return [{ text: node.text?.trim() ?? '', type: 'text' }]
  }

  const children = node.children?.map((child) => toDesignNode(child, options)) ?? []

  if (options.overlayContainers || !node.text || node.text.trim().length === 0) {
    return children
  }

  return [...children, styledTextChildFor(node)]
}

function overlayContainerStyleFor(node: SmylrLiveContainerNode): DesignStyleDeclaration {
  return {
    ...rectStyleFor(node),
    'background-color': 'rgba(14, 165, 233, 0.045)',
    'border-color': 'rgba(14, 165, 233, 0.58)',
    'border-style': 'solid',
    'border-width': '1px',
    'box-shadow': 'none',
    color: 'transparent'
  }
}

function styleFor(
  node: SmylrLiveContainerNode,
  options: DesignNodeOptions
): DesignStyleDeclaration {
  if (options.overlayContainers) return overlayContainerStyleFor(node)
  // Text leaves omit box geometry so dom-css promotes them to native TEXT (Typography).
  if (isTextPrimaryNode(node)) return typographyStyleFor(node)

  return {
    ...node.computedStyle,
    ...rectStyleFor(node)
  }
}

export function toDesignNode(
  node: SmylrLiveContainerNode,
  options: DesignNodeOptions = {}
): DesignElement {
  const textPrimary = isTextPrimaryNode(node) && !options.overlayContainers
  return {
    attrs: sourceAttrsFor(node),
    children: childNodesFor(node, options),
    computedStyle: styleFor(node, options),
    // Box geometry promotes text-like elements to FRAME in dom-css. Keep
    // meaningful text leaves box-free so they become native TEXT nodes and
    // expose the shared Typography inspector.
    inlineStyle: textPrimary ? {} : rectStyleFor(node),
    tagName: node.tagName ?? 'div',
    type: 'element'
  }
}

function fallbackPageFor(document: SmylrLiveContainerDocument): SmylrLiveContainerPage {
  return {
    id: 'selected-container',
    kind: 'selection',
    route: document.route,
    selectedId: document.selectedId,
    title: document.title,
    tree: document.tree
  }
}

export function smylrLiveContainerPagesFor(
  document: SmylrLiveContainerDocument
): SmylrLiveContainerPage[] {
  return document.pages && document.pages.length > 0 ? document.pages : [fallbackPageFor(document)]
}

function viewportElementFor(
  document: SmylrLiveContainerDocument,
  page: SmylrLiveContainerPage
): DesignElement {
  const root = page.tree
  const pageFace = page.pageFace ?? document.pageFace
  const children = pageFace
    ? [pageFaceElementFor(pageFace), toDesignNode(root, { overlayContainers: true })]
    : [toDesignNode(root)]

  return {
    attrs: {
      'data-smylr-page-kind': page.kind,
      'data-smylr-page-title': page.title,
      'data-smylr-route': page.route ?? document.route,
      'data-smylr-selected-id': page.selectedId ?? document.selectedId,
      id: page.id,
      [SOURCE_LABEL_ATTR]: page.title
    },
    children,
    computedStyle: {
      height: `${Math.max(root.rect.height + root.rect.y, root.rect.height)}px`,
      position: 'relative',
      width: `${Math.max(root.rect.width + root.rect.x, root.rect.width)}px`
    },
    inlineStyle: {
      position: 'relative'
    },
    tagName: 'main',
    type: 'element'
  }
}

function pageFaceElementFor(face: SmylrLiveContainerPageFace): DesignElement {
  return {
    attrs: {
      'data-smylr-page-face': 'production-screenshot',
      id: 'smylr-production-face',
      src: face.dataUrl
    },
    children: [],
    computedStyle: {
      height: `${face.height}px`,
      left: '0px',
      'object-fit': 'fill',
      position: 'absolute',
      top: '0px',
      width: `${face.width}px`
    },
    inlineStyle: {
      height: `${face.height}px`,
      left: '0px',
      position: 'absolute',
      top: '0px',
      width: `${face.width}px`
    },
    tagName: 'img',
    type: 'element'
  }
}

export function smylrLiveContainerToDesignDocument(
  document: SmylrLiveContainerDocument
): DesignDocument {
  const page = smylrLiveContainerPagesFor(document)[0] ?? fallbackPageFor(document)

  return {
    children: [viewportElementFor(document, page)],
    stylesheets: [smylrLiveContainerStylesheet()],
    type: 'document'
  }
}

function smylrLiveContainerStylesheet() {
  return {
    cssText: [
      '[data-smylr-container-id] { box-sizing: border-box; }',
      '[data-smylr-container-id] * { box-sizing: border-box; }'
    ].join('\n'),
    href: 'smylr-live-container.css',
    type: 'stylesheet' as const
  }
}

export function smylrLiveContainerPageToDesignDocument(
  document: SmylrLiveContainerDocument,
  page: SmylrLiveContainerPage
): DesignDocument {
  return {
    children: [viewportElementFor(document, page)],
    stylesheets: [smylrLiveContainerStylesheet()],
    type: 'document'
  }
}

export function smylrLiveContainerToDesignDocuments(
  document: SmylrLiveContainerDocument
): Array<{ designDocument: DesignDocument; page: SmylrLiveContainerPage }> {
  return smylrLiveContainerPagesFor(document).map((page) => ({
    designDocument: smylrLiveContainerPageToDesignDocument(document, page),
    page
  }))
}
