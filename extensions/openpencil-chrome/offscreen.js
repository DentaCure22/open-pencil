const MAX_RECORDING_BYTES = 11_500_000
const MAX_RECORDING_DURATION_MS = 30_000
const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
let activeRecording = null

function selectedMimeType() {
  return MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? 'video/webm'
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(reader.result), { once: true })
    reader.addEventListener('error', () => reject(reader.error), { once: true })
    reader.readAsDataURL(blob)
  })
}

async function finalize(recording) {
  clearTimeout(recording.timeoutId)
  for (const track of recording.stream.getTracks()) track.stop()
  if (activeRecording === recording) activeRecording = null
  const endedAt = new Date().toISOString()
  const blob = new Blob(recording.chunks, { type: recording.mimeType })
  if (blob.size > MAX_RECORDING_BYTES) {
    await chrome.runtime.sendMessage({
      captureSessionId: recording.captureSessionId,
      kind: 'recording-failed',
      reason: 'recording-too-large',
      target: 'service-worker'
    })
    return
  }
  const dataUrl = await blobDataUrl(blob)
  await chrome.runtime.sendMessage({
    byteLength: blob.size,
    captureSessionId: recording.captureSessionId,
    dataUrl,
    durationMs: Math.max(0, Date.now() - recording.startedAtMs),
    endedAt,
    kind: 'recording-complete',
    mimeType: recording.mimeType,
    startedAt: recording.startedAt,
    target: 'service-worker'
  })
}

async function startRecording(message) {
  if (activeRecording) return { ok: false, reason: 'recording-already-active' }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: message.streamId
      }
    },
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: message.streamId
      }
    }
  })
  const mimeType = selectedMimeType()
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_500_000
  })
  const recording = {
    captureSessionId: message.captureSessionId,
    chunks: [],
    mimeType,
    recorder,
    startedAt: message.startedAt,
    startedAtMs: Date.now(),
    stream,
    timeoutId: 0
  }
  activeRecording = recording
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) recording.chunks.push(event.data)
  })
  recorder.addEventListener('stop', () => void finalize(recording), { once: true })
  recorder.start(1_000)
  recording.timeoutId = setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop()
  }, MAX_RECORDING_DURATION_MS)
  return { mimeType, ok: true, startedAt: recording.startedAt }
}

function stopRecording(message) {
  const recording = activeRecording
  if (!recording) return { ok: false, reason: 'no-active-recording' }
  if (recording.captureSessionId !== message.captureSessionId) {
    return { ok: false, reason: 'recording-session-mismatch' }
  }
  if (recording.recorder.state !== 'inactive') recording.recorder.stop()
  return { ok: true }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false
  let promise = null
  if (message.kind === 'start-recording') promise = startRecording(message)
  else if (message.kind === 'stop-recording') promise = Promise.resolve(stopRecording(message))
  if (!promise) return false
  promise.then(sendResponse).catch((error) =>
    sendResponse({
      ok: false,
      reason: error instanceof Error ? error.message : 'recording-failed'
    })
  )
  return true
})
