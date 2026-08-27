import { describe, expect, test } from 'bun:test'

describe('responsive desktop toolbar', () => {
  test('keeps trailing utilities fixed while editor tools scroll inside side chrome', async () => {
    const [toolbar, bounds, button] = await Promise.all([
      Bun.file('src/components/Toolbar/DesktopToolbar.vue').text(),
      Bun.file('src/app/shell/bottom-toolbar-bounds.ts').text(),
      Bun.file('src/components/Toolbar/ToolButton.vue').text()
    ])

    expect(toolbar).toContain('data-toolbar-left-inset')
    expect(toolbar).toContain('data-toolbar-right-inset')
    expect(bounds).toContain('[data-test-id="layers-shell-motion"][data-sidebar-open="true"]')
    expect(bounds).toContain('[data-test-id="t3-right-panel"][data-state="open"]')
    expect(bounds).not.toContain('[data-test-id="canvas-zoom-controls"]')
    expect(toolbar).toContain('data-test-id="toolbar-scroll-viewport"')
    expect(toolbar).toContain('data-test-id="toolbar-scroll-track"')
    expect(toolbar).toContain('data-test-id="toolbar-fixed-utilities"')
    expect(toolbar).toContain('scrollbar-none min-w-0 max-w-full overflow-x-auto')
    expect(toolbar).toContain("embedded ? 'overflow-visible' : 'flex-1'")
    expect(toolbar).toContain('class="flex shrink-0 items-center gap-0.5"')
    expect(toolbar).toContain('@wheel.stop="scrollToolbarTools"')
    expect(toolbar).toContain("?.scrollIntoView({ block: 'nearest', inline: 'nearest' })")

    expect(toolbar).toContain('class="absolute inset-0 origin-center rounded-[10px] bg-hover"')
    expect(toolbar).not.toContain('class="absolute inset-0 origin-center rounded-[10px] bg-accent"')
    expect(button).toContain(": 'bg-transparent text-surface'")
    expect(button).toContain("mobile ? 'rounded-[6px] select-none' : 'rounded-[10px]'")
    expect(toolbar).toContain('<WorkspaceButton />')
    expect(toolbar).toContain('<CollabPanel />')
    const workspaceToShare = toolbar.slice(
      toolbar.indexOf('<WorkspaceButton />') + '<WorkspaceButton />'.length,
      toolbar.indexOf('<CollabPanel />')
    )
    expect(workspaceToShare).not.toContain('bg-border')
  })
})
