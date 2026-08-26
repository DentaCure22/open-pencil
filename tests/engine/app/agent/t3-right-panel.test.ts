import { describe, expect, test } from 'bun:test'

import {
  getT3RightPanelDefaultWidth,
  getT3RightPanelMaxWidth,
  parseT3DiffAnnotationSourceId,
  parseT3UnifiedPatch,
  t3DiffAnnotationSourceId,
  t3DiffRangeLabel,
  t3DiffSelectionQuote
} from '@/components/ai-elements/t3-right-panel.logic'

const file = {
  additions: 2,
  deletions: 1,
  patch: [
    'diff --git a/src/demo.ts b/src/demo.ts',
    'index 1111111..2222222 100644',
    '--- a/src/demo.ts',
    '+++ b/src/demo.ts',
    '@@ -8,3 +8,4 @@',
    ' const before = true',
    '-const count = 1',
    '+const count = 2',
    '+const ready = true',
    ' return count'
  ].join('\n'),
  path: 'src/demo.ts',
  status: 'modified' as const
}

describe('T3 right-panel diff logic', () => {
  test('parses unified patches with old and new line numbers', () => {
    const parsed = parseT3UnifiedPatch(file)
    expect(parsed.lines.map((line) => [line.kind, line.oldLine, line.newLine])).toEqual([
      ['hunk', null, null],
      ['context', 8, 8],
      ['deletion', 9, null],
      ['addition', null, 9],
      ['addition', null, 10],
      ['context', 10, 11]
    ])
  })

  test('builds review labels and source-backed composer context', () => {
    const parsed = parseT3UnifiedPatch(file)
    const selection = { endIndex: 4, path: file.path, startIndex: 2 }
    expect(t3DiffRangeLabel(parsed, selection)).toBe('lines 9–10')
    expect(t3DiffSelectionQuote(parsed, selection)).toContain('File: src/demo.ts')
    expect(t3DiffSelectionQuote(parsed, selection)).toContain('-const count = 1')
    expect(t3DiffSelectionQuote(parsed, selection)).toContain('+const ready = true')
  })

  test('round trips thread-scoped diff annotation targets', () => {
    const target = {
      capturedAt: '2026-08-25T15:30:00.000Z',
      endIndex: 8,
      path: 'src/components/Some File.vue',
      startIndex: 3
    }
    expect(parseT3DiffAnnotationSourceId(t3DiffAnnotationSourceId(target))).toEqual(target)
  })

  test('matches T3 panel width constraints', () => {
    expect(getT3RightPanelDefaultWidth(1200)).toBe(240)
    expect(getT3RightPanelDefaultWidth(1600)).toBe(320)
    expect(getT3RightPanelMaxWidth(1200)).toBe(400)
    expect(getT3RightPanelMaxWidth(843)).toBe(281)
    expect(getT3RightPanelMaxWidth(1600, 900)).toBe(533)
  })
})
