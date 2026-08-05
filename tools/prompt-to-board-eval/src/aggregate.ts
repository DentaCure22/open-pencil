import type { EvalRunSummary } from './schema'

export interface MetricDistribution {
  count: number
  maximum: number | null
  median: number | null
  minimum: number | null
  p95: number | null
}

export interface CampaignAggregate {
  config: EvalRunSummary['metadata']['config'] | null
  classifications: {
    headless_durable_pass: number
    invalid: number
    safe_stop_pass: number
    strict_visible_pass: number
  }
  failures: Record<string, number>
  metrics_ms: {
    operational_command_execution: MetricDistribution
    prompt_to_authoritative: MetricDistribution
    prompt_to_final: MetricDistribution
    prompt_to_first_board_tool: MetricDistribution
    prompt_to_first_tool: MetricDistribution
    prompt_to_semantic_review: MetricDistribution
    prompt_to_visible: MetricDistribution
  }
  total_runs: number
  witness_rates: {
    durability: number
    pixel: number
    receipt: number
    render: number
    semantic_quality: number
    visual_quality: number
  }
}

function percentile(sorted: number[], ratio: number): number | null {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index] ?? null
}

export function metricDistribution(values: Array<number | null>): MetricDistribution {
  const sorted = values
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0)
    .toSorted((left, right) => left - right)
  return {
    count: sorted.length,
    maximum: sorted.at(-1) ?? null,
    median: percentile(sorted, 0.5),
    minimum: sorted.at(0) ?? null,
    p95: percentile(sorted, 0.95)
  }
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

export function classifyEvalSummary(
  summary: EvalRunSummary
): keyof CampaignAggregate['classifications'] {
  if (!summary.valid) return 'invalid'
  if (summary.metadata.expected_outcome === 'safe_stop') return 'safe_stop_pass'
  if (
    summary.metadata.requirements.pixel_witness &&
    summary.witnesses.pixel &&
    summary.metadata.requirements.semantic_quality &&
    summary.witnesses.semantic_quality
  ) {
    return 'strict_visible_pass'
  }
  return 'headless_durable_pass'
}

export function aggregateCampaign(summaries: EvalRunSummary[]): CampaignAggregate {
  const config = summaries.at(0)?.metadata.config ?? null
  for (const summary of summaries.slice(1)) {
    if (
      summary.metadata.config.config_id !== config?.config_id ||
      summary.metadata.config.measurement_class !== config.measurement_class
    ) {
      throw new Error(
        'Campaign aggregation cannot pool different configuration IDs or measurement classes.'
      )
    }
  }
  const classifications: CampaignAggregate['classifications'] = {
    headless_durable_pass: 0,
    invalid: 0,
    safe_stop_pass: 0,
    strict_visible_pass: 0
  }
  const failures: Record<string, number> = {}
  for (const summary of summaries) {
    classifications[classifyEvalSummary(summary)] += 1
    for (const failure of summary.failures) increment(failures, failure)
  }
  const total = summaries.length
  return {
    classifications,
    config,
    failures,
    metrics_ms: {
      operational_command_execution: metricDistribution(
        summaries.map((summary) => summary.timings_ms.command_execution_total)
      ),
      prompt_to_authoritative: metricDistribution(
        summaries.map((summary) => summary.timings_ms.prompt_to_authoritative)
      ),
      prompt_to_final: metricDistribution(
        summaries.map((summary) => summary.timings_ms.prompt_to_final)
      ),
      prompt_to_first_board_tool: metricDistribution(
        summaries.map((summary) => summary.timings_ms.prompt_to_first_board_tool)
      ),
      prompt_to_first_tool: metricDistribution(
        summaries.map((summary) => summary.timings_ms.prompt_to_first_tool)
      ),
      prompt_to_semantic_review: metricDistribution(
        summaries.map((summary) => summary.timings_ms.prompt_to_semantic_review)
      ),
      prompt_to_visible: metricDistribution(
        summaries.map((summary) => summary.timings_ms.prompt_to_visible)
      )
    },
    total_runs: total,
    witness_rates: {
      durability: rate(summaries.filter((summary) => summary.witnesses.durability).length, total),
      pixel: rate(summaries.filter((summary) => summary.witnesses.pixel).length, total),
      receipt: rate(summaries.filter((summary) => summary.witnesses.receipt).length, total),
      render: rate(summaries.filter((summary) => summary.witnesses.render).length, total),
      semantic_quality: rate(
        summaries.filter((summary) => summary.witnesses.semantic_quality).length,
        total
      ),
      visual_quality: rate(
        summaries.filter((summary) => summary.witnesses.visual_quality).length,
        total
      )
    }
  }
}
