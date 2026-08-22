import { describe, expect, test } from 'bun:test'

import { createCodeObjectFromPreset } from '@/app/code-object/model'
import { codeObjectFramesForOverlay } from '@/app/code-object/overlays'
import { createEditorStore } from '@/app/editor/session'

describe('Code Object overlays', () => {
  test('mounts one runtime when persisted page children repeat a frame id', () => {
    const store = createEditorStore()
    const frame = createCodeObjectFromPreset(store, 'earth-signals')
    if (!frame) throw new Error('Earth signals preset was not created')

    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Current page was not created')
    page.childIds.push(frame.id)

    expect(page.childIds.filter((id) => id === frame.id)).toHaveLength(2)
    expect(codeObjectFramesForOverlay(store.graph, page.id)).toEqual([frame])
  })
})
