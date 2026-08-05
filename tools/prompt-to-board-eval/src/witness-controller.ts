import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { EvalLogAppendSink } from './io'
import { type EvalTarget, parseEvalTarget } from './schema'
import { appendPixelWitnessWithHash, emitPixelWitnessWithHash } from './witness'

export const PIXEL_WITNESS_FAILURE_CODES = [
  'pixel_browser_crashed',
  'pixel_browser_closed',
  'pixel_target_mismatch',
  'pixel_unavailable',
  'pixel_invalid_screenshot'
] as const

export type PixelWitnessFailureCode = (typeof PIXEL_WITNESS_FAILURE_CODES)[number]
export type PixelWitnessSurfaceFailure = 'closed' | 'crashed' | 'unavailable'

export type PixelWitnessStepResult<T> =
  | { status: 'ok'; value: T }
  | { detail?: string; status: PixelWitnessSurfaceFailure }

export interface PixelWitnessCapture {
  mappingErrorMs?: number
  screenshotPath: string
  target: EvalTarget
  visibleAtMs?: number
}

export interface PixelWitnessDriver {
  captureScreenshot(target: EvalTarget): Promise<PixelWitnessStepResult<PixelWitnessCapture>>
  waitForRender(target: EvalTarget): Promise<PixelWitnessStepResult<{ target: EvalTarget }>>
}

export interface PixelWitnessCompletionOptions {
  eventLogPath?: string
  qualityGrade: string
  qualityPassed: boolean
  reviewedBy: string
  target: EvalTarget
}

export type BufferedFinalState = 'buffered' | 'releasing' | 'released' | 'failed'

export class BufferedFinalCoordinator<T> {
  #state: BufferedFinalState = 'buffered'

  constructor(private readonly releaseFinal: () => T | Promise<T>) {}

  get state(): BufferedFinalState {
    return this.#state
  }

  async releaseAfter<TProof>(captureProof: () => Promise<TProof>): Promise<{
    final: T
    proof: TProof
  }> {
    if (this.#state !== 'buffered') {
      throw new Error(`Buffered final cannot be released from state ${this.#state}.`)
    }
    this.#state = 'releasing'
    try {
      const proof = await captureProof()
      const final = await this.releaseFinal()
      this.#state = 'released'
      return { final, proof }
    } catch (error) {
      this.#state = 'failed'
      throw error
    }
  }
}

export interface PixelWitnessCompletion<T> {
  final: T
  height: number
  screenshotPath: string
  screenshotSha256: string
  width: number
}

export interface PngDimensions {
  height: number
  width: number
}

export class PixelWitnessControllerError extends Error {
  readonly code: PixelWitnessFailureCode

  constructor(code: PixelWitnessFailureCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PixelWitnessControllerError'
    this.code = code
  }
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const TARGET_FIELDS = [
  'runtime_instance_id',
  'workspace_id',
  'document_id',
  'content_document_id',
  'page_id'
] as const satisfies readonly (keyof EvalTarget)[]

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  )
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function assertValidIhdr(bytes: Uint8Array, dataOffset: number): PngDimensions {
  const width = readUint32(bytes, dataOffset)
  const height = readUint32(bytes, dataOffset + 4)
  const bitDepth = bytes[dataOffset + 8]
  const colorType = bytes[dataOffset + 9]
  const validDepths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  }
  if (width === 0 || height === 0) throw new Error('PNG dimensions must be non-zero.')
  if (!validDepths[colorType]?.includes(bitDepth)) {
    throw new Error('PNG IHDR bit depth and color type are incompatible.')
  }
  if (bytes[dataOffset + 10] !== 0 || bytes[dataOffset + 11] !== 0) {
    throw new Error('PNG compression and filter methods must be standard.')
  }
  if (bytes[dataOffset + 12] > 1) throw new Error('PNG interlace method is invalid.')
  return { height, width }
}

export function validatePng(bytes: Uint8Array): PngDimensions {
  if (bytes.length < 57 || !bytesEqual(bytes.subarray(0, 8), PNG_SIGNATURE)) {
    throw new Error('Screenshot is not a complete PNG file.')
  }
  let offset = 8
  let dimensions: PngDimensions | null = null
  let sawIdat = false
  let sawIend = false
  let chunkIndex = 0
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('PNG chunk header is truncated.')
    const length = readUint32(bytes, offset)
    const typeOffset = offset + 4
    const dataOffset = typeOffset + 4
    const crcOffset = dataOffset + length
    const nextOffset = crcOffset + 4
    if (nextOffset > bytes.length) throw new Error('PNG chunk data is truncated.')
    const type = chunkType(bytes, typeOffset)
    const expectedCrc = readUint32(bytes, crcOffset)
    const actualCrc = crc32(bytes.subarray(typeOffset, crcOffset))
    if (actualCrc !== expectedCrc) throw new Error(`PNG ${type} chunk CRC is invalid.`)
    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13) throw new Error('PNG must begin with a 13-byte IHDR.')
      dimensions = assertValidIhdr(bytes, dataOffset)
    } else if (type === 'IHDR') {
      throw new Error('PNG contains more than one IHDR chunk.')
    }
    if (type === 'IDAT') sawIdat = true
    if (type === 'IEND') {
      if (length !== 0) throw new Error('PNG IEND chunk must be empty.')
      sawIend = true
      if (nextOffset !== bytes.length) throw new Error('PNG contains data after IEND.')
    }
    offset = nextOffset
    chunkIndex += 1
  }
  if (!dimensions || !sawIdat || !sawIend) {
    throw new Error('PNG must contain IHDR, IDAT, and IEND chunks.')
  }
  return dimensions
}

function assertExactTarget(expected: EvalTarget, observed: EvalTarget, phase: string): void {
  const mismatches = TARGET_FIELDS.filter((field) => expected[field] !== observed[field])
  if (mismatches.length > 0) {
    throw new PixelWitnessControllerError(
      'pixel_target_mismatch',
      `Pixel witness ${phase} target mismatch: ${mismatches.join(', ')}.`
    )
  }
}

function failureCode(status: PixelWitnessSurfaceFailure): PixelWitnessFailureCode {
  if (status === 'crashed') return 'pixel_browser_crashed'
  if (status === 'closed') return 'pixel_browser_closed'
  return 'pixel_unavailable'
}

function unwrap<T>(result: PixelWitnessStepResult<T>, phase: string): T {
  if (result.status === 'ok') return result.value
  throw new PixelWitnessControllerError(
    failureCode(result.status),
    `Pixel witness ${phase} failed: ${result.detail ?? result.status}.`
  )
}

async function runStep<T>(
  phase: string,
  operation: () => Promise<PixelWitnessStepResult<T>>
): Promise<T> {
  try {
    return unwrap(await operation(), phase)
  } catch (error) {
    if (error instanceof PixelWitnessControllerError) throw error
    throw new PixelWitnessControllerError(
      'pixel_unavailable',
      `Pixel witness ${phase} failed unexpectedly.`,
      { cause: error }
    )
  }
}

export class PixelWitnessController {
  constructor(
    private readonly driver: PixelWitnessDriver,
    private readonly eventSink?: EvalLogAppendSink
  ) {}

  async capture(
    options: PixelWitnessCompletionOptions
  ): Promise<Omit<PixelWitnessCompletion<never>, 'final'>> {
    const target = parseEvalTarget(options.target)
    const render = await runStep('render', () => this.driver.waitForRender(target))
    assertExactTarget(target, parseEvalTarget(render.target), 'render')
    const capture = await runStep('screenshot capture', () => this.driver.captureScreenshot(target))
    assertExactTarget(target, parseEvalTarget(capture.target), 'capture')
    let bytes: Uint8Array
    let dimensions: PngDimensions
    try {
      bytes = await readFile(capture.screenshotPath)
      dimensions = validatePng(bytes)
    } catch (error) {
      throw new PixelWitnessControllerError(
        'pixel_invalid_screenshot',
        'Pixel witness screenshot is missing or is not a structurally valid PNG.',
        { cause: error }
      )
    }
    const screenshotSha256 = createHash('sha256').update(bytes).digest('hex')
    const witnessOptions = {
      eventLogPath: options.eventLogPath ?? '',
      mappingErrorMs: capture.mappingErrorMs,
      qualityGrade: options.qualityGrade,
      qualityPassed: options.qualityPassed,
      reviewedBy: options.reviewedBy,
      screenshotPath: capture.screenshotPath,
      target,
      visibleAtMs: capture.visibleAtMs
    }
    if (!this.eventSink && !options.eventLogPath) {
      throw new Error('Pixel witness requires an event sink or eventLogPath.')
    }
    const appendedHash = this.eventSink
      ? await emitPixelWitnessWithHash(witnessOptions, screenshotSha256, this.eventSink)
      : await appendPixelWitnessWithHash(witnessOptions, screenshotSha256)
    if (appendedHash !== screenshotSha256) {
      throw new PixelWitnessControllerError(
        'pixel_invalid_screenshot',
        'Pixel witness screenshot changed before the event was appended.'
      )
    }
    return {
      height: dimensions.height,
      screenshotPath: capture.screenshotPath,
      screenshotSha256,
      width: dimensions.width
    }
  }

  async complete<T>(
    options: PixelWitnessCompletionOptions,
    releaseFinal: () => T | Promise<T>
  ): Promise<PixelWitnessCompletion<T>> {
    const coordinator = new BufferedFinalCoordinator(releaseFinal)
    const { final, proof } = await coordinator.releaseAfter(() => this.capture(options))
    return { final, ...proof }
  }
}
