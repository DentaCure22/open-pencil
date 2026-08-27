import { describe, expect, test } from 'bun:test'

import { createCodeObjectFromPreset } from '@/app/code-object/model'
import { codeObjectFramesForOverlay, overlayListNeedsRescan } from '@/app/code-object/overlays'
import { createEditorStore } from '@/app/editor/session'

describe('Code Object overlays', () => {
  test('keeps agent conversation surfaces painted without a pause placeholder', async () => {
    const overlays = await Bun.file('src/components/canvas/CodeObjectOverlays.vue').text()
    expect(overlays).toContain('v-if="agentDocumentFor(frame) && conversationSurfacesReady"')
    expect(overlays).toContain('bg-agent-surface shadow-agent-card')
    expect(overlays).toContain('Boolean(agentDocumentFor(frame))')
    expect(overlays).toContain('if (liveSurface) return sized')
    expect(overlays).toContain('conversationSurfacesReady.value = true')
    expect(overlays).toContain("store.onEditorEvent('hover:changed', syncOwnedHoverChrome)")
    expect(overlays).toContain('data-[hovered]:outline')
    expect(overlays).toContain('hover:outline-component/70')
    expect(overlays).not.toContain('@pointerenter="hoverShape(frame.id)"')
    expect(overlays).not.toContain('@mouseenter="hoverShape(frame.id)"')
    expect(overlays.match(/:data-code-object-id="frame.id"/g)).toEqual([
      ':data-code-object-id="frame.id"'
    ])
    expect(overlays).not.toContain(':data-hovered')
    expect(overlays).toContain('contentVisibility')
    expect(overlays).toContain('containIntrinsicSize')
    expect(overlays).not.toContain('Paused · select to resume')
    expect(overlays).not.toContain('data-test-id="code-object-runtime-paused"')
    expect(overlays).not.toContain('data-test-id="smylr-trusted-web-app-paused"')
  })

  test('refreshes the overlay list from graph events, not only sceneVersion', async () => {
    const [overlays, overlayList] = await Promise.all([
      Bun.file('src/components/canvas/CodeObjectOverlays.vue').text(),
      Bun.file('src/app/code-object/overlays.ts').text()
    ])
    expect(overlays).toContain('void syncTick.value')
    expect(overlays).toContain("store.onEditorEvent('graph:replaced'")
    expect(overlays).toContain('useEditorNodeOverlayStyle')
    expect(overlays).toContain('cachedCodeObjectDocument')
    expect(overlays).not.toContain("store.onEditorEvent('node:previewUpdated'")
    expect(overlays).not.toContain("store.onEditorEvent('tool:changed', sync)")
    expect(overlayList).toContain('overlayDocumentCache')
    expect(overlayList).toContain('overlayListNeedsRescan')
    expect(overlayList).toContain('for (const childId of parent.childIds)')
    expect(overlayList).not.toContain('graph.getChildren')
    expect(overlays).toContain('overlayListNeedsRescan(changes)')
    expect(overlays).not.toContain(
      "store.onEditorEvent('node:updated', (id, changes) => {\n      sync()"
    )
  })

  test('does not rescan overlay frames for move-only updates', () => {
    expect(overlayListNeedsRescan({ x: 40, y: 80 })).toBe(false)
    expect(overlayListNeedsRescan({ width: 320, height: 200 })).toBe(false)
    expect(overlayListNeedsRescan({ visible: false })).toBe(true)
    expect(overlayListNeedsRescan({ pluginData: [] })).toBe(true)
  })

  test('does not write residency back into its own computed input on every tick', async () => {
    const residency = await Bun.file(
      'src/components/canvas/useCodeObjectRuntimeResidency.ts'
    ).text()
    expect(residency).toContain('sameStringSet(residentFrameIds.value, frameIds)')
    expect(residency).toContain('[...activeFrameIds.value].sort().join')
    expect(residency).not.toContain('disposeCodeObjectsExcept')
  })

  test('leaves Object-panel opening to the contextual selection controls', async () => {
    const [overlays, selectionTools] = await Promise.all([
      Bun.file('src/components/canvas/CodeObjectOverlays.vue').text(),
      Bun.file('src/components/Toolbar/SelectionToolControls.vue').text()
    ])

    expect(overlays).not.toContain('data-test-id="open-code-object"')
    expect(overlays).not.toContain('data-test-id="code-object-frame-chrome"')
    expect(overlays).not.toContain('data-test-id="code-object-frame-title"')
    expect(selectionTools).toContain('data-test-id="selection-open-object"')
    expect(selectionTools).toContain("openAgentRightPanel('object', { objectId: object.id })")
  })

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
