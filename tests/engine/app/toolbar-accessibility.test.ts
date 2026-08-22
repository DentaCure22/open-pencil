import { describe, expect, test } from 'bun:test'

describe('toolbar accessibility contracts', () => {
  test('exposes tool state and names mobile navigation controls', async () => {
    const [button, desktop, mobile, actions] = await Promise.all([
      Bun.file('src/components/Toolbar/ToolButton.vue').text(),
      Bun.file('src/components/Toolbar/DesktopToolbar.vue').text(),
      Bun.file('src/components/Toolbar/MobileToolbar.vue').text(),
      Bun.file('src/components/Toolbar/ToolbarActionGroup.vue').text()
    ])

    expect(button).toContain(':aria-pressed="pressed"')
    expect(button).toContain('<ToolbarButton as-child>')
    expect(desktop).toContain('<RekaToolbarRoot as-child orientation="vertical" loop>')
    expect(desktop).toContain(':pressed="isActive(tool)"')
    expect(mobile).toContain('aria-label="Previous tool group"')
    expect(mobile).toContain(':disabled="!hasPrev"')
    expect(mobile).toContain('aria-label="Next tool group"')
    expect(mobile).toContain(':disabled="!hasNext"')
    expect(actions).toContain(':aria-label="item.label"')
  })
})
