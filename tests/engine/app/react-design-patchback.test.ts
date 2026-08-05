import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import {
  reactDocumentSourceForNode,
  reactSourceToSceneGraph,
  sourceIdForNode
} from '@open-pencil/dom-css'

import { applyReactDesignStylePatch, proposeReactDesignStylePatch } from '@/app/document/io/react'
import { createDocumentSourceActions, createDocumentSourceState } from '@/app/document/io/source'

function sourceNodeById(editor: ReturnType<typeof createEditor>, sourceId: string) {
  return [...editor.graph.getAllNodes()].find((node) => sourceIdForNode(node) === sourceId)
}

function browserHandle(
  name: string,
  write: (data: Uint8Array) => Promise<void>
): FileSystemFileHandle {
  const writable: FileSystemWritableFileStream = Object.assign(new WritableStream(), {
    write: async (data: FileSystemWriteChunkType) => {
      if (!(data instanceof Uint8Array)) throw new Error('Expected source bytes')
      await write(data)
    },
    seek: async () => undefined,
    truncate: async () => undefined
  })
  return {
    name,
    kind: 'file',
    createWritable: async () => writable,
    getFile: async () => new File([], name),
    isSameEntry: async (other) => other.name === name
  }
}

describe('React native-design patch-back', () => {
  test('proposes one reviewable TSX edit, reconciles it, and restores source on Undo', async () => {
    const source = `
      import React, { useState } from 'react'
      export default function Card() {
        const [count] = useState(3)
        return (
          <article
            data-open-pencil-source-id="card"
            style={{ width: 240, height: 120, borderRadius: 12 }}
          >Count {count}</article>
        )
      }
    `
    const cssText = 'article { padding: 16px; }'
    const graph = await reactSourceToSceneGraph(source, { cssText })
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    const page = graph.getPages()[0]
    const card = sourceNodeById(editor, 'card')
    expect(page).toBeDefined()
    expect(card).toBeDefined()
    if (!card) return

    editor.graph.updateNode(card.id, { cornerRadius: 24 })
    editor.select([card.id])
    const proposal = proposeReactDesignStylePatch(editor, { field: 'cornerRadius' })

    expect(proposal.status).toBe('ready')
    if (proposal.status !== 'ready') return
    expect(proposal.patch).toMatchObject({
      changed: true,
      message: 'Updated borderRadius on card',
      replacement: 'width: 240, height: 120, borderRadius: 24'
    })
    expect(reactDocumentSourceForNode(page)?.code).toBe(source)

    const applied = await applyReactDesignStylePatch(editor, proposal)
    const reconciled = editor.graph.getNode(card.id)
    const appliedSource = reactDocumentSourceForNode(page)

    expect(applied.reconciliation.preservedOverrides).toBe(0)
    expect(reconciled).toMatchObject({ id: card.id, cornerRadius: 24 })
    expect(appliedSource).toMatchObject({
      cssText,
      states: [{ index: 0, initialValue: 3, value: 3 }]
    })
    expect(appliedSource?.code).toContain('borderRadius: 24')
    expect(editor.undo.undoLabel).toContain(`Update React Updated borderRadius on card`)
    expect(editor.undo.undoLabel).toContain(`[${page.id}]`)
    expect(
      [...editor.graph.getAllNodes()].filter((node) => sourceIdForNode(node) === 'card')
    ).toHaveLength(1)

    const writes: Uint8Array[] = []
    editor.graph.createNode('FRAME', page.id, {
      name: 'Unrelated Code Object',
      pluginData: [
        {
          pluginId: 'open-pencil-code-object',
          key: 'document',
          value: JSON.stringify({ source: 'do not write this source' })
        }
      ]
    })
    const sourceState = createDocumentSourceState()
    const sourceActions = createDocumentSourceActions({
      editor,
      state: Object.assign(editor.state, { autosaveEnabled: false }),
      stopWatchingFile: () => undefined,
      startWatchingFile: async () => undefined,
      getRenderer: () => editor.renderer,
      ...sourceState
    })
    sourceActions.setDocumentSource(
      'Card.tsx',
      'tsx',
      browserHandle('Card.tsx', async (data) => {
        writes.push(structuredClone(data))
      })
    )
    await expect(sourceActions.persistWritableDocumentSource()).resolves.toBe(true)
    expect(new TextDecoder().decode(writes[0])).toBe(appliedSource?.code)
    sourceActions.disposeDocumentIO()

    editor.undo.undo()
    expect(editor.graph.getNode(card.id)?.cornerRadius).toBe(24)
    expect(reactDocumentSourceForNode(page)?.code).toBe(source)

    editor.undo.redo()
    expect(editor.graph.getNode(card.id)?.cornerRadius).toBe(24)
    expect(reactDocumentSourceForNode(page)?.code).toContain('borderRadius: 24')
  })

  test('returns dynamic inline styles as a rejected review result without mutating source', async () => {
    const source = `
      export default function Card() {
        const theme = { opacity: 0.8 }
        return (
          <article
            data-open-pencil-source-id="card"
            style={{ ...theme, width: 240 }}
          >Card</article>
        )
      }
    `
    const graph = await reactSourceToSceneGraph(source)
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    const page = graph.getPages()[0]
    const card = sourceNodeById(editor, 'card')
    expect(page).toBeDefined()
    expect(card).toBeDefined()
    if (!card) return

    editor.graph.updateNode(card.id, { width: 320 })
    editor.select([card.id])
    const proposal = proposeReactDesignStylePatch(editor, { field: 'width' })

    expect(proposal).toMatchObject({
      status: 'rejected',
      nodeId: card.id,
      sourceId: 'card'
    })
    expect(proposal.status === 'rejected' ? proposal.reason : '').toContain(
      'only supports flat inline style objects'
    )
    expect(reactDocumentSourceForNode(page)?.code).toBe(source)
  })

  test('rejects a reviewed proposal when the native value changes before apply', async () => {
    const source = `
      export default function Card() {
        return <article data-open-pencil-source-id="card" style={{ width: 240 }}>Card</article>
      }
    `
    const graph = await reactSourceToSceneGraph(source)
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    const page = graph.getPages()[0]
    const card = sourceNodeById(editor, 'card')
    expect(card).toBeDefined()
    if (!card) return

    editor.graph.updateNode(card.id, { width: 320 })
    const proposal = proposeReactDesignStylePatch(editor, { field: 'width', nodeId: card.id })
    expect(proposal.status).toBe('ready')
    if (proposal.status !== 'ready') return

    editor.graph.updateNode(card.id, { width: 360 })
    await expect(applyReactDesignStylePatch(editor, proposal)).rejects.toThrow(
      'native layer changed'
    )
    expect(editor.graph.getNode(card.id)?.width).toBe(360)
    expect(reactDocumentSourceForNode(page)?.code).toBe(source)
  })
})
