import { expect, test } from 'bun:test'

import { buildOpenPencilClipboardHTML } from '@open-pencil/core/clipboard'

import {
  codeObjectDocument,
  createCodeObjectFromPreset,
  isCodeObjectFrame
} from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'

test('copies and pastes the complete Code Object frame contract', async () => {
  const store = createEditorStore()
  const source = createCodeObjectFromPreset(store, 'earth-signals')
  if (!source) throw new Error('Earth signals preset was not created')

  const html = buildOpenPencilClipboardHTML([source], store.graph)
  await store.pasteFromHTML(html)

  const [pastedId] = [...store.state.selectedIds]
  if (!pastedId) throw new Error('Pasted Code Object was not selected')
  const pasted = store.graph.getNode(pastedId)

  expect(pastedId).not.toBe(source.id)
  expect(isCodeObjectFrame(pasted)).toBe(true)
  expect(codeObjectDocument(pasted)).toEqual(codeObjectDocument(source))
  expect(pasted?.x).toBe(source.x + 20)
  expect(pasted?.y).toBe(source.y + 20)

  store.undo.undo()
  expect(store.graph.getNode(pastedId)).toBeUndefined()
  store.undo.redo()
  expect(isCodeObjectFrame(store.graph.getNode(pastedId))).toBe(true)
})
