import { describe, expect, test } from 'bun:test'

describe('Work Map tree connectors', () => {
  test('keeps populated lanes continuous and empty lanes terminal', async () => {
    const panel = await Bun.file('src/components/agent-chat/WorkMapProjectTree.vue').text()

    expect(panel).not.toContain('after:border-l after:border-chrome-border/70')
    expect(panel).not.toContain('before:bottom-[17px]')
    expect(panel).not.toContain('before:bottom-[15px]')

    expect(panel).toContain('v-for="(bot, botIndex) in entry.bots"')
    expect(panel).toMatch(/v-for="\(todo, todoIndex\) in [^"]+\.items"/)
    expect(panel).toContain("? 'after:h-2.5'")
    expect(panel).toContain(": 'after:h-full'")
    expect(panel).toContain(
      'after:pointer-events-none after:absolute after:top-0 after:-left-3 after:border-l after:border-work-map-tree'
    )

    expect(panel).toContain(
      'before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree'
    )
    expect(panel).toContain('before:top-2.5 before:-left-3 before:h-1.5')
    expect(panel).toContain('after:h-2 after:border-l after:border-work-map-tree')
    expect(panel).toMatch(
      /v-if="!entry\.bots\.length"[\s\S]*?before:rounded-bl-\[6px\][\s\S]*?>\s*No bots\s*<\/div>/
    )
    expect(panel).toMatch(
      /v-if="![^"]+\.total"[\s\S]*?before:rounded-bl-\[6px\][\s\S]*?>\s*No tasks\s*<\/div>/
    )
  })
})
