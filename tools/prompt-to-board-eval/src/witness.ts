import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { EvalLogWriter, type EvalLogAppendSink, type EvalLogGeneratedBatch } from './io'
import { createEvalEvent, parseEvalTarget, type EvalEvent, type EvalTarget } from './schema'

export interface PixelWitnessOptions {
  eventLogPath: string
  mappingErrorMs?: number
  qualityGrade: string
  qualityPassed: boolean
  reviewedBy: string
  screenshotPath: string
  target: EvalTarget
  visibleAtMs?: number
}

function observed() {
  return { epochMs: Date.now(), monotonicMs: performance.now() }
}

function witnessBatch(
  options: PixelWitnessOptions,
  last: Readonly<EvalEvent>,
  screenshotSha256: string
): EvalLogGeneratedBatch<string> {
  const target = parseEvalTarget(options.target)
  const pixelTime = observed()
  const visibleAtMs = options.visibleAtMs ?? pixelTime.epochMs
  if (!Number.isInteger(visibleAtMs) || visibleAtMs < 0 || visibleAtMs > pixelTime.epochMs) {
    throw new Error('Pixel witness visibleAtMs must be a past epoch millisecond.')
  }
  const pixelObservedAtMs = Math.max(pixelTime.epochMs, last.observed_at_ms)
  const pixelObservedMonotonicMs = Math.max(pixelTime.monotonicMs, last.observed_monotonic_ms)
  const pixelEvent = createEvalEvent({
    data: {
      artifact_visible: true,
      clock_basis:
        options.visibleAtMs === undefined ? 'recorder_ingestion' : 'browser_time_origin_projection',
      mapping_error_ms: options.mappingErrorMs ?? 0,
      screenshot_path: options.screenshotPath,
      screenshot_sha256: screenshotSha256,
      target,
      visible_at_ms: visibleAtMs
    },
    kind: 'pixel_witness_captured',
    observed_at_ms: pixelObservedAtMs,
    observed_monotonic_ms: pixelObservedMonotonicMs,
    precision_ms: 1,
    recorder_id: last.recorder_id,
    run_id: last.run_id,
    sequence: last.sequence + 1,
    source: 'browser'
  })
  return { events: [pixelEvent], value: screenshotSha256 }
}

function checkedScreenshotHash(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error('Pixel witness screenshot hash must be a SHA-256 digest.')
  }
  return value
}

export function emitPixelWitnessWithHash(
  options: PixelWitnessOptions,
  screenshotSha256: string,
  sink: EvalLogAppendSink
): Promise<string> {
  const checked = checkedScreenshotHash(screenshotSha256)
  return sink.appendGenerated((last) => witnessBatch(options, last, checked))
}

export async function emitPixelWitness(
  options: PixelWitnessOptions,
  sink: EvalLogAppendSink
): Promise<string> {
  const bytes = await readFile(options.screenshotPath)
  return emitPixelWitnessWithHash(options, createHash('sha256').update(bytes).digest('hex'), sink)
}

export async function appendPixelWitnessWithHash(
  options: PixelWitnessOptions,
  screenshotSha256: string
): Promise<string> {
  const writer = await EvalLogWriter.open(options.eventLogPath)
  return emitPixelWitnessWithHash(options, screenshotSha256, writer)
}

export async function appendPixelWitness(options: PixelWitnessOptions): Promise<string> {
  const bytes = await readFile(options.screenshotPath)
  return appendPixelWitnessWithHash(options, createHash('sha256').update(bytes).digest('hex'))
}
