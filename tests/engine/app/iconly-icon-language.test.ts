import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')

function source(path: string) {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('Iconly interface icon language', () => {
  test('keeps the free Iconly Essential paths local and theme-aware', () => {
    const icon = source('src/components/icons/IconlyIcon.vue')

    const names = source('src/components/icons/iconly-types.ts')

    expect(names).toContain("| 'chat'")
    expect(names).toContain("| 'search'")
    expect(names).toContain("| 'setting'")
    expect(icon).toContain('stroke="currentColor"')
    expect(icon).toContain(':data-iconly="name"')
    expect(icon).not.toContain('stroke="#000000"')
  })

  test('uses Iconly for the primary shell and work-map vocabulary', () => {
    const desktopToolbar = source('src/components/Toolbar/DesktopToolbar.vue')
    const appMenu = source('src/components/Shell/AppMenu.vue')
    const workMap = source('src/components/agent-chat/AgentChatsPanel.vue')

    expect(desktopToolbar).toContain('IconlyChat')
    expect(appMenu).toContain('IconlySetting')
    expect(workMap).toContain('<IconlyIcon name="search"')
    expect(workMap).toContain('name="arrow-down"')
    expect(workMap).toContain('name="plus"')
    expect(workMap).toContain('workMapStatusIconNames')
    expect(workMap).toContain("finished: 'shield-done'")
  })
})
