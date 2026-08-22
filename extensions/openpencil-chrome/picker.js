/* oxlint-disable max-lines -- Chrome injects the picker as one self-contained script. */
;(() => {
  const PICKER_KEY = '__openpencilChromeElementPicker'
  const SESSION_CONFIG_KEY = '__openpencilPickerSessionConfig'
  const MAX_SNAPSHOT_LENGTH = 2_000_000
  const MIN_CONTEXT_WIDTH = 640
  const MIN_CONTEXT_HEIGHT = 360
  const CONTEXT_PADDING = 96

  function rethrowUnlessContextInvalidated(error) {
    if (!String(error).includes('Extension context invalidated')) throw error
  }

  function compact(value, limit) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit)
  }

  function uniqueId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'))
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
  }

  const injectedConfig = globalThis[SESSION_CONFIG_KEY]
  const configuredSessionId =
    typeof injectedConfig?.captureSessionId === 'string'
      ? injectedConfig.captureSessionId
      : uniqueId()
  const previous = globalThis[PICKER_KEY]
  if (previous?.active && previous.captureSessionId === configuredSessionId) {
    previous.sync?.(injectedConfig)
    return
  }
  if (previous?.active) {
    try {
      previous.dispose?.()
    } catch (error) {
      rethrowUnlessContextInvalidated(error)
    }
  }

  function cssEscape(value) {
    return globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
  }

  function selectorFor(element) {
    if (element.id && document.querySelectorAll(`#${cssEscape(element.id)}`).length === 1) {
      return `#${cssEscape(element.id)}`
    }
    for (const attribute of ['data-testid', 'data-test-id', 'aria-label', 'name']) {
      const value = compact(element.getAttribute(attribute), 160)
      if (!value) continue
      const selector = `[${attribute}=${JSON.stringify(value)}]`
      try {
        if (document.querySelectorAll(selector).length === 1) return selector
      } catch (error) {
        if (error instanceof DOMException) continue
        throw error
      }
    }
    const parts = []
    let current = element
    while (current instanceof Element && parts.length < 7 && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase()
      const siblings = sameTagSiblings(current)
      const index = siblings.indexOf(current)
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index + 1})` : tag)
      current = current.parentElement
    }
    return parts.join(' > ').slice(0, 1_024)
  }

  function sameTagSiblings(element) {
    if (!element.parentElement) return []
    const tagName = element.tagName
    return [...element.parentElement.children].filter((child) => child.tagName === tagName)
  }

  function attributesFor(element) {
    const allowed = [
      'alt',
      'aria-label',
      'aria-labelledby',
      'data-testid',
      'data-test-id',
      'href',
      'id',
      'name',
      'placeholder',
      'role',
      'title',
      'type'
    ]
    return Object.fromEntries(
      allowed
        .map((name) => [name, compact(element.getAttribute(name), 500)])
        .filter(([, value]) => value)
    )
  }

  function accessibleName(element) {
    return compact(
      element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.getAttribute('alt') ||
        element.getAttribute('placeholder') ||
        element.innerText ||
        element.textContent,
      500
    )
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value))
  }

  function contextRect(element) {
    const bounds = element.getBoundingClientRect()
    const viewportWidth = Math.max(1, window.innerWidth)
    const viewportHeight = Math.max(1, window.innerHeight)
    const targetLeft = clamp(bounds.left, 0, viewportWidth)
    const targetTop = clamp(bounds.top, 0, viewportHeight)
    const targetRight = clamp(bounds.right, 0, viewportWidth)
    const targetBottom = clamp(bounds.bottom, 0, viewportHeight)
    const targetWidth = Math.max(1, targetRight - targetLeft)
    const targetHeight = Math.max(1, targetBottom - targetTop)
    const width = Math.min(
      viewportWidth,
      Math.max(MIN_CONTEXT_WIDTH, targetWidth + CONTEXT_PADDING * 2)
    )
    const height = Math.min(
      viewportHeight,
      Math.max(MIN_CONTEXT_HEIGHT, targetHeight + CONTEXT_PADDING * 2)
    )
    const x = clamp((targetLeft + targetRight - width) / 2, 0, viewportWidth - width)
    const y = clamp((targetTop + targetBottom - height) / 2, 0, viewportHeight - height)
    return {
      height,
      target: {
        height: targetHeight,
        width: targetWidth,
        x: targetLeft - x,
        y: targetTop - y
      },
      width,
      x,
      y
    }
  }

  async function contextScreenshot(dataUrl, region, sequence) {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const ratioX = image.naturalWidth / window.innerWidth
    const ratioY = image.naturalHeight / window.innerHeight
    const sourceWidth = Math.max(1, Math.round(region.width * ratioX))
    const sourceHeight = Math.max(1, Math.round(region.height * ratioY))
    const baseScale = Math.min(1, 1_280 / sourceWidth, 900 / sourceHeight)

    function render(scale) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(sourceWidth * scale))
      canvas.height = Math.max(1, Math.round(sourceHeight * scale))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Canvas capture is unavailable')
      context.drawImage(
        image,
        Math.round(region.x * ratioX),
        Math.round(region.y * ratioY),
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height
      )

      const boxX = region.target.x * ratioX * scale
      const boxY = region.target.y * ratioY * scale
      const boxWidth = Math.max(2, region.target.width * ratioX * scale)
      const boxHeight = Math.max(2, region.target.height * ratioY * scale)
      const lineWidth = Math.max(2, 2 * scale)
      context.fillStyle = 'rgba(109, 94, 252, 0.10)'
      context.fillRect(boxX, boxY, boxWidth, boxHeight)
      context.strokeStyle = 'rgba(255, 255, 255, 0.92)'
      context.lineWidth = lineWidth + 2
      context.strokeRect(boxX, boxY, boxWidth, boxHeight)
      context.strokeStyle = '#6d5efc'
      context.lineWidth = lineWidth
      context.strokeRect(boxX, boxY, boxWidth, boxHeight)

      const markerSize = Math.max(18, Math.round(24 * scale))
      const markerX = clamp(boxX, markerSize / 2 + 2, canvas.width - markerSize / 2 - 2)
      const markerY = clamp(boxY, markerSize / 2 + 2, canvas.height - markerSize / 2 - 2)
      context.beginPath()
      context.arc(markerX, markerY, markerSize / 2, 0, Math.PI * 2)
      context.fillStyle = '#6d5efc'
      context.fill()
      context.strokeStyle = 'white'
      context.lineWidth = 2
      context.stroke()
      context.fillStyle = 'white'
      context.font = `700 ${Math.max(10, Math.round(12 * scale))}px system-ui, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(String(sequence), markerX, markerY + 0.5)
      return canvas
    }

    let scale = baseScale
    let canvas = render(scale)
    let snapshot = canvas.toDataURL('image/png')
    while (snapshot.length > MAX_SNAPSHOT_LENGTH && scale > 0.32) {
      scale *= 0.78
      canvas = render(scale)
      snapshot = canvas.toDataURL('image/png')
    }
    if (snapshot.length > MAX_SNAPSHOT_LENGTH) throw new Error('Page context is too large')
    return { dataUrl: snapshot, height: canvas.height, width: canvas.width }
  }

  const captureSessionId = configuredSessionId
  const captureStartedAt =
    typeof injectedConfig?.captureStartedAt === 'string'
      ? injectedConfig.captureStartedAt
      : new Date().toISOString()
  let sessionSelectionCount = Number.isSafeInteger(injectedConfig?.selectedCount)
    ? injectedConfig.selectedCount
    : 0
  let publishChain = Promise.resolve()
  let selected = document.body
  let childBeforeAncestor = null
  let hoverFrame = 0
  let pendingPointer = null
  let recording = false
  let finished = false
  const committed = []

  const host = document.createElement('openpencil-inspector-layer')
  host.setAttribute('data-op-inspector-layer', '')
  host.setAttribute('data-session-id', captureSessionId)
  Object.assign(host.style, {
    inset: '0',
    pointerEvents: 'none',
    position: 'fixed',
    zIndex: '2147483647'
  })
  for (const [property, value] of [
    ['display', 'block'],
    ['height', '100vh'],
    ['opacity', '1'],
    ['position', 'fixed'],
    ['visibility', 'visible'],
    ['width', '100vw']
  ]) {
    host.style.setProperty(property, value, 'important')
  }
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    [data-role="outline"], [data-role="committed"] {
      background: #6d5efc1a;
      border: 2px solid #7567ff;
      box-shadow: 0 0 0 1px #ffffffb8, 0 8px 32px #3f2dc63d;
      box-sizing: border-box;
      left: 0;
      position: fixed;
      top: 0;
      will-change: transform, width, height;
    }
    [data-role="outline"] {
      opacity: 0;
      transition: transform 80ms cubic-bezier(0.2, 0.8, 0.2, 1), width 80ms ease, height 80ms ease, opacity 120ms ease;
    }
    :host([data-ready="true"]) [data-role="outline"] { opacity: 1; }
    [data-role="outline"]::after {
      animation: openpencil-picker-pulse 1.35s ease-out infinite;
      border: 1px solid #7567ffb3;
      content: '';
      inset: -2px;
      position: absolute;
    }
    [data-role="label"] {
      background: #6d5efc;
      color: white;
      font: 600 11px/1.4 system-ui, sans-serif;
      left: -2px;
      max-width: min(360px, calc(100vw - 16px));
      overflow: hidden;
      padding: 3px 6px;
      position: absolute;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [data-role="number"] {
      align-items: center;
      background: #6d5efc;
      border: 2px solid white;
      border-radius: 999px;
      box-shadow: 0 2px 10px #00000045;
      color: white;
      display: flex;
      font: 700 11px/1 system-ui, sans-serif;
      height: 24px;
      justify-content: center;
      left: -12px;
      position: absolute;
      top: -12px;
      width: 24px;
    }
    [data-role="cursor"] {
      border: 1.5px solid white;
      border-radius: 999px;
      box-shadow: 0 0 0 2px #6d5efc, 0 2px 10px #00000052;
      height: 12px;
      left: 0;
      opacity: 0;
      position: fixed;
      top: 0;
      transition: opacity 100ms ease;
      width: 12px;
    }
    [data-role="cursor"][data-visible="true"] { opacity: 1; }
    [data-role="cursor"]::before, [data-role="cursor"]::after {
      background: #6d5efc;
      content: '';
      left: 50%;
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
    }
    [data-role="cursor"]::before { height: 1px; width: 20px; }
    [data-role="cursor"]::after { height: 20px; width: 1px; }
    [data-role="status"] {
      animation: openpencil-picker-status-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
      backdrop-filter: blur(14px);
      background: #19191fe6;
      border: 1px solid #ffffff2e;
      border-radius: 999px;
      box-shadow: 0 10px 30px #00000047;
      color: white;
      font: 600 11px/1 system-ui, sans-serif;
      left: 50%;
      padding: 9px 12px;
      pointer-events: auto;
      position: fixed;
      top: 12px;
      transform: translateX(-50%);
      white-space: nowrap;
    }
    [data-role="status"] strong { color: #b6adff; }
    [data-role="recording"] { color: #ff6969; }
    [data-role="status"] button {
      background: transparent;
      border: 0;
      border-radius: 999px;
      color: inherit;
      cursor: pointer;
      font: inherit;
      margin: -5px -3px -5px 5px;
      padding: 5px 8px;
    }
    [data-role="status"] button:hover { background: #ffffff18; }
    [data-role="status"] [data-action="finish"] { background: #6d5efc; }
    [data-role="status"] [data-action="finish"]:hover { background: #7c70ff; }
    @keyframes openpencil-picker-pulse {
      0%, 48% { opacity: 0.75; transform: scale(1); }
      100% { opacity: 0; transform: scale(1.018); }
    }
    @keyframes openpencil-picker-status-in {
      from { opacity: 0; transform: translate(-50%, -8px) scale(0.96); }
      to { opacity: 1; transform: translate(-50%, 0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-role="outline"], [data-role="cursor"] { transition: none; }
      [data-role="outline"]::after, [data-role="status"] { animation: none; }
    }
  `
  const committedLayer = document.createElement('div')
  committedLayer.setAttribute('data-role', 'committed-layer')
  const outline = document.createElement('div')
  outline.setAttribute('data-role', 'outline')
  const label = document.createElement('span')
  label.setAttribute('data-role', 'label')
  outline.append(label)
  const cursor = document.createElement('div')
  cursor.setAttribute('data-role', 'cursor')
  const status = document.createElement('div')
  status.setAttribute('data-role', 'status')
  shadow.append(style, committedLayer, outline, cursor, status)
  document.documentElement.append(host)

  function updateStatus() {
    const count = sessionSelectionCount
    status.innerHTML = `<strong>Inspect Chrome</strong> &nbsp; ${count} selected &nbsp; Click to add ${count ? '<button data-action="annotate" type="button">Annotate</button>' : ''}<button data-action="record" type="button"><span data-role="recording">${recording ? '● Stop recording' : '● Record motion'}</span></button><button data-action="finish" type="button">Done</button>`
  }

  function place(frame, element) {
    const rect = element.getBoundingClientRect()
    frame.style.transform = `translate(${rect.left}px, ${rect.top}px)`
    frame.style.width = `${Math.max(1, rect.width)}px`
    frame.style.height = `${Math.max(1, rect.height)}px`
    return rect
  }

  function draw(element) {
    selected = element
    const rect = place(outline, element)
    label.textContent = `${element.tagName.toLowerCase()}${accessibleName(element) ? ` · ${accessibleName(element)}` : ''}`
    const below = rect.top < 34
    label.style.bottom = below ? 'auto' : '100%'
    label.style.top = below ? '100%' : 'auto'
    label.style.borderRadius = below ? '0 0 4px 4px' : '4px 4px 0 0'
  }

  function redraw() {
    if (selected.isConnected) draw(selected)
    for (const item of committed) {
      if (item.element.isConnected) place(item.frame, item.element)
      else item.frame.style.display = 'none'
    }
  }

  function addCommitted(element, itemSequence, selectionId) {
    const frame = document.createElement('div')
    frame.setAttribute('data-role', 'committed')
    frame.setAttribute('data-sequence', String(itemSequence))
    const number = document.createElement('span')
    number.setAttribute('data-role', 'number')
    number.textContent = String(itemSequence)
    frame.append(number)
    committedLayer.append(frame)
    const item = { element, frame, selectionId, sequence: itemSequence }
    committed.push(item)
    place(frame, element)
    updateStatus()
  }

  function flushPointer() {
    hoverFrame = 0
    const point = pendingPointer
    pendingPointer = null
    if (!point) return
    cursor.style.transform = `translate(${point.x - 6}px, ${point.y - 6}px)`
    cursor.setAttribute('data-visible', 'true')
    const candidate = document.elementFromPoint(point.x, point.y)
    if (candidate instanceof Element && candidate !== host) {
      childBeforeAncestor = null
      draw(candidate)
    }
  }

  function move(event) {
    pendingPointer = { x: event.clientX, y: event.clientY }
    if (!hoverFrame) hoverFrame = requestAnimationFrame(flushPointer)
  }

  async function publish(element, itemSequence, selectionId) {
    const response = await chrome.runtime.sendMessage({ kind: 'capture-visible-browser-element' })
    if (!response?.ok) throw new Error(response?.reason || 'Element capture failed')
    const bounds = element.getBoundingClientRect()
    const capturedAt = new Date().toISOString()
    const selection = {
      capturedAt,
      element: {
        accessibleName: accessibleName(element),
        attributes: attributesFor(element),
        bounds: { height: bounds.height, width: bounds.width, x: bounds.x, y: bounds.y },
        classes: [...element.classList].slice(0, 24).map((value) => compact(value, 160)),
        role: compact(element.getAttribute('role'), 160),
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        text: compact(element.innerText || element.textContent, 1_000)
      },
      id: selectionId,
      page: {
        origin: window.location.origin,
        title: compact(document.title, 500),
        url: window.location.href.slice(0, 4_096)
      },
      session: { captureSessionId, captureStartedAt, frameId: 0, sequence: itemSequence, tabId: 0 },
      snapshot: await contextScreenshot(response.dataUrl, contextRect(element), itemSequence)
    }
    await chrome.runtime.sendMessage({ kind: 'browser-element-selection', selection })
  }

  async function reserveSelectionSequence() {
    const response = await chrome.runtime.sendMessage({
      captureSessionId,
      kind: 'reserve-browser-element-sequence'
    })
    const reserved = Number(response?.sequence)
    sessionSelectionCount =
      response?.ok && Number.isSafeInteger(reserved) && reserved > 0
        ? Math.max(sessionSelectionCount, reserved)
        : sessionSelectionCount + 1
    updateStatus()
    return sessionSelectionCount
  }

  function choose(event) {
    if (event.target === host) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const candidate = document.elementFromPoint(event.clientX, event.clientY)
    const chosen = candidate instanceof Element && candidate !== host ? candidate : selected
    const selectionId = uniqueId()
    publishChain = publishChain
      .then(async () => {
        const itemSequence = await reserveSelectionSequence()
        addCommitted(chosen, itemSequence, selectionId)
        return publish(chosen, itemSequence, selectionId)
      })
      .catch(() => finish('selection-failed'))
  }

  async function toggleRecording() {
    const response = await chrome.runtime.sendMessage({
      captureSessionId,
      kind: recording ? 'stop-browser-motion-recording' : 'start-browser-motion-recording',
      startedAt: captureStartedAt
    })
    if (!response?.ok) throw new Error(response?.reason || 'Motion recording is unavailable')
    recording = !recording
    updateStatus()
  }

  function statusClick(event) {
    const action =
      event.target instanceof Element ? event.target.closest('button')?.dataset.action : ''
    if (action === 'record') void toggleRecording().catch(() => undefined)
    if (action === 'annotate') {
      const latest = committed.at(-1)
      if (latest) {
        void publishChain
          .then(() =>
            chrome.runtime.sendMessage({
              captureSessionId,
              captureStartedAt,
              kind: 'browser-element-annotate-requested',
              selectionId: latest.selectionId,
              sequence: latest.sequence
            })
          )
          .catch(() => undefined)
      }
    }
    if (action === 'finish') finish('finished')
  }

  function receiveRuntimeMessage(message, _sender, sendResponse) {
    if (message?.kind === 'browser-element-picker-status') {
      sendResponse({ active: !finished, captureSessionId })
      return false
    }
    if (
      message?.kind === 'browser-element-picker-sync-session' &&
      message.captureSessionId === captureSessionId
    ) {
      const count = Number(message.selectedCount)
      if (Number.isSafeInteger(count) && count >= 0) {
        sessionSelectionCount = Math.max(sessionSelectionCount, count)
        updateStatus()
      }
      sendResponse({ ok: true })
      return false
    }
    if (
      message?.kind === 'browser-element-picker-stop-session' &&
      message.captureSessionId === captureSessionId
    ) {
      dispose()
      sendResponse({ ok: true })
      return false
    }
    if (
      message?.kind === 'browser-motion-recording-ended' &&
      message.captureSessionId === captureSessionId
    ) {
      recording = false
      updateStatus()
    }
    return false
  }

  function keydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      finish(sessionSelectionCount ? 'finished' : 'cancelled')
    } else if (
      event.key.toLowerCase() === 'r' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault()
      void toggleRecording().catch(() => undefined)
    } else if (event.key === 'ArrowUp' && selected.parentElement) {
      event.preventDefault()
      childBeforeAncestor = selected
      draw(selected.parentElement)
    } else if (event.key === 'ArrowDown' && childBeforeAncestor) {
      event.preventDefault()
      const child = childBeforeAncestor
      childBeforeAncestor = null
      draw(child)
    }
  }

  function cleanup() {
    if (hoverFrame) cancelAnimationFrame(hoverFrame)
    document.removeEventListener('pointermove', move, true)
    document.removeEventListener('click', choose, true)
    document.removeEventListener('keydown', keydown, true)
    document.removeEventListener('scroll', redraw, true)
    window.removeEventListener('resize', redraw)
    status.removeEventListener('click', statusClick)
    try {
      chrome.runtime.onMessage?.removeListener(receiveRuntimeMessage)
    } catch (error) {
      rethrowUnlessContextInvalidated(error)
    }
    host.remove()
    if (globalThis[PICKER_KEY]?.finish === finish) {
      globalThis[PICKER_KEY] = { active: false, dispose: null }
    }
  }

  function dispose() {
    if (finished) return
    finished = true
    cleanup()
  }

  function finish(reason = 'finished') {
    if (finished) return
    finished = true
    cleanup()
    const stoppedAt = new Date().toISOString()
    const stopRecording = recording
      ? chrome.runtime.sendMessage({
          captureSessionId,
          kind: 'stop-browser-motion-recording',
          startedAt: captureStartedAt
        })
      : Promise.resolve()
    void Promise.resolve(stopRecording)
      .catch(() => undefined)
      .then(() => publishChain.catch(() => undefined))
      .then(() =>
        chrome.runtime.sendMessage({
          captureSessionId,
          captureStartedAt,
          endedAt: stoppedAt,
          kind: 'browser-element-picker-ended',
          reason
        })
      )
      .catch(() => undefined)
  }

  globalThis[PICKER_KEY] = {
    active: true,
    captureSessionId,
    dispose,
    finish,
    sync(config) {
      const count = Number(config?.selectedCount)
      if (Number.isSafeInteger(count) && count >= 0) {
        sessionSelectionCount = Math.max(sessionSelectionCount, count)
        updateStatus()
      }
    }
  }
  document.addEventListener('pointermove', move, true)
  document.addEventListener('click', choose, true)
  document.addEventListener('keydown', keydown, true)
  document.addEventListener('scroll', redraw, true)
  window.addEventListener('resize', redraw)
  status.addEventListener('click', statusClick)
  chrome.runtime.onMessage?.addListener(receiveRuntimeMessage)
  draw(document.body)
  updateStatus()
  requestAnimationFrame(() => host.setAttribute('data-ready', 'true'))
  void chrome.runtime
    .sendMessage({
      captureSessionId,
      captureStartedAt,
      kind: 'browser-element-picker-started',
      page: {
        origin: window.location.origin,
        title: compact(document.title, 500),
        url: window.location.href.slice(0, 4_096)
      }
    })
    .catch(() => finish('selection-failed'))
})()
