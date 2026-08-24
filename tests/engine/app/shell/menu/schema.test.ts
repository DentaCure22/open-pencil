import { describe, expect, test } from 'bun:test'

import type { AppMenuEntry } from '@/app/shell/menu/schema'
import { APP_MENU_SCHEMA } from '@/app/shell/menu/schema'

function actionItems(entries: readonly AppMenuEntry[]): AppMenuEntry[] {
  const result: AppMenuEntry[] = []
  for (const entry of entries) {
    if ('type' in entry && entry.type === 'separator') continue
    result.push(entry)
    if (entry.sub) result.push(...actionItems(entry.sub))
  }
  return result
}

describe('APP_MENU_SCHEMA', () => {
  test('offers Model meter from Settings', () => {
    const settings = APP_MENU_SCHEMA.find((group) => group.label === 'Settings')

    expect(settings?.items).toContainEqual({
      id: 'model-meter',
      label: 'Cache'
    })
  })

  test('offers Mermaid as a first-class insert action', () => {
    const insert = APP_MENU_SCHEMA.find((group) => group.label === 'Insert')

    expect(insert?.items).toContainEqual({
      id: 'insert-mermaid',
      label: 'Mermaid diagram…'
    })
  })

  test('does not duplicate shortcuts for command-backed entries', () => {
    const duplicated = APP_MENU_SCHEMA.flatMap((group) =>
      actionItems(group.items).filter(
        (entry) => !('type' in entry) && entry.command && entry.shortcut
      )
    )

    expect(duplicated).toEqual([])
  })
})
