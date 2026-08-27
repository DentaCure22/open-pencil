import type { Page } from '@playwright/test'

export async function getLocalStorageItem(page: Page, key: string): Promise<string | null> {
  return page.evaluate((storageKey) => localStorage.getItem(storageKey), key)
}

export async function setLocalStorageItem(page: Page, key: string, value: string): Promise<void> {
  await page.addInitScript(
    ({ storageKey, storageValue }) => localStorage.setItem(storageKey, storageValue),
    { storageKey: key, storageValue: value }
  )
}
