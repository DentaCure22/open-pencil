import { describe, expect, test } from 'bun:test'

import { codeObjectDocument } from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'
import {
  ensureSmylrComponentCodeObjectCanvas,
  isSmylrComponentCodeObject,
  placeSmylrComponentCodeObject,
  SMYLR_COMPONENT_CODE_OBJECT_PAGE_KIND
} from '@/app/smylr-component-library/code-object-canvas'
import { SMYLR_COMPUTED_ASSETS } from '@/app/smylr-component-library/computed-catalog'

function pluginValue(
  node: { pluginData: Array<{ key: string; pluginId: string; value: string }> },
  key: string
) {
  return node.pluginData.find((entry) => entry.pluginId === 'smylr-production' && entry.key === key)
    ?.value
}

describe('Smylr component Code Objects', () => {
  test('keeps one Code Object per component variant without resetting authored metadata', () => {
    const store = createEditorStore()
    const asset = SMYLR_COMPUTED_ASSETS.find((candidate) => candidate.fixtureId === 'button')
    if (!asset) throw new Error('Button asset missing')

    const first = ensureSmylrComponentCodeObjectCanvas(store, asset, 'destructive')
    const document = codeObjectDocument(first.frame)
    if (document?.component !== 'smylr-production-app') {
      throw new Error('Smylr production document missing')
    }
    store.graph.updateNode(first.frame.id, {
      pluginData: [
        ...first.frame.pluginData,
        { key: 'note', pluginId: 'user', value: 'Authored locally' }
      ]
    })

    const second = ensureSmylrComponentCodeObjectCanvas(store, asset, 'destructive')
    const restored = codeObjectDocument(second.frame)

    expect(second.page.id).toBe(first.page.id)
    expect(second.frame.id).toBe(first.frame.id)
    expect(pluginValue(second.page, 'kind')).toBe(SMYLR_COMPONENT_CODE_OBJECT_PAGE_KIND)
    expect(isSmylrComponentCodeObject(second.frame)).toBe(true)
    expect(restored?.component).toBe('smylr-production-app')
    expect(restored?.route).toContain('component=button')
    expect(
      second.frame.pluginData.find((entry) => entry.pluginId === 'user' && entry.key === 'note')
        ?.value
    ).toBe('Authored locally')
  })

  test('places one ordinary Code Object on the Board with Undo and Redo', () => {
    const store = createEditorStore()
    const asset = SMYLR_COMPUTED_ASSETS.find((candidate) => candidate.fixtureId === 'badge')
    if (!asset) throw new Error('Badge asset missing')

    const frame = placeSmylrComponentCodeObject(store, asset, 'warning', 420, 280)

    expect(frame.parentId).toBe(store.state.currentPageId)
    expect(frame.x + frame.width / 2).toBe(420)
    expect(frame.y + frame.height / 2).toBe(280)
    expect(isSmylrComponentCodeObject(frame)).toBe(true)
    expect(codeObjectDocument(frame)?.component).toBe('smylr-production-app')
    expect(store.state.selectedIds).toEqual(new Set([frame.id]))

    store.undoAction()
    expect(store.graph.getNode(frame.id)).toBeUndefined()

    store.redoAction()
    expect(isSmylrComponentCodeObject(store.graph.getNode(frame.id))).toBe(true)
    expect(store.state.selectedIds).toEqual(new Set([frame.id]))
  })
})
