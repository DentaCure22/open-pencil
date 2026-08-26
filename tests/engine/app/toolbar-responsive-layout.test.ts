import { describe, expect, test } from 'bun:test'

describe('responsive desktop toolbar', () => {
  test('stays inside side chrome and scrolls one continuous control track', async () => {
    const [toolbar, bounds] = await Promise.all([
      Bun.file('src/components/Toolbar/DesktopToolbar.vue').text(),
      Bun.file('src/app/shell/bottom-toolbar-bounds.ts').text()
    ])

    expect(toolbar).toContain('data-toolbar-left-inset')
    expect(toolbar).toContain('data-toolbar-right-inset')
    expect(bounds).toContain('[data-test-id="layers-shell-motion"][data-sidebar-open="true"]')
    expect(bounds).toContain('[data-test-id="t3-right-panel"][data-state="open"]')
    expect(bounds).toContain('[data-test-id="canvas-zoom-controls"]')
    expect(toolbar).toContain('data-test-id="toolbar-scroll-viewport"')
    expect(toolbar).toContain('data-test-id="toolbar-scroll-track"')
    expect(toolbar).toContain('scrollbar-none min-w-0 max-w-full overflow-x-auto')
    expect(toolbar).toContain('@wheel.stop="scrollToolbarTools"')
    expect(toolbar).toContain("?.scrollIntoView({ block: 'nearest', inline: 'nearest' })")
  })
})
