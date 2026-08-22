import type { Page } from '@playwright/test'

export async function setLocalStorageItem(page: Page, key: string, value: string): Promise<void> {
  await page.addInitScript(
    ({ storageKey, storageValue }) => localStorage.setItem(storageKey, storageValue),
    { storageKey: key, storageValue: value }
  )
}
