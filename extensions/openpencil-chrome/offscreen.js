const MAX_RECORDING_BYTES = 11_500_000
const MAX_RECORDING_DURATION_MS = 30_000
const FRAME_RECORDING_INTERVAL_MS = 600
const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
let activeRecording = null
const activeLiveCaptures = new Map()

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
  if (recording.frameIntervalId) clearInterval(recording.frameIntervalId)
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

function beginRecording(captureSessionId, stream, startedAt, mode) {
  const mimeType = selectedMimeType()
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_500_000
  })
  const recording = {
    captureSessionId,
    chunks: [],
    frameIntervalId: 0,
    framePending: false,
    mimeType,
    mode,
    recorder,
    startedAt,
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
  return recording
}

function recordingStarted(recording) {
  return {
    mimeType: recording.mimeType,
    mode: recording.mode,
    ok: true,
    startedAt: recording.startedAt
  }
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
  return recordingStarted(
    beginRecording(message.captureSessionId, stream, message.startedAt, 'tab-capture')
  )
}

async function requestSampledFrame(captureSessionId) {
  return chrome.runtime.sendMessage({
    captureSessionId,
    kind: 'capture-motion-frame',
    target: 'service-worker'
  })
}

async function frameBitmap(dataUrl) {
  const response = await fetch(dataUrl)
  return createImageBitmap(await response.blob())
}

async function appendSampledFrame(recording) {
  if (activeRecording !== recording || recording.framePending) return
  recording.framePending = true
  try {
    const response = await requestSampledFrame(recording.captureSessionId)
    if (!response?.ok || typeof response.dataUrl !== 'string') return
    const bitmap = await frameBitmap(response.dataUrl)
    recording.context.drawImage(
      bitmap,
      0,
      0,
      bitmap.width,
      bitmap.height,
      0,
      0,
      recording.canvas.width,
      recording.canvas.height
    )
    bitmap.close()
    recording.stream.getVideoTracks()[0]?.requestFrame?.()
  } finally {
    recording.framePending = false
  }
}

async function startFrameRecording(message) {
  if (activeRecording) return { ok: false, reason: 'recording-already-active' }
  const firstFrame = await requestSampledFrame(message.captureSessionId)
  if (!firstFrame?.ok || typeof firstFrame.dataUrl !== 'string') {
    return { ok: false, reason: firstFrame?.reason || 'frame-capture-failed' }
  }
  const bitmap = await frameBitmap(firstFrame.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) {
    bitmap.close()
    return { ok: false, reason: 'frame-recorder-unavailable' }
  }
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const stream = canvas.captureStream(2)
  const recording = beginRecording(
    message.captureSessionId,
    stream,
    message.startedAt,
    'frame-sampling'
  )
  recording.canvas = canvas
  recording.context = context
  recording.frameIntervalId = setInterval(
    () => void appendSampledFrame(recording),
    FRAME_RECORDING_INTERVAL_MS
  )
  stream.getVideoTracks()[0]?.requestFrame?.()
  return recordingStarted(recording)
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

function stopLiveCapture(sessionId, notify = true) {
  const capture = activeLiveCaptures.get(sessionId)
  if (!capture) return false
  clearInterval(capture.fallbackIntervalId)
  void capture.frameReader?.cancel().catch(() => undefined)
  if (
    capture.videoFrameRequestId !== null &&
    typeof capture.video.cancelVideoFrameCallback === 'function'
  ) {
    capture.video.cancelVideoFrameCallback(capture.videoFrameRequestId)
  }
  for (const track of capture.stream.getTracks()) track.stop()
  capture.video.srcObject = null
  activeLiveCaptures.delete(sessionId)
  if (notify) {
    void chrome.runtime.sendMessage({
      kind: 'live-surface-ended',
      sessionId,
      target: 'service-worker'
    })
  }
  return true
}

function stopLiveCapturesForTab(tabId) {
  for (const [sessionId, capture] of activeLiveCaptures) {
    if (capture.tabId === tabId) stopLiveCapture(sessionId, false)
  }
  return true
}

async function startLiveCapture(message) {
  if (activeLiveCaptures.has(message.sessionId)) return { ok: true, resumed: true }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: message.streamId
      }
    }
  })
  const video = document.createElement('video')
  video.autoplay = true
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await video.play()
  if (!video.videoWidth || !video.videoHeight) {
    await new Promise((resolve) => {
      video.addEventListener('loadedmetadata', resolve, { once: true })
    })
  }
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) {
    for (const track of stream.getTracks()) track.stop()
    return { ok: false, reason: 'live-surface-canvas-unavailable' }
  }
  const bounds = message.bounds
  const viewport = message.viewport
  const ratioX = video.videoWidth / Math.max(1, viewport.width)
  const ratioY = video.videoHeight / Math.max(1, viewport.height)
  const sourceX = Math.max(0, Math.round(bounds.x * ratioX))
  const sourceY = Math.max(0, Math.round(bounds.y * ratioY))
  const sourceWidth = Math.max(
    1,
    Math.min(Math.round(bounds.width * ratioX), video.videoWidth - sourceX)
  )
  const sourceHeight = Math.max(
    1,
    Math.min(Math.round(bounds.height * ratioY), video.videoHeight - sourceY)
  )
  const scale = Math.min(1, 1_600 / sourceWidth, 1_200 / sourceHeight)
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
  let sequence = 0
  let sending = false
  let lastVideoFrameSentAtMs = 0
  const capture = {
    fallbackIntervalId: 0,
    frameReader: null,
    imageCapture:
      typeof globalThis.ImageCapture === 'function'
        ? new ImageCapture(stream.getVideoTracks()[0])
        : null,
    stream,
    tabId: message.tabId,
    video,
    videoFrameRequestId: null
  }
  async function sendFrame(videoFrame = null) {
    if (
      sending ||
      (!videoFrame && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
    ) {
      return
    }
    sending = true
    try {
      context.drawImage(
        videoFrame || video,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height
      )
      sequence += 1
      await chrome.runtime.sendMessage({
        dataUrl: canvas.toDataURL('image/jpeg', 0.84),
        kind: 'live-surface-frame',
        sequence,
        sessionId: message.sessionId,
        target: 'service-worker'
      })
    } finally {
      sending = false
    }
  }
  async function readVideoFrames() {
    if (typeof globalThis.MediaStreamTrackProcessor !== 'function') return false
    const track = stream.getVideoTracks()[0]
    if (!track) return false
    const processor = new MediaStreamTrackProcessor({ track })
    const reader = processor.readable.getReader()
    capture.frameReader = reader
    try {
      while (activeLiveCaptures.has(message.sessionId)) {
        const { done, value } = await reader.read()
        if (done) break
        try {
          const now = performance.now()
          if (now - lastVideoFrameSentAtMs < 90) continue
          lastVideoFrameSentAtMs = now
          await sendFrame(value)
        } finally {
          value.close()
        }
      }
    } catch (error) {
      if (activeLiveCaptures.has(message.sessionId)) {
        console.debug('OpenPencil live surface frame processor ended.', error)
      }
    } finally {
      if (capture.frameReader === reader) capture.frameReader = null
      reader.releaseLock()
    }
    return true
  }
  async function grabCurrentFrame() {
    if (!capture.imageCapture) {
      await sendFrame()
      return
    }
    try {
      const bitmap = await capture.imageCapture.grabFrame()
      try {
        await sendFrame(bitmap)
      } finally {
        bitmap.close()
      }
    } catch {
      await sendFrame()
    }
  }
  function scheduleVideoFrame() {
    if (
      !activeLiveCaptures.has(message.sessionId) ||
      typeof video.requestVideoFrameCallback !== 'function'
    ) {
      return
    }
    capture.videoFrameRequestId = video.requestVideoFrameCallback((now) => {
      capture.videoFrameRequestId = null
      if (now - lastVideoFrameSentAtMs < 90) {
        scheduleVideoFrame()
        return
      }
      lastVideoFrameSentAtMs = now
      void sendFrame().finally(scheduleVideoFrame)
    })
  }
  activeLiveCaptures.set(message.sessionId, capture)
  capture.fallbackIntervalId = setInterval(() => void grabCurrentFrame(), 500)
  if (typeof globalThis.MediaStreamTrackProcessor === 'function') {
    void readVideoFrames()
  } else {
    scheduleVideoFrame()
  }
  for (const track of stream.getVideoTracks()) {
    track.addEventListener('ended', () => stopLiveCapture(message.sessionId), { once: true })
  }
  await sendFrame()
  return { ok: true }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false
  let promise = null
  if (message.kind === 'start-recording') promise = startRecording(message)
  else if (message.kind === 'start-frame-recording') promise = startFrameRecording(message)
  else if (message.kind === 'stop-recording') promise = Promise.resolve(stopRecording(message))
  else if (message.kind === 'start-live-surface') promise = startLiveCapture(message)
  else if (message.kind === 'stop-live-surfaces-for-tab') {
    promise = Promise.resolve({ ok: stopLiveCapturesForTab(message.tabId) })
  }
  else if (message.kind === 'stop-live-surface') {
    promise = Promise.resolve({ ok: stopLiveCapture(message.sessionId) })
  }
  if (!promise) return false
  promise.then(sendResponse).catch((error) =>
    sendResponse({
      ok: false,
      reason: error instanceof Error ? error.message : 'recording-failed'
    })
  )
  return true
})
