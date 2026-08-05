import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEvalLog, dispatchedEvent, EvalLogWriter, readEvalEvents } from '../src/io'
import { createEvalEvent, type EvalTarget } from '../src/schema'
import {
  BufferedFinalCoordinator,
  PixelWitnessController,
  PixelWitnessControllerError,
  type PixelWitnessDriver,
  type PixelWitnessStepResult,
  validatePng
} from '../src/witness-controller'

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )
)

const TARGET: EvalTarget = {
  content_document_id: 'content-1',
  document_id: 'tab-1',
  page_id: 'page-1',
  runtime_instance_id: 'runtime-1',
  workspace_id: 'workspace-1'
}

interface Harness {
  controller: PixelWitnessController
  eventLogPath: string
  order: string[]
  screenshotPath: string
}

async function harness(
  overrides: Partial<PixelWitnessDriver> = {},
  screenshot = ONE_PIXEL_PNG
): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-witness-controller-'))
  const eventLogPath = join(directory, 'events.jsonl')
  const screenshotPath = join(directory, 'artifact.png')
  const order: string[] = []
  await writeFile(screenshotPath, screenshot)
  await createEvalLog(
    eventLogPath,
    dispatchedEvent('RUN-1', 'recorder-1', Date.now() - 10, performance.now() - 10, 'Build it.')
  )
  const success = <T>(value: T): PixelWitnessStepResult<T> => ({ status: 'ok', value })
  const driver: PixelWitnessDriver = {
    async captureScreenshot() {
      order.push('capture')
      return success({ screenshotPath, target: TARGET })
    },
    async waitForRender() {
      order.push('render')
      return success({ target: TARGET })
    },
    ...overrides
  }
  return { controller: new PixelWitnessController(driver), eventLogPath, order, screenshotPath }
}

function completionOptions(eventLogPath: string) {
  return {
    eventLogPath,
    qualityGrade: 'A',
    qualityPassed: true,
    reviewedBy: 'visual-oracle-1',
    target: TARGET
  }
}

describe('pixel witness controller', () => {
  test('releases the buffered final only after exact-target PNG evidence is appended', async () => {
    const fixture = await harness()
    const result = await fixture.controller.complete(
      completionOptions(fixture.eventLogPath),
      () => {
        fixture.order.push('final')
        return 'done'
      }
    )
    const events = await readEvalEvents(fixture.eventLogPath)

    expect(fixture.order).toEqual(['render', 'capture', 'final'])
    expect(result).toMatchObject({ final: 'done', height: 1, width: 1 })
    expect(result.screenshotSha256).toHaveLength(64)
    expect(events.map((event) => event.kind)).toEqual(['run_dispatched', 'pixel_witness_captured'])
  })

  test('emits witness events through the active writer without sequence collisions', async () => {
    const fixture = await harness()
    const initial = (await readEvalEvents(fixture.eventLogPath))[0]
    if (!initial) throw new Error('Missing initial event.')
    const sinkLogPath = join(
      await mkdtemp(join(tmpdir(), 'openpencil-witness-sink-')),
      'events.jsonl'
    )
    const writer = await EvalLogWriter.create(sinkLogPath, initial)
    const controller = new PixelWitnessController(
      {
        async captureScreenshot() {
          return { status: 'ok', value: { screenshotPath: fixture.screenshotPath, target: TARGET } }
        },
        async waitForRender() {
          return { status: 'ok', value: { target: TARGET } }
        }
      },
      writer
    )
    await writer.append(
      createEvalEvent({
        data: {},
        kind: 'codex_turn_started',
        observed_at_ms: Date.now(),
        observed_monotonic_ms: performance.now(),
        precision_ms: 1,
        recorder_id: initial.recorder_id,
        run_id: initial.run_id,
        sequence: 1,
        source: 'codex'
      })
    )
    const result = await controller.complete(
      { ...completionOptions(fixture.eventLogPath), eventLogPath: undefined },
      () => 'done'
    )

    expect(result.final).toBe('done')
    expect((await readEvalEvents(sinkLogPath)).map((event) => event.kind)).toEqual([
      'run_dispatched',
      'codex_turn_started',
      'pixel_witness_captured'
    ])
    expect((await readEvalEvents(sinkLogPath)).map((event) => event.sequence)).toEqual([0, 1, 2])
  })

  test('buffered final is released once only after proof succeeds', async () => {
    const order: string[] = []
    const coordinator = new BufferedFinalCoordinator(() => {
      order.push('final')
      return 'done'
    })
    const result = await coordinator.releaseAfter(async () => {
      order.push('proof')
      return 'captured'
    })

    expect(result).toEqual({ final: 'done', proof: 'captured' })
    expect(order).toEqual(['proof', 'final'])
    expect(coordinator.state).toBe('released')
    await expect(coordinator.releaseAfter(async () => 'again')).rejects.toThrow('state released')
  })

  test('buffered final stays unreleased when proof fails', async () => {
    let released = false
    const coordinator = new BufferedFinalCoordinator(() => {
      released = true
    })

    await expect(
      coordinator.releaseAfter(async () => {
        throw new Error('proof failed')
      })
    ).rejects.toThrow('proof failed')
    expect(released).toBe(false)
    expect(coordinator.state).toBe('failed')
  })

  test('fails closed before final when the captured runtime is wrong', async () => {
    const fixture = await harness({
      async captureScreenshot() {
        fixture.order.push('capture')
        return {
          status: 'ok',
          value: {
            screenshotPath: fixture.screenshotPath,
            target: { ...TARGET, runtime_instance_id: 'runtime-other' }
          }
        }
      }
    })
    let finalReleased = false

    await expect(
      fixture.controller.complete(completionOptions(fixture.eventLogPath), () => {
        finalReleased = true
      })
    ).rejects.toMatchObject({ code: 'pixel_target_mismatch' })
    expect(finalReleased).toBe(false)
    expect(fixture.order).toEqual(['render', 'capture'])
    expect(await readEvalEvents(fixture.eventLogPath)).toHaveLength(1)
  })

  test.each([
    ['crashed', 'pixel_browser_crashed'],
    ['closed', 'pixel_browser_closed'],
    ['unavailable', 'pixel_unavailable']
  ] as const)('maps %s surfaces to stable failure code %s', async (status, code) => {
    const fixture = await harness({
      async waitForRender() {
        return { detail: 'surface gone', status }
      }
    })

    try {
      await fixture.controller.complete(completionOptions(fixture.eventLogPath), () => 'never')
      throw new Error('Expected pixel witness failure.')
    } catch (error) {
      expect(error).toBeInstanceOf(PixelWitnessControllerError)
      expect((error as PixelWitnessControllerError).code).toBe(code)
    }
    expect(await readEvalEvents(fixture.eventLogPath)).toHaveLength(1)
  })

  test('rejects a signature-only PNG without appending evidence or releasing final', async () => {
    const fixture = await harness({}, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    let finalReleased = false

    await expect(
      fixture.controller.complete(completionOptions(fixture.eventLogPath), () => {
        finalReleased = true
      })
    ).rejects.toMatchObject({ code: 'pixel_invalid_screenshot' })
    expect(finalReleased).toBe(false)
    expect(await readEvalEvents(fixture.eventLogPath)).toHaveLength(1)
  })

  test('validates PNG structure, dimensions, and CRCs', () => {
    expect(validatePng(ONE_PIXEL_PNG)).toEqual({ height: 1, width: 1 })
    const corrupted = ONE_PIXEL_PNG.slice()
    corrupted[29] ^= 1
    expect(() => validatePng(corrupted)).toThrow('CRC')
  })
})
