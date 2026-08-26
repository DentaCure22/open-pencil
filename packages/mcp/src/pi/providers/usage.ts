import type { PiProviderUsageProbe } from '#mcp/pi/provider-usage'

import { XAI_PROVIDER_USAGE_PROBE } from './xai/usage'

export const DEFAULT_PROVIDER_USAGE_PROBES: readonly PiProviderUsageProbe[] = [
  XAI_PROVIDER_USAGE_PROBE
]
