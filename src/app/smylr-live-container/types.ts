import type { DesignStyleDeclaration } from '@open-pencil/dom-css'
import type { Rect } from '@open-pencil/scene-graph/primitives'

export type SmylrLiveContainerOwner = {
  componentName?: string
  filePath?: string
  lineNumber?: number
  sourceKind?: 'debug-source' | 'jsx-callsite'
}

export type SmylrLiveContainerSource = SmylrLiveContainerOwner & {
  ownerPath?: SmylrLiveContainerOwner[]
}

export type SmylrLiveSemanticTokenCategory =
  | 'border'
  | 'chart'
  | 'radius'
  | 'shadow'
  | 'spacing'
  | 'status'
  | 'surface'
  | 'text'

export type SmylrLiveSemanticToken = {
  category: SmylrLiveSemanticTokenCategory
  cssProperty: string
  cssVariable: `--${string}`
  label: string
  resolvedValue: string
  sourceFile: string
  styleValue?: string
  utilities?: string[]
}

export type SmylrLiveTokenProvenance = {
  cssProperty: string
  cssVariable: `--${string}`
  declaredValue?: string
  evidence: 'class-token' | 'inline-declaration'
  styleValue?: string
  utility?: string
}

export type SmylrLiveContainerRect = Rect

export type SmylrLiveContainerNode = {
  attrs?: Record<string, string>
  children?: SmylrLiveContainerNode[]
  className?: string
  computedStyle?: DesignStyleDeclaration
  id: string
  label: string
  rect: SmylrLiveContainerRect
  role?: string
  source?: SmylrLiveContainerSource
  tagName?: string
  text?: string
  tokenHints?: string[]
  tokenProvenance?: SmylrLiveTokenProvenance[]
}

export type SmylrLiveContainerPageFace = {
  dataUrl: string
  height: number
  mimeType?: string
  width: number
}

export type SmylrLiveContainerPageKind = 'production-app' | 'component-assets' | 'selection'

export type SmylrLiveContainerPage = {
  id: string
  kind: SmylrLiveContainerPageKind
  route?: string
  pageFace?: SmylrLiveContainerPageFace
  selectedId?: string
  title: string
  tree: SmylrLiveContainerNode
}

export type SmylrLiveContainerDocument = {
  capturedAt: string
  ownerMapText?: string
  pageFace?: SmylrLiveContainerPageFace
  pages?: SmylrLiveContainerPage[]
  route: string
  semanticTokenCatalog?: SmylrLiveSemanticToken[]
  selectedId: string
  title: string
  tree: SmylrLiveContainerNode
}

export type SmylrLiveContainerPatchIntent = {
  add: string[]
  nodeId: string
  note?: string
  remove: string[]
  source?: SmylrLiveContainerSource
  styles?: DesignStyleDeclaration
}
