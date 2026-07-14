import type { SceneNode } from '@open-pencil/scene-graph'
import { ref } from 'vue'

import type { EditorStore } from '@/app/editor/active-store'

const PLUGIN_ID = 'openpencil-html-board'
const BOARD_KIND = 'html-board'
const DEFAULT_VIEWPORT = { height: 900, width: 1440 } as const

export const htmlBoardInteractionFrameId = ref<string | null>(null)

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

function boardPluginData(node: SceneNode, html: string, css: string) {
  return [
    ...node.pluginData.filter((entry) => entry.pluginId !== PLUGIN_ID),
    pluginData('kind', BOARD_KIND),
    pluginData('html', html),
    pluginData('css', css)
  ]
}

export function htmlBoardFrameProperties(node: SceneNode, html: string, css: string) {
  const viewport = inferHtmlBoardViewport(html)
  return {
    height: viewport.height,
    pluginData: boardPluginData(node, html, css),
    width: viewport.width
  }
}

export function isHtmlBoardFrame(node: SceneNode | null | undefined): boolean {
  return Boolean(node && node.type === 'FRAME' && pluginValue(node, 'kind') === BOARD_KIND)
}

export function htmlBoardContent(node: SceneNode): { css: string; html: string } {
  return {
    css: pluginValue(node, 'css') ?? '',
    html: pluginValue(node, 'html') ?? ''
  }
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
  store.graph.updateNode(frame.id, htmlBoardFrameProperties(frame, html, css))
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
    htmlBoardFrameProperties(frame, html, css),
    'Update HTML board'
  )
  store.requestRender()
  return true
}
