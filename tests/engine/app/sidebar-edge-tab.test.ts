import { describe, expect, test } from 'bun:test'

describe('collapsed sidebar edge tab', () => {
  test('uses one fixed, centered reopen control without drag behavior', async () => {
    const [editor, toolbar] = await Promise.all([
      Bun.file('src/views/EditorView.vue').text(),
      Bun.file('src/components/Toolbar/DesktopToolbar.vue').text()
    ])

    expect(editor).toContain("'left-0 h-11 w-7 min-w-7 rounded-r-[11px]")
    expect(editor).toContain('absolute top-1/2')
    expect(editor).toContain('-translate-y-1/2')
    expect(editor).not.toContain('sidebar-compact-tab-drag-handle')
    expect(editor).not.toContain('useDraggable')
    expect(editor).not.toContain('openpencil-sidebar-full-frame-tab-y-v1')

    expect(toolbar).toContain(":aria-label=\"sidebarTabOnly ? 'Sidebar' : 'Editor tools'\"")
    expect(toolbar).toContain("? 'absolute top-1/2 left-0 h-11 w-7 -translate-y-1/2'")
    expect(toolbar).toContain(
      "? 'inset-0 h-11 w-7 rounded-r-[10px] border-y border-r border-chrome-border"
    )
    expect(toolbar).toContain('<icon-lucide-panel-left-open v-else')
    expect(toolbar).not.toContain('Open sidebar · drag the grip to move')
  })
})
