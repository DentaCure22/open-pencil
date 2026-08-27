import { describe, expect, test } from 'bun:test'

describe('collapsed sidebar floating tab', () => {
  test('uses one detached, centered reopen control without drag behavior', async () => {
    const [editor, toolbar] = await Promise.all([
      Bun.file('src/views/EditorView.vue').text(),
      Bun.file('src/components/Toolbar/DesktopToolbar.vue').text()
    ])

    expect(editor).toContain("'transition-[translate,opacity] duration-300 ease-in-out'")
    expect(editor).toContain("'pointer-events-none -translate-x-[calc(100%+1rem)] opacity-0'")
    expect(editor).toContain('sidebar-tab-only')
    expect(editor).not.toContain('sidebar-compact-tab-drag-handle')
    expect(editor).not.toContain('useDraggable')
    expect(editor).not.toContain('openpencil-sidebar-full-frame-tab-y-v1')

    expect(toolbar).toContain(":aria-label=\"sidebarTabOnly ? 'Sidebar' : 'Editor tools'\"")
    expect(toolbar).toContain(
      "? 'bg-chrome/90 absolute top-1/2 left-3 h-11 w-7 -translate-y-1/2 overflow-clip rounded-[11px] shadow-sm backdrop-blur-xl'"
    )
    expect(toolbar).toContain("? 'inset-0 h-11 w-7 rounded-[10px] border border-chrome-border")
    expect(toolbar).toContain('v-if="sidebarTabOnly || !sidebarOpen"')
    expect(toolbar).not.toContain('Open sidebar · drag the grip to move')
  })
})
