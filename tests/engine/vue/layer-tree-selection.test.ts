import { describe, expect, test } from 'bun:test'

describe('Layer tree selection semantics', () => {
  test('binds the Reka tree selection model to editor-selected items', async () => {
    const root = await Bun.file('packages/vue/src/primitives/LayerTree/LayerTreeRoot.vue').text()

    expect(root).toContain('const selectedTreeItems = computed')
    expect(root).toContain(':model-value="selectedTreeItems"')
    expect(root).toContain('selection-behavior="replace"')
    expect(root).toContain('multiple')
  })
})
