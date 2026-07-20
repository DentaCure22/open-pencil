import { buildOpenPencilClipboardHTML } from '@open-pencil/core/clipboard'
import type { Editor } from '@open-pencil/core/editor'
import {
  markdownToSceneGraph,
  type MarkdownImportOptions,
  type MarkdownSourceMode
} from '@open-pencil/core/io/formats/markdown'
import type { SceneGraph } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'txt'])

export interface MarkdownClipboardPayload {
  html: string
  text: string
}

function extensionFor(fileName: string): string {
  return /\.([^.]+)$/.exec(fileName.toLowerCase())?.[1] ?? ''
}

export function isMarkdownIntakeFile(file: Pick<File, 'name'>): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionFor(file.name))
}

export function markdownSourceModeForFile(fileName: string): MarkdownSourceMode {
  const extension = extensionFor(fileName)
  if (extension === 'txt') return 'plain-text'
  if (extension === 'mdx') return 'mdx'
  return 'markdown'
}

export function markdownTextFromClipboard(clipboard: Pick<DataTransfer, 'getData'>): string | null {
  const explicit = clipboard.getData('text/markdown').trim()
  if (explicit) return explicit
  const plainText = clipboard.getData('text/plain').trim()
  return plainText || null
}

export function hasOpenPencilOrFigmaClipboardHTML(html: string): boolean {
  return html.includes('<!--(openpencil)') || html.includes('<!--(figmeta)')
}

export async function markdownFileToSceneGraph(
  file: File,
  options: Omit<MarkdownImportOptions, 'fileName' | 'mimeType' | 'sourceMode'> = {}
): Promise<SceneGraph> {
  if (!isMarkdownIntakeFile(file)) throw new Error(`Unsupported Markdown intake file: ${file.name}`)
  return markdownToSceneGraph(await file.text(), {
    ...options,
    fileName: file.name,
    mimeType:
      file.type || (file.name.toLowerCase().endsWith('.txt') ? 'text/plain' : 'text/markdown'),
    sourceMode: markdownSourceModeForFile(file.name)
  })
}

export async function markdownClipboardPayload(
  source: string,
  options: MarkdownImportOptions = {}
): Promise<MarkdownClipboardPayload> {
  const graph = await markdownToSceneGraph(source, {
    fileName: 'Pasted Markdown.md',
    mimeType: 'text/markdown',
    ...options
  })
  const page = graph.getPages()[0]
  const document = graph.getChildren(page.id)[0]
  return {
    html: buildOpenPencilClipboardHTML([document], graph),
    text: source
  }
}

export async function pasteMarkdownText(
  editor: Pick<Editor, 'pasteFromHTML'>,
  source: string,
  position?: Vector,
  options: MarkdownImportOptions = {}
): Promise<void> {
  const payload = await markdownClipboardPayload(source, options)
  await editor.pasteFromHTML(payload.html, position)
}
