import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEvalLog, dispatchedEvent, readEvalEvents } from '../src/io'
import { appendPixelWitness } from '../src/witness'

describe('pixel witness', () => {
  test('binds one screenshot hash to the exact target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-pixel-witness-'))
    const logPath = join(directory, 'events.jsonl')
    const screenshotPath = join(directory, 'artifact.png')
    await writeFile(screenshotPath, new Uint8Array([137, 80, 78, 71]))
    await createEvalLog(
      logPath,
      dispatchedEvent('RUN-1', 'recorder-1', Date.now() - 5, performance.now() - 5, 'Build it.')
    )
    const hash = await appendPixelWitness({
      eventLogPath: logPath,
      qualityGrade: 'A',
      qualityPassed: true,
      reviewedBy: 'visual-oracle-1',
      screenshotPath,
      target: {
        content_document_id: 'content-1',
        document_id: 'tab-1',
        page_id: 'page-1',
        runtime_instance_id: 'runtime-1',
        workspace_id: 'workspace-1'
      }
    })
    const events = await readEvalEvents(logPath)
    expect(hash).toHaveLength(64)
    expect(events.map((event) => event.kind)).toEqual(['run_dispatched', 'pixel_witness_captured'])
    expect(events[1]?.data.screenshot_sha256).toBe(hash)
  })
})
