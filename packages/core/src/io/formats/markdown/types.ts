import type { MermaidSceneSpec } from '#core/diagram'

export type MarkdownSourceMode = 'markdown' | 'mdx' | 'plain-text'

export interface MarkdownImageAsset {
  data: Uint8Array
  mimeType: string
  width?: number
  height?: number
}

export interface MarkdownImportOptions {
  fileName?: string
  mimeType?: string
  createMermaidScene?: (source: string) => Promise<MermaidSceneSpec>
  resolveImage?: (source: string) => Promise<MarkdownImageAsset | null>
  sourceMode?: MarkdownSourceMode
}

export interface MarkdownInlineStyle {
  code?: boolean
  emphasis?: boolean
  link?: boolean
  strike?: boolean
  strong?: boolean
}

export interface MarkdownInlineRun {
  start: number
  length: number
  style: MarkdownInlineStyle
}

export interface MarkdownInlineLink {
  start: number
  length: number
  href: string
  title?: string
}

export interface MarkdownInlineContent {
  text: string
  runs: MarkdownInlineRun[]
  links: MarkdownInlineLink[]
}
