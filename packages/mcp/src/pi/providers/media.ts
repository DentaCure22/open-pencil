import { isXaiMediaToolName } from './xai/media'

const PROVIDER_MEDIA_TOOL_MATCHERS: readonly ((normalizedName: string) => boolean)[] = [
  isXaiMediaToolName
]

export function isProviderMediaToolName(normalizedName: string): boolean {
  return PROVIDER_MEDIA_TOOL_MATCHERS.some((matches) => matches(normalizedName))
}
