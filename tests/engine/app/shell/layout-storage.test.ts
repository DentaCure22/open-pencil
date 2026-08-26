import { describe, expect, test } from 'bun:test'

import { LEFT_SIDEBAR_DEFAULT_PERCENT, normalizeEditorLayout } from '@/app/shell/layout-storage'

describe('editor layout storage', () => {
  test('defaults the left sidebar to 20% and caps it at 33%', () => {
    expect(LEFT_SIDEBAR_DEFAULT_PERCENT).toBe(20)
    expect(normalizeEditorLayout([])).toEqual([20, 80])
    expect(normalizeEditorLayout([28, 72])).toEqual([28, 72])
    expect(normalizeEditorLayout([45, 55])).toEqual([33, 67])
  })
})
