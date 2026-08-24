export type ModelMeterRow = {
  callHitPercent: number
  estimatedPercent: number
  lastAt: string | null
  model: string
  promptTokens: number
  provider: string
  tokenCachePercent: number
  turns: number
}

export type ModelMeterSeriesPoint = {
  at: string
  cachePercent: number
}

export type ModelMeterSnapshot = {
  available: boolean
  days: number
  lastAt: string | null
  rows: ModelMeterRow[]
  series: ModelMeterSeriesPoint[]
  turns: number
}
