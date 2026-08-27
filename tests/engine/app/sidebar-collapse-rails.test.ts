import { describe, expect, test } from 'bun:test'

describe('sidebar collapse rails', () => {
  test('keeps full-height close rails separate from both resize handles', async () => {
    const [editor, rightWorkspace] = await Promise.all([
      Bun.file('src/views/EditorView.vue').text(),
      Bun.file('src/components/ai-elements/T3RightPanelWorkspace.tsx').text()
    ])

    expect(editor).toContain('data-sidebar-collapse-rail="true"')
    expect(editor).toContain(':style="leftSidebarCloseRailStyle"')
    expect(editor).toContain('const leftSidebarCloseRailStyle')
    expect(editor).not.toContain('leftSidebarEdgePercent.value}% + 20px')
    expect(editor).toContain('absolute inset-y-0')
    expect(editor).toContain('w-5 cursor-pointer bg-transparent')
    expect(editor).toContain('group-hover/sidebar-rail:opacity-100')
    expect(editor).toContain('data-sidebar-collapse-arrow="true"')
    expect(editor).toContain('data-sidebar-collapse-divider="true"')
    expect(editor).toContain('peer-hover/sidebar-arrow:opacity-0!')
    expect(editor).toContain('data-test-id="left-splitter-handle"')
    expect(editor).toContain('w-5 -translate-x-full cursor-col-resize')
    expect(editor).not.toContain('group/sidebar-hinge')

    expect(rightWorkspace).toContain('data-sidebar-collapse-rail="true"')
    expect(rightWorkspace).toContain('style={{ right: width + 12 }}')
    expect(rightWorkspace).toContain('fixed inset-y-0')
    expect(rightWorkspace).toContain('w-5 cursor-pointer bg-transparent')
    expect(rightWorkspace).toContain('group-hover/right-sidebar-rail:opacity-100')
    expect(rightWorkspace).toContain('data-sidebar-collapse-arrow="true"')
    expect(rightWorkspace).toContain('data-sidebar-collapse-divider="true"')
    expect(rightWorkspace).toContain('peer-hover/right-sidebar-arrow:opacity-0!')
    expect(rightWorkspace).toContain('data-test-id="t3-right-panel-resize-handle"')
    expect(rightWorkspace).toContain('fixed z-[71] w-5 touch-none')
    expect(rightWorkspace).not.toContain('group/right-sidebar-hinge')
  })
})
