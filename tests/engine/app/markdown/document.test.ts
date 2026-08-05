import { describe, expect, test } from 'bun:test'

import { readContentSource } from '@open-pencil/core/io'
import { markdownToSceneGraph, writeMarkdownDocument } from '@open-pencil/core/io/formats/markdown'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { markdownDocument, updateMarkdownDocumentSource } from '@/app/markdown-document'

function testStore(graph: SceneGraph) {
  let historyLabel = ''
  return {
    graph,
    historyLabel: () => historyLabel,
    updateNodeWithUndo(nodeId: string, props: Partial<SceneNode>, label: string) {
      historyLabel = label
      graph.updateNode(nodeId, props)
    }
  }
}

describe('Markdown document source authority', () => {
  test('updates exact source with undo and a single revision increment', async () => {
    const original = '# Notes\n\nOriginal\n'
    const updated = '# Notes\n\nUpdated with **Markdown**.\n'
    const graph = await markdownToSceneGraph(original, { fileName: 'notes.md' })
    const store = testStore(graph)
    const frame = graph.getChildren(graph.getPages()[0].id)[0]

    expect(markdownDocument(frame)?.metadata.source).toBe(original)
    expect(updateMarkdownDocumentSource(store, frame.id, updated)).toBe(true)
    expect(store.historyLabel()).toBe('Edit Markdown')
    expect(readContentSource(frame)).toMatchObject({ revision: 2, source: updated })
    expect(writeMarkdownDocument(graph)).toMatchObject({
      changed: false,
      revision: 2,
      source: updated
    })
  })

  test('ignores unchanged source and native Markdown projections', async () => {
    const sourceGraph = await markdownToSceneGraph('# Notes')
    const sourceStore = testStore(sourceGraph)
    const sourceFrame = sourceGraph.getChildren(sourceGraph.getPages()[0].id)[0]
    expect(updateMarkdownDocumentSource(sourceStore, sourceFrame.id, '# Notes')).toBe(false)

    const nativeGraph = await markdownToSceneGraph('# Notes', { representation: 'native' })
    const nativeStore = testStore(nativeGraph)
    const nativeFrame = nativeGraph.getChildren(nativeGraph.getPages()[0].id)[0]
    expect(markdownDocument(nativeFrame)).toBeNull()
    expect(updateMarkdownDocumentSource(nativeStore, nativeFrame.id, '# Updated')).toBe(false)
  })
})
