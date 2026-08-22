import { describe, expect, test } from 'bun:test'

describe('editor loading contract', () => {
  test('announces loading and blocks mutation chrome and shortcuts', async () => {
    const [editorView, keyboard] = await Promise.all([
      Bun.file('src/views/EditorView.vue').text(),
      Bun.file('src/app/shell/keyboard/registry.ts').text()
    ])

    expect(editorView).toContain(':aria-busy="store.state.loading"')
    expect(editorView).toContain(':inert="store.state.loading ? true : undefined"')
    expect(keyboard).toContain('options.store.state.loading && !loadingSafeBindings.has(keys)')
    expect(keyboard).toContain("...commandShortcuts('edit.undo', 'selection.duplicate'")
    expect(keyboard).toContain('allowWhenLoading: true')
  })
})
