import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

const PLUGIN_ID = 'openpencil-html-board'
const BOARD_KIND = 'html-board'
const DEFAULT_VIEWPORT = { height: 900, width: 1440 } as const
export const HTML_BOARD_SCHEMA_VERSION = 1 as const

export type HtmlBoardDocument = {
  css: string
  format: 'html'
  html: string
  runtime: 'sandboxed-browser'
  schemaVersion: typeof HTML_BOARD_SCHEMA_VERSION
  viewport: { height: number; width: number }
}

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { pluginId: PLUGIN_ID, key, value }
}

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

function viewportDimension(html: string, key: 'height' | 'width', fallback: number): number {
  const match = html.match(new RegExp(`data-openpencil-${key}=["'](\\d+)["']`, 'i'))
  const value = Number(match?.[1] ?? fallback)
  return Math.max(240, Math.min(3840, value))
}

function htmlBoardDocumentData(
  html: string,
  css: string,
  viewport = inferHtmlBoardViewport(html)
): HtmlBoardDocument {
  return {
    css,
    format: 'html',
    html,
    runtime: 'sandboxed-browser',
    schemaVersion: HTML_BOARD_SCHEMA_VERSION,
    viewport
  }
}

function boardPluginData(
  node: SceneNode,
  html: string,
  css: string,
  viewport = inferHtmlBoardViewport(html)
) {
  return [
    ...node.pluginData.filter((entry) => entry.pluginId !== PLUGIN_ID),
    pluginData('kind', BOARD_KIND),
    pluginData('document', JSON.stringify(htmlBoardDocumentData(html, css, viewport)))
  ]
}

export function htmlBoardDocument(node: SceneNode): HtmlBoardDocument {
  const stored = pluginValue(node, 'document')
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<HtmlBoardDocument>
      if (
        parsed.schemaVersion === HTML_BOARD_SCHEMA_VERSION &&
        parsed.format === 'html' &&
        typeof parsed.html === 'string' &&
        typeof parsed.css === 'string'
      ) {
        return {
          css: parsed.css,
          format: 'html',
          html: parsed.html,
          runtime: 'sandboxed-browser',
          schemaVersion: HTML_BOARD_SCHEMA_VERSION,
          viewport: {
            height: parsed.viewport?.height ?? node.height,
            width: parsed.viewport?.width ?? node.width
          }
        }
      }
    } catch {
      // Fall through to the legacy two-field representation.
    }
  }
  return htmlBoardDocumentData(pluginValue(node, 'html') ?? '', pluginValue(node, 'css') ?? '', {
    height: node.height,
    width: node.width
  })
}

export function isHtmlBoardFrame(node: SceneNode | null | undefined): boolean {
  return Boolean(node && node.type === 'FRAME' && pluginValue(node, 'kind') === BOARD_KIND)
}

export function htmlBoardContent(node: SceneNode): { css: string; html: string } {
  const document = htmlBoardDocument(node)
  return { css: document.css, html: document.html }
}

export function inferHtmlBoardViewport(html: string): { height: number; width: number } {
  return {
    height: viewportDimension(html, 'height', DEFAULT_VIEWPORT.height),
    width: viewportDimension(html, 'width', DEFAULT_VIEWPORT.width)
  }
}

export function htmlBoardSrcdoc(node: SceneNode): string {
  const { css, html } = htmlBoardContent(node)
  const style = `<style data-openpencil-html-board>html,body{margin:0;min-height:100%;}${css}</style>`
  if (/<html[\s>]/i.test(html)) {
    if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}</head>`)
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${style}</head>`)
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${style}</head><body>${html}</body></html>`
}

export function createHtmlBoardFrame(store: EditorStore, html: string, css: string): SceneNode {
  const viewport = inferHtmlBoardViewport(html)
  const siblings = store.graph.getChildren(store.state.currentPageId)
  const x = siblings.length > 0 ? Math.max(...siblings.map((node) => node.x + node.width)) + 120 : 96
  const frame = store.graph.createNode('FRAME', store.state.currentPageId, {
    clipsContent: true,
    cornerRadius: 12,
    fills: [],
    height: viewport.height,
    name: 'HTML Board',
    pluginData: [],
    strokes: [],
    width: viewport.width,
    x,
    y: 88
  })
  store.graph.updateNode(frame.id, {
    pluginData: boardPluginData(frame, html, css, viewport)
  })
  store.select([frame.id])
  store.requestRender()
  return frame
}

export function updateHtmlBoardFrame(
  store: EditorStore,
  frameId: string,
  html: string,
  css: string
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  store.updateNodeWithUndo(
    frame.id,
    {
      pluginData: boardPluginData(frame, html, css, {
        height: frame.height,
        width: frame.width
      })
    },
    'Update HTML board'
  )
  store.requestRender()
  return true
}

export function updateHtmlBoardViewport(
  store: EditorStore,
  frameId: string,
  viewport: { height: number; width: number },
  label: string
): boolean {
  const frame = store.graph.getNode(frameId)
  if (!frame || !isHtmlBoardFrame(frame)) return false
  const content = htmlBoardContent(frame)
  store.updateNodeWithUndo(
    frame.id,
    {
      height: viewport.height,
      pluginData: boardPluginData(frame, content.html, content.css, viewport),
      width: viewport.width
    },
    label
  )
  store.requestRender()
  return true
}
