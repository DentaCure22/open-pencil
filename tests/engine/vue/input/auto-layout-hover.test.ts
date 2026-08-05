import { describe, expect, test } from 'bun:test'

import type { Editor } from '@open-pencil/core/editor'
import { contentSourcePluginData } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'

import { resolveAutoLayoutHover } from '#vue/shared/input/auto-layout-hover'

function frame(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: 'frame',
    type: 'FRAME',
    name: 'Frame',
    parentId: 'page',
    childIds: ['title', 'body', 'bar'],
    visible: true,
    locked: false,
    x: 100,
    y: 100,
    width: 280,
    height: 160,
    rotation: 0,
    layoutMode: 'VERTICAL',
    layoutPositioning: 'AUTO',
    itemSpacing: 8,
    paddingTop: 20,
    paddingRight: 20,
    paddingBottom: 20,
    paddingLeft: 20,
    pluginData: [],
    ...overrides
  } as SceneNode
}

function child(id: string, y: number, height: number): SceneNode {
  return {
    id,
    type: id === 'bar' ? 'RECTANGLE' : 'TEXT',
    name: id,
    parentId: 'frame',
    childIds: [],
    visible: true,
    locked: false,
    x: 20,
    y,
    width: id === 'bar' ? 180 : 240,
    height,
    rotation: 0,
    layoutMode: 'NONE',
    layoutPositioning: 'AUTO',
    pluginData: []
  } as SceneNode
}

function editor(frameOverrides: Partial<SceneNode> = {}, additionalNodes: SceneNode[] = []) {
  const nodes = new Map<string, SceneNode>([
    ['frame', frame(frameOverrides)],
    ['title', child('title', 20, 32)],
    ['body', child('body', 60, 48)],
    ['bar', child('bar', 116, 12)],
    ...additionalNodes.map((node): [string, SceneNode] => [node.id, node])
  ])

  return {
    state: {
      selectedIds: new Set(['frame'])
    },
    graph: {
      getNode: (id: string) => nodes.get(id) ?? null,
      getAbsolutePosition: (id: string) => {
        const node = nodes.get(id)
        if (!node) return { x: 0, y: 0 }
        if (node.parentId === 'frame') return { x: 100 + node.x, y: 100 + node.y }
        return { x: node.x, y: node.y }
      }
    }
  } as Editor
}

describe('auto-layout hover resolver', () => {
  test('returns null outside the selected auto-layout frame', () => {
    expect(resolveAutoLayoutHover(90, 90, editor())).toBeNull()
  })

  test('detects padding regions and padding value handles', () => {
    expect(resolveAutoLayoutHover(240, 105, editor())).toMatchObject({
      kind: 'padding-value',
      side: 'top'
    })
    expect(resolveAutoLayoutHover(375, 130, editor())).toMatchObject({
      kind: 'padding',
      side: 'right'
    })
  })

  test('detects shared spacing regions and value handles', () => {
    expect(resolveAutoLayoutHover(240, 156, editor())).toMatchObject({
      kind: 'spacing-value',
      index: 0
    })
    expect(resolveAutoLayoutHover(130, 212, editor())).toMatchObject({
      kind: 'spacing',
      index: 1
    })
  })

  test('detects child hover inside selected auto-layout frame', () => {
    expect(resolveAutoLayoutHover(130, 180, editor())).toMatchObject({
      kind: 'children',
      index: 1
    })
  })

  test('falls back to frame hover inside empty selected areas', () => {
    expect(resolveAutoLayoutHover(240, 235, editor())).toMatchObject({ kind: 'frame' })
  })

  test('hides layout guides within a source-backed Markdown document', () => {
    const markdownDocument = frame({
      id: 'markdown-document',
      childIds: ['frame'],
      parentId: 'page',
      pluginData: contentSourcePluginData({
        fileName: 'notes.md',
        format: 'markdown',
        mimeType: 'text/markdown',
        revision: 1,
        source: '# Notes'
      }),
      x: 0,
      y: 0
    })

    expect(
      resolveAutoLayoutHover(
        240,
        156,
        editor({ parentId: markdownDocument.id }, [markdownDocument])
      )
    ).toBeNull()
  })
})
