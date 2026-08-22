import { describe, expect, test } from 'bun:test'

describe('panel section accessibility', () => {
  test('uses headings instead of orphan labels for inspector sections', async () => {
    const section = await Bun.file('src/components/ui/PanelSection.vue').text()

    expect(section).toContain('<h3 :class="sectionCls.label">{{ label }}</h3>')
    expect(section).not.toContain('<label')
  })
})
