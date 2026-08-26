import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test('pins Inspect Chrome to one tagged durable Trace session until Escape ends it', async ({
  page
}) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-trace-tab').click()

  const ambientSessionId = await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setTool(store.state.activeTool === 'RECTANGLE' ? 'ELLIPSE' : 'RECTANGLE')
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    const { narratedTraceSession } = await import('/src/app/narrated-trace/index.ts')
    return narratedTraceSession.value?.id
  })
  expect(ambientSessionId).toBeTruthy()

  const captureSessionId = `capture-${crypto.randomUUID().slice(0, 8)}`
  const sessionTag = `patient-flow-${captureSessionId.slice(-8)}`
  await page.evaluate((sessionId) => {
    window.postMessage(
      {
        captureSessionId: sessionId,
        captureStartedAt: new Date().toISOString(),
        contract: 'openpencil-browser-element/v1',
        kind: 'picker-started',
        page: {
          origin: 'https://example.com',
          title: 'Patient flow review',
          url: 'https://example.com/patient-flow'
        }
      },
      window.location.origin
    )
  }, captureSessionId)

  await expect(page.getByTestId('narrated-trace-session-tag')).toHaveCount(0)
  await page.evaluate(async (expectedTag) => {
    const { setNarratedTraceSessionTag } = await import('/src/app/narrated-trace/index.ts')
    setNarratedTraceSessionTag(expectedTag)
  }, sessionTag)

  await page.waitForTimeout(1_100)
  const pinned = await page.evaluate(async () => {
    const { narratedTraceSession, narratedTraceStatus } =
      await import('/src/app/narrated-trace/index.ts')
    return { id: narratedTraceSession.value?.id, status: narratedTraceStatus.value }
  })
  expect(pinned).toMatchObject({ status: 'recording' })
  expect(pinned.id).not.toBe(ambientSessionId)

  await page.evaluate((sessionId) => {
    window.postMessage(
      {
        captureSessionId: sessionId,
        contract: 'openpencil-browser-element/v1',
        endedAt: new Date().toISOString(),
        kind: 'picker-ended',
        reason: 'escape'
      },
      window.location.origin
    )
  }, captureSessionId)

  const proof = await page.evaluate(async (expectedTag) => {
    const { narratedTraceSession, narratedTraceStatus } =
      await import('/src/app/narrated-trace/index.ts')
    const { queryNarratedTraceHistory } = await import('/src/app/narrated-trace/query.ts')
    const result = await queryNarratedTraceHistory({ sessionTag: expectedTag })
    return {
      episode: narratedTraceSession.value?.episodes?.at(-1),
      result,
      sessionTag: narratedTraceSession.value?.tag,
      traceStatus: narratedTraceStatus.value
    }
  }, sessionTag)
  expect(proof).toMatchObject({
    episode: {
      kind: 'chrome',
      sourceSessionId: captureSessionId
    },
    result: {
      matches: [{ tag: sessionTag }],
      status: 'matched'
    },
    sessionTag,
    traceStatus: 'review'
  })
  expect(typeof proof.episode?.endedAtMs).toBe('number')
  expect(pageErrors).toEqual([])
})

test('records a spoken instruction as a voice episode inside the active Chrome Trace', async ({
  page
}) => {
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-trace-tab').click()
  await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const { OPENPENCIL_WORKSPACE_DOCUMENT_NAME, stampOpenPencilWorkspaceIdentity } =
      await import('/src/app/workspace-document/identity.ts')
    stampOpenPencilWorkspaceIdentity(store.graph, {
      documentId: `document-${crypto.randomUUID()}`,
      documentName: OPENPENCIL_WORKSPACE_DOCUMENT_NAME,
      roomId: `room-${crypto.randomUUID()}`,
      schemaVersion: 1,
      workspaceId: `workspace-${crypto.randomUUID()}`
    })

    class FakeSpeechRecognition extends EventTarget implements SpeechRecognition {
      continuous = false
      interimResults = false
      lang = ''
      maxAlternatives = 1
      processLocally = false
      onend: (() => void) | null = null
      onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null
      onresult: ((event: SpeechRecognitionEvent) => void) | null = null

      abort() {
        this.onend?.()
      }

      start() {
        this.dispatchEvent(new Event('speechstart'))
        setTimeout(() => {
          const result = {
            0: { confidence: 1, transcript: 'Make annotation one the primary action' },
            isFinal: true,
            length: 1
          } as SpeechRecognitionResult
          this.onresult?.({
            resultIndex: 0,
            results: { 0: result, length: 1 }
          } as SpeechRecognitionEvent)
        }, 50)
      }

      stop() {
        this.onend?.()
      }
    }

    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition
    })
  })

  const captureSessionId = `capture-${crypto.randomUUID().slice(0, 8)}`
  await page.evaluate((sessionId) => {
    window.postMessage(
      {
        captureSessionId: sessionId,
        captureStartedAt: new Date().toISOString(),
        contract: 'openpencil-browser-element/v1',
        kind: 'picker-started',
        page: {
          origin: 'https://example.com',
          title: 'Voice dispatch review',
          url: 'https://example.com/voice-dispatch'
        }
      },
      window.location.origin
    )
  }, captureSessionId)

  await page.getByTestId('narrated-trace-mic-toggle').click()
  await expect(
    page
      .getByTestId('narrated-trace-row-transcript')
      .filter({ hasText: 'Make annotation one the primary action' })
  ).toHaveCount(1)

  const proof = await page.evaluate(async () => {
    const { narratedTraceSession } = await import('/src/app/narrated-trace/index.ts')
    return {
      episodeKinds: narratedTraceSession.value?.episodes?.map((episode) => episode.kind),
      voiceEvents: narratedTraceSession.value?.events.filter(
        (event) => event.origin?.kind === 'voice'
      )
    }
  })
  expect(proof.episodeKinds).toEqual(['chrome', 'voice'])
  expect(proof.voiceEvents).toHaveLength(1)
  expect(proof.voiceEvents?.[0]).toMatchObject({
    label: 'Make annotation one the primary action',
    origin: {
      kind: 'voice',
      reference: 'Voice #1'
    }
  })
})
