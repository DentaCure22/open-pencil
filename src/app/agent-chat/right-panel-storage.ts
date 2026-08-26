import { readSessionCacheText, writeSessionCacheText } from '@/app/cache'

const WIDTH_STORAGE_KEY = 'open-pencil:t3-right-panel-width-v1'

export function readAgentRightPanelWidth(fallback: number): number {
  const stored = Number.parseFloat(readSessionCacheText(WIDTH_STORAGE_KEY) ?? '')
  return Number.isFinite(stored) ? stored : fallback
}

export function writeAgentRightPanelWidth(width: number): void {
  writeSessionCacheText(WIDTH_STORAGE_KEY, String(width))
}
