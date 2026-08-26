/* oxlint-disable max-lines -- Chrome injects the picker as one self-contained script. */
;(() => {
  const PICKER_KEY = '__openpencilChromeElementPicker'
  const SESSION_CONFIG_KEY = '__openpencilPickerSessionConfig'
  const ICON_DATA_KEY = '__openpencilPickerIconData'
  const MAX_SNAPSHOT_LENGTH = 2_000_000
  const MIN_CONTEXT_WIDTH = 640
  const MIN_CONTEXT_HEIGHT = 360
  const CONTEXT_PADDING = 96
  const REQUIRED_PICKER_ICONS = [
    'message-circle-filled',
    'mic',
    'mic-off',
    'trash-2',
    'video'
  ]

  function rethrowUnlessContextInvalidated(error) {
    if (!String(error).includes('Extension context invalidated')) throw error
  }

  function compact(value, limit) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit)
  }

  function iconDataOrEmpty(value) {
    return value && typeof value === 'object' ? value : {}
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
  const injectedIconData = globalThis[ICON_DATA_KEY]
  const configuredSessionId =
    typeof injectedConfig?.captureSessionId === 'string'
      ? injectedConfig.captureSessionId
      : uniqueId()
  const previous = globalThis[PICKER_KEY]
  if (previous?.active && previous.captureSessionId === configuredSessionId) {
    previous.sync?.(injectedConfig, injectedIconData)
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
      context.save()
      context.strokeStyle = '#7567ff'
      context.lineWidth = lineWidth
      context.setLineDash([Math.max(5, 6 * scale), Math.max(3, 4 * scale)])
      context.strokeRect(boxX, boxY, boxWidth, boxHeight)
      context.restore()

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

  async function elementScreenshot(dataUrl, bounds) {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const ratioX = image.naturalWidth / window.innerWidth
    const ratioY = image.naturalHeight / window.innerHeight
    const sourceX = clamp(bounds.x, 0, window.innerWidth)
    const sourceY = clamp(bounds.y, 0, window.innerHeight)
    const sourceWidth = Math.max(1, Math.min(bounds.width, window.innerWidth - sourceX))
    const sourceHeight = Math.max(1, Math.min(bounds.height, window.innerHeight - sourceY))
    let scale = Math.min(1, 2_048 / (sourceWidth * ratioX), 2_048 / (sourceHeight * ratioY))

    function render() {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(sourceWidth * ratioX * scale))
      canvas.height = Math.max(1, Math.round(sourceHeight * ratioY * scale))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Canvas capture is unavailable')
      context.drawImage(
        image,
        Math.round(sourceX * ratioX),
        Math.round(sourceY * ratioY),
        Math.round(sourceWidth * ratioX),
        Math.round(sourceHeight * ratioY),
        0,
        0,
        canvas.width,
        canvas.height
      )
      return canvas
    }

    let canvas = render()
    let preview = canvas.toDataURL('image/png')
    while (preview.length > MAX_SNAPSHOT_LENGTH && scale > 0.32) {
      scale *= 0.78
      canvas = render()
      preview = canvas.toDataURL('image/png')
    }
    if (preview.length > MAX_SNAPSHOT_LENGTH) throw new Error('Element preview is too large')
    return { dataUrl: preview, height: canvas.height, width: canvas.width }
  }

  const captureSessionId = configuredSessionId
  const captureStartedAt =
    typeof injectedConfig?.captureStartedAt === 'string'
      ? injectedConfig.captureStartedAt
      : new Date().toISOString()
  let sessionSelectionCount = Number.isSafeInteger(injectedConfig?.selectedCount)
    ? injectedConfig.selectedCount
    : 0
  let pickerIcons = iconDataOrEmpty(injectedIconData)
  let selectionChain = Promise.resolve()
  let publishChain = Promise.resolve()
  let selected = document.body
  let childBeforeAncestor = null
  let hoverFrame = 0
  let pendingPointer = null
  let recording = false
  let finished = false
  let annotationDraft = null
  let annotationFocusedControl = 'input'
  let dictationGeneration = 0
  let dictationRecognition = null
  let exitHintTimer = 0
  let embeddedShieldFrame = 0
  const committed = []
  const embeddedShields = new Map()
  const pendingElements = new Set()
  const inspectorUiSelector = '[data-openpencil-browser-inspector-ui]'

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
      background: transparent;
      border: 2px dashed #7567ff;
      box-sizing: border-box;
      left: 0;
      position: fixed;
      top: 0;
      will-change: transform, width, height;
      z-index: 2;
    }
    [data-role="embedded-shield"] {
      background: transparent;
      border: 0;
      box-sizing: border-box;
      cursor: crosshair;
      left: 0;
      padding: 0;
      pointer-events: auto;
      position: fixed;
      top: 0;
      z-index: 1;
    }
    [data-role="outline"] {
      opacity: 0;
      transition: transform 80ms cubic-bezier(0.2, 0.8, 0.2, 1), width 80ms ease, height 80ms ease, opacity 120ms ease;
    }
    :host([data-ready="true"]) [data-role="outline"] { opacity: 1; }
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
      background: transparent;
      border: 0;
      color: white;
      display: flex;
      filter: drop-shadow(0 3px 8px #0000004d);
      font: 600 12px/1 system-ui, sans-serif;
      height: 36px;
      justify-content: center;
      left: -18px;
      padding: 0;
      position: absolute;
      top: -18px;
      width: 36px;
    }
    [data-role="marker-icon"] {
      height: 36px;
      inset: 0;
      position: absolute;
      width: 36px;
    }
    [data-role="marker-label"] {
      align-items: center;
      bottom: 0;
      box-sizing: border-box;
      display: flex;
      justify-content: center;
      left: 0;
      padding-bottom: 3px;
      position: absolute;
      right: 0;
      text-align: center;
      top: 0;
    }
    [data-role="committed"][data-current="true"] [data-role="number"] {
      opacity: 0;
      pointer-events: none;
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
      z-index: 2;
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
      box-shadow: 0 6px 18px #00000038;
      color: white;
      font: 600 10px/1 system-ui, sans-serif;
      left: 50%;
      opacity: 0;
      padding: 7px 10px;
      pointer-events: none;
      position: fixed;
      top: 10px;
      transform: translate(-50%, -5px) scale(0.96);
      transition: opacity 180ms ease, transform 180ms ease;
      white-space: nowrap;
      z-index: 4;
    }
    [data-role="status"][data-visible="true"] {
      opacity: 1;
      transform: translate(-50%, 0) scale(1);
    }
    [data-role="annotation-popover"] {
      align-items: center;
      display: none;
      gap: 4px;
      height: 48px;
      left: 0;
      max-width: calc(100vw - 24px);
      pointer-events: auto;
      position: fixed;
      top: 0;
      z-index: 3;
    }
    :host([data-annotation-open="true"]) [data-role="annotation-popover"] { display: flex; }
    [data-role="annotation-popover"][data-side="left"] { flex-direction: row-reverse; }
    [data-role="annotation-pin"] {
      align-items: center;
      align-self: center;
      background: transparent;
      border: 0;
      color: white;
      display: flex;
      filter: drop-shadow(0 3px 8px #0000004d);
      flex: 0 0 auto;
      font: 600 12px/1 system-ui, sans-serif;
      height: 36px;
      justify-content: center;
      padding: 0;
      position: relative;
      transform: translateY(-8px);
      width: 36px;
    }
    [data-role="annotation-composer"] {
      align-items: center;
      backdrop-filter: blur(22px);
      background: #fffffff5;
      border: 1px solid #d9dbe5;
      border-radius: 999px;
      box-shadow: 0 18px 55px #00000038, 0 1px 2px #1518211f;
      box-sizing: border-box;
      display: flex;
      gap: 4px;
      height: 48px;
      padding: 6px;
      pointer-events: auto;
      width: min(360px, calc(100vw - 64px));
    }
    [data-role="annotation-input"], ::slotted([data-role="annotation-input"]) {
      background: transparent;
      border: 0;
      box-sizing: border-box;
      color: #20232b;
      flex: 1 1 auto;
      font: 500 14px/1.3 system-ui, sans-serif;
      height: 36px;
      min-width: 72px;
      outline: none;
      padding: 0 12px;
      pointer-events: auto;
    }
    [data-role="annotation-input"]::placeholder { color: #818694; }
    [data-role="annotation-composer"] button {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: 999px;
      color: #737887;
      cursor: pointer;
      display: flex;
      flex: 0 0 auto;
      height: 36px;
      justify-content: center;
      padding: 0;
      position: relative;
      transition: background 120ms ease, color 120ms ease, opacity 120ms ease, transform 120ms ease;
      width: 36px;
    }
    [data-role="annotation-composer"] button:hover {
      background: #eef0f4;
      color: #20232b;
    }
    [data-role="annotation-composer"] button:active { transform: scale(0.94); }
    [data-role="annotation-composer"] button:focus-visible {
      outline: 2px solid #6d5efc66;
      outline-offset: 1px;
    }
    [data-role="annotation-composer"] button:disabled {
      cursor: default;
      opacity: 0.38;
    }
    [data-role="annotation-composer"] button[hidden] { display: none; }
    [data-role="annotation-icon"] {
      display: block;
      height: 19px;
      object-fit: contain;
      pointer-events: none;
      width: 19px;
    }
    [data-tooltip]::after {
      background: #19191ff2;
      border: 1px solid #ffffff24;
      border-radius: 6px;
      bottom: calc(100% + 4px);
      box-shadow: 0 5px 16px #00000030;
      color: white;
      content: attr(data-tooltip);
      font: 600 10px/1 system-ui, sans-serif;
      left: 50%;
      opacity: 0;
      padding: 6px 7px;
      pointer-events: none;
      position: absolute;
      transform: translate(-50%, 2px) scale(0.96);
      transition: opacity 100ms ease, transform 100ms ease, visibility 0s linear 100ms;
      visibility: hidden;
      white-space: nowrap;
      z-index: 5;
    }
    [data-tooltip]:hover::after, [data-tooltip]:focus-visible::after {
      opacity: 1;
      transform: translate(-50%, 0) scale(1);
      transition-delay: 400ms;
      visibility: visible;
    }
    [data-role="annotation-composer"] [data-action="record"] {
      color: #e2434b;
    }
    [data-role="annotation-composer"] [data-action="record"]:hover { background: #ffeded; }
    [data-role="annotation-composer"] [data-action="delete"]:hover {
      background: #fff0f0;
      color: #d33f49;
    }
    [data-role="annotation-composer"] [data-action="dictate"][aria-pressed="true"] {
      background: #6d5efc;
      color: white;
    }
    [data-role="number"] {
      pointer-events: auto;
    }
    @keyframes openpencil-picker-status-in {
      from { opacity: 0; transform: translate(-50%, -8px) scale(0.96); }
      to { opacity: 1; transform: translate(-50%, 0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-role="outline"], [data-role="cursor"], [data-role="status"] { transition: none; }
      [data-role="status"] { animation: none; }
    }
  `
  const embeddedLayer = document.createElement('div')
  embeddedLayer.setAttribute('data-role', 'embedded-layer')
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
  status.textContent = 'Press Esc to exit'
  const annotationPopover = document.createElement('div')
  annotationPopover.setAttribute('data-role', 'annotation-popover')
  const annotationPin = document.createElement('span')
  annotationPin.setAttribute('data-role', 'annotation-pin')
  const annotationPinIcon = document.createElement('img')
  annotationPinIcon.setAttribute('data-role', 'marker-icon')
  annotationPinIcon.setAttribute('aria-hidden', 'true')
  annotationPinIcon.draggable = false
  const annotationPinLabel = document.createElement('span')
  annotationPinLabel.setAttribute('data-role', 'marker-label')
  annotationPin.append(annotationPinIcon, annotationPinLabel)
  const annotationComposer = document.createElement('form')
  annotationComposer.setAttribute('data-role', 'annotation-composer')
  const annotationInputSlot = document.createElement('slot')
  annotationInputSlot.name = 'annotation-input'
  const annotationInput = document.createElement('input')
  annotationInput.slot = 'annotation-input'
  annotationInput.setAttribute('data-openpencil-browser-inspector-ui', '')
  annotationInput.setAttribute('data-role', 'annotation-input')
  annotationInput.setAttribute('aria-label', 'Element comment')
  annotationInput.setAttribute('placeholder', 'Add a comment…')
  for (const [property, value] of [
    ['all', 'initial'],
    ['background', 'transparent'],
    ['border', '0'],
    ['box-sizing', 'border-box'],
    ['color', '#20232b'],
    ['display', 'block'],
    ['flex', '1 1 auto'],
    ['font', '500 14px/1.3 system-ui, sans-serif'],
    ['height', '36px'],
    ['min-width', '72px'],
    ['outline', 'none'],
    ['padding', '0 12px'],
    ['pointer-events', 'auto'],
    ['width', '100%']
  ]) {
    annotationInput.style.setProperty(property, value, 'important')
  }
  const deleteButton = document.createElement('button')
  deleteButton.type = 'button'
  deleteButton.setAttribute('data-action', 'delete')
  deleteButton.setAttribute('aria-label', 'Delete annotation and selection')
  deleteButton.setAttribute('data-tooltip', 'Delete selection')
  const deleteIcon = document.createElement('img')
  deleteIcon.setAttribute('data-role', 'annotation-icon')
  deleteIcon.setAttribute('aria-hidden', 'true')
  deleteIcon.draggable = false
  const dictateButton = document.createElement('button')
  dictateButton.type = 'button'
  dictateButton.setAttribute('data-action', 'dictate')
  dictateButton.setAttribute('aria-label', 'Start dictation')
  dictateButton.setAttribute('aria-pressed', 'false')
  dictateButton.setAttribute('data-tooltip', 'Dictate comment')
  const dictateIcon = document.createElement('img')
  dictateIcon.setAttribute('data-role', 'annotation-icon')
  dictateIcon.setAttribute('aria-hidden', 'true')
  dictateIcon.draggable = false
  const recordButton = document.createElement('button')
  recordButton.type = 'button'
  recordButton.setAttribute('data-action', 'record')
  recordButton.setAttribute('aria-label', 'Record motion')
  recordButton.setAttribute('data-tooltip', 'Record motion')
  const recordIcon = document.createElement('img')
  recordIcon.setAttribute('data-role', 'annotation-icon')
  recordIcon.setAttribute('aria-hidden', 'true')
  recordIcon.draggable = false
  deleteButton.append(deleteIcon)
  dictateButton.append(dictateIcon)
  recordButton.append(recordIcon)
  annotationComposer.append(annotationInputSlot, deleteButton, dictateButton, recordButton)
  annotationPopover.append(annotationPin, annotationComposer)
  shadow.append(style, embeddedLayer, committedLayer, outline, cursor, status, annotationPopover)
  host.append(annotationInput)
  document.documentElement.append(host)

  function setAnnotationIcon(icon, name) {
    const source = pickerIcons[name]
    if (typeof source === 'string' && source.startsWith('data:image/svg+xml')) {
      icon.src = source
    } else {
      icon.removeAttribute('src')
    }
  }

  function updateIconReadiness() {
    const ready = REQUIRED_PICKER_ICONS.every((name) => {
      const source = pickerIcons[name]
      return typeof source === 'string' && source.startsWith('data:image/svg+xml')
    })
    host.setAttribute('data-icons-ready', String(ready))
  }

  setAnnotationIcon(annotationPinIcon, 'message-circle-filled')
  setAnnotationIcon(deleteIcon, 'trash-2')
  setAnnotationIcon(dictateIcon, 'mic')
  setAnnotationIcon(recordIcon, 'video')
  updateIconReadiness()

  function setAnnotationInputVisible(visible) {
    annotationInput.style.setProperty('display', visible ? 'block' : 'none', 'important')
    annotationInput.style.setProperty('pointer-events', visible ? 'auto' : 'none', 'important')
  }

  setAnnotationInputVisible(false)

  function showStatus(message, durationMs = 1_800) {
    if (exitHintTimer) window.clearTimeout(exitHintTimer)
    status.textContent = message
    status.setAttribute('data-visible', 'true')
    host.setAttribute('data-exit-hint-visible', 'true')
    exitHintTimer = window.setTimeout(() => {
      status.setAttribute('data-visible', 'false')
      host.setAttribute('data-exit-hint-visible', 'false')
      exitHintTimer = 0
    }, durationMs)
  }

  function showExitHint() {
    showStatus('Press Esc to exit')
  }

  function annotationPosition(item) {
    const rect = item.element.getBoundingClientRect()
    const markerX = clamp(rect.left + item.markerOffset.x, 18, window.innerWidth - 18)
    const markerY = clamp(rect.top + item.markerOffset.y, 24, window.innerHeight - 24)
    const composerWidth = Math.min(360, window.innerWidth - 64)
    const popoverWidth = composerWidth + 40
    const opensLeft = markerX / window.innerWidth > 0.62
    const preferredLeft = opensLeft ? markerX - composerWidth - 22 : markerX - 18
    annotationPopover.dataset.side = opensLeft ? 'left' : 'right'
    annotationPopover.style.left = `${String(clamp(preferredLeft, 12, window.innerWidth - popoverWidth - 12))}px`
    annotationPopover.style.top = `${String(markerY)}px`
    annotationPopover.style.transform = 'translateY(-50%)'
  }

  function queueAnnotationUpdate(item) {
    publishChain = publishChain
      .then(() =>
        chrome.runtime.sendMessage({
          annotations: structuredClone(item.annotations),
          captureSessionId,
          kind: 'browser-element-annotations-updated',
          selectionId: item.selectionId
        })
      )
      .catch(() => undefined)
  }

  function queueSelectionRemoval(item) {
    publishChain = publishChain
      .then(() =>
        chrome.runtime.sendMessage({
          captureSessionId,
          kind: 'browser-element-selection-removed',
          selectionId: item.selectionId
        })
      )
      .catch(() => undefined)
  }

  function setDictationState(active, error = '') {
    dictateButton.setAttribute('aria-pressed', active ? 'true' : 'false')
    dictateButton.setAttribute('aria-label', active ? 'Stop dictation' : 'Start dictation')
    dictateButton.setAttribute(
      'data-tooltip',
      error || (active ? 'Stop dictation' : 'Dictate comment')
    )
    setAnnotationIcon(dictateIcon, active ? 'mic-off' : 'mic')
    host.setAttribute('data-dictating', active ? 'true' : 'false')
  }

  function stopDictation() {
    dictationGeneration += 1
    const recognition = dictationRecognition
    dictationRecognition = null
    try {
      recognition?.stop()
    } catch (error) {
      console.warn('Unable to stop browser comment dictation cleanly', error)
    }
    setDictationState(false)
  }

  function startDictation() {
    if (!annotationDraft) return
    if (dictationRecognition) {
      stopDictation()
      return
    }
    const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition
    if (!Recognition) {
      setDictationState(false, 'Dictation unavailable')
      return
    }
    stopDictation()
    const generation = ++dictationGeneration
    const transcriptBase = annotationInput.value.trim()
    const recognition = new Recognition()
    dictationRecognition = recognition
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'
    recognition.onresult = (event) => {
      if (generation !== dictationGeneration) return
      let transcript = ''
      for (const result of Array.from(event.results)) {
        transcript += result[0]?.transcript ?? ''
      }
      annotationInput.value = [transcriptBase, transcript.trim()].filter(Boolean).join(' ')
      host.setAttribute('data-annotation-value-length', String(annotationInput.value.length))
    }
    recognition.onerror = (event) => {
      if (generation !== dictationGeneration) return
      dictationRecognition = null
      dictationGeneration += 1
      setDictationState(
        false,
        event.error === 'not-allowed' ? 'Microphone access denied' : 'Dictation stopped'
      )
    }
    recognition.onend = () => {
      if (generation !== dictationGeneration) return
      dictationRecognition = null
      setDictationState(false)
    }
    try {
      recognition.start()
      setDictationState(true)
    } catch {
      dictationRecognition = null
      dictationGeneration += 1
      setDictationState(false, 'Dictation unavailable')
    }
  }

  function commitAnnotationDraft() {
    const item = annotationDraft
    if (!item) return null
    stopDictation()
    const comment = compact(annotationInput.value, 2_000)
    item.annotations = comment ? [{ ...item.annotation, comment }] : []
    item.annotation.comment = comment
    item.closedOnce = true
    item.frame.removeAttribute('data-current')
    queueAnnotationUpdate(item)
    annotationDraft = null
    host.setAttribute('data-annotation-open', 'false')
    setAnnotationInputVisible(false)
    return item
  }

  function openAnnotation(item) {
    if (annotationDraft === item) {
      annotationInput.focus({ preventScroll: true })
      return
    }
    commitAnnotationDraft()
    annotationDraft = item
    item.frame.setAttribute('data-current', 'true')
    annotationPinLabel.textContent = String(item.sequence)
    annotationInput.value = item.annotation.comment
    host.setAttribute('data-annotation-value-length', String(annotationInput.value.length))
    deleteButton.hidden = !item.closedOnce
    host.setAttribute('data-annotation-revisit', item.closedOnce ? 'true' : 'false')
    annotationPosition(item)
    host.setAttribute('data-annotation-open', 'true')
    setAnnotationInputVisible(true)
    annotationFocusedControl = 'input'
    host.setAttribute('data-annotation-focus', 'input')
    setDictationState(false)
    annotationInput.focus({ preventScroll: true })
  }

  function deleteSelection() {
    const item = annotationDraft
    if (!item) return
    stopDictation()
    annotationDraft = null
    item.frame.removeAttribute('data-current')
    host.setAttribute('data-annotation-open', 'false')
    setAnnotationInputVisible(false)
    const index = committed.indexOf(item)
    if (index !== -1) committed.splice(index, 1)
    item.frame.remove()
    host.setAttribute('data-committed-count', String(committed.length))
    queueSelectionRemoval(item)
  }

  function place(frame, element) {
    const rect = element.getBoundingClientRect()
    frame.style.transform = `translate(${rect.left}px, ${rect.top}px)`
    frame.style.width = `${Math.max(1, rect.width)}px`
    frame.style.height = `${Math.max(1, rect.height)}px`
    return rect
  }

  function embeddedElements() {
    return document.querySelectorAll('iframe, frame, embed, object')
  }

  function updateEmbeddedShield(element, shield) {
    const rect = place(shield, element)
    shield.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none'
  }

  function createEmbeddedShield(element) {
    const shield = document.createElement('button')
    shield.type = 'button'
    shield.setAttribute('data-role', 'embedded-shield')
    shield.setAttribute('aria-label', `Select ${element.tagName.toLowerCase()}`)
    shield.addEventListener('pointermove', (event) => {
      cursor.style.transform = `translate(${event.clientX - 6}px, ${event.clientY - 6}px)`
      cursor.setAttribute('data-visible', 'true')
      childBeforeAncestor = null
      draw(element)
      updateEmbeddedShield(element, shield)
    })
    shield.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      selectElement(element, event.clientX, event.clientY)
    })
    return shield
  }

  function syncEmbeddedShields() {
    embeddedShieldFrame = 0
    const connected = new Set()
    for (const element of embeddedElements()) {
      connected.add(element)
      let shield = embeddedShields.get(element)
      if (!shield) {
        shield = createEmbeddedShield(element)
        embeddedShields.set(element, shield)
        embeddedLayer.append(shield)
      }
      updateEmbeddedShield(element, shield)
    }
    for (const [element, shield] of embeddedShields) {
      if (connected.has(element) && element.isConnected) continue
      shield.remove()
      embeddedShields.delete(element)
    }
    const count = String(embeddedShields.size)
    if (host.getAttribute('data-embedded-shield-count') !== count) {
      host.setAttribute('data-embedded-shield-count', count)
    }
  }

  function queueEmbeddedShieldSync() {
    if (!embeddedShieldFrame) embeddedShieldFrame = requestAnimationFrame(syncEmbeddedShields)
  }

  function placeCommitted(item) {
    const rect = place(item.frame, item.element)
    const markerX = clamp(item.markerOffset.x, 0, rect.width)
    const markerY = clamp(item.markerOffset.y, 0, rect.height)
    item.number.style.left = `${String(markerX - 18)}px`
    item.number.style.top = `${String(markerY - 18)}px`
  }

  function draw(element) {
    selected = element
    outline.style.opacity = ''
    const rect = place(outline, element)
    label.textContent = `${element.tagName.toLowerCase()}${accessibleName(element) ? ` · ${accessibleName(element)}` : ''}`
    const below = rect.top < 34
    label.style.bottom = below ? 'auto' : '100%'
    label.style.top = below ? '100%' : 'auto'
    label.style.borderRadius = below ? '0 0 4px 4px' : '4px 4px 0 0'
  }

  function redraw() {
    if (recording) return
    syncEmbeddedShields()
    if (selected.isConnected) draw(selected)
    for (const item of committed) {
      if (item.element.isConnected) placeCommitted(item)
      else item.frame.style.display = 'none'
    }
    if (annotationDraft?.element.isConnected) annotationPosition(annotationDraft)
  }

  function addCommitted(element, itemSequence, selectionId, annotation, markerOffset) {
    const frame = document.createElement('div')
    frame.setAttribute('data-role', 'committed')
    frame.setAttribute('data-sequence', String(itemSequence))
    const number = document.createElement('button')
    number.type = 'button'
    number.setAttribute('data-role', 'number')
    number.setAttribute('aria-label', `Open element comment ${String(itemSequence)}`)
    const numberIcon = document.createElement('img')
    numberIcon.setAttribute('data-role', 'marker-icon')
    numberIcon.setAttribute('aria-hidden', 'true')
    numberIcon.draggable = false
    setAnnotationIcon(numberIcon, 'message-circle-filled')
    const numberLabel = document.createElement('span')
    numberLabel.setAttribute('data-role', 'marker-label')
    numberLabel.textContent = String(itemSequence)
    number.append(numberIcon, numberLabel)
    frame.append(number)
    committedLayer.append(frame)
    const item = {
      annotation,
      annotations: [annotation],
      closedOnce: false,
      element,
      frame,
      markerOffset,
      number,
      numberIcon,
      selectionId,
      sequence: itemSequence
    }
    committed.push(item)
    host.setAttribute('data-committed-count', String(committed.length))
    number.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openAnnotation(item)
    })
    placeCommitted(item)
    openAnnotation(item)
    return item
  }

  function flushPointer() {
    hoverFrame = 0
    const point = pendingPointer
    pendingPointer = null
    if (!point) return
    cursor.style.transform = `translate(${point.x - 6}px, ${point.y - 6}px)`
    cursor.setAttribute('data-visible', 'true')
    const candidate = document.elementFromPoint(point.x, point.y)
    if (candidate instanceof Element && candidate.closest(inspectorUiSelector)) {
      cursor.setAttribute('data-visible', 'false')
      outline.style.opacity = '0'
      return
    }
    if (candidate instanceof Element && candidate !== host) {
      childBeforeAncestor = null
      draw(candidate)
    }
  }

  function move(event) {
    if (recording) return
    pendingPointer = { x: event.clientX, y: event.clientY }
    if (!hoverFrame) hoverFrame = requestAnimationFrame(flushPointer)
  }

  async function publish(element, itemSequence, selectionId, annotation, region) {
    const response = await chrome.runtime.sendMessage({
      kind: 'capture-visible-browser-element'
    })
    if (!response?.ok) throw new Error(response?.reason || 'Element capture failed')
    const bounds = element.getBoundingClientRect()
    const capturedAt = new Date().toISOString()
    const surfacePreview = await elementScreenshot(response.dataUrl, bounds)
    const selection = {
      capturedAt,
      element: {
        accessibleName: accessibleName(element),
        attributes: attributesFor(element),
        bounds: {
          height: bounds.height,
          width: bounds.width,
          x: bounds.x,
          y: bounds.y
        },
        classes: [...element.classList].slice(0, 24).map((value) => compact(value, 160)),
        role: compact(element.getAttribute('role'), 160),
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        text: compact(element.innerText || element.textContent, 1_000)
      },
      id: selectionId,
      annotations: [annotation],
      page: {
        origin: window.location.origin,
        title: compact(document.title, 500),
        url: window.location.href.slice(0, 4_096)
      },
      sourceWindow: {
        devicePixelRatio: window.devicePixelRatio,
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        outerHeight: window.outerHeight,
        outerWidth: window.outerWidth,
        screenX: window.screenX,
        screenY: window.screenY
      },
      surfacePreview,
      session: {
        captureSessionId,
        captureStartedAt,
        frameId: 0,
        sequence: itemSequence,
        tabId: 0
      },
      snapshot: await contextScreenshot(response.dataUrl, region, itemSequence)
    }
    await chrome.runtime.sendMessage({
      kind: 'browser-element-selection',
      selection
    })
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
    return sessionSelectionCount
  }

  function choose(event) {
    if (recording) return
    if (
      event.target === host ||
      (event.target instanceof Element && event.target.closest(inspectorUiSelector))
    ) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    const candidate = event
      .composedPath()
      .find(
        (target) =>
          target instanceof Element &&
          target !== host &&
          !target.closest(inspectorUiSelector)
      )
    const chosen = candidate instanceof Element && candidate !== host ? candidate : selected
    selectElement(chosen, event.clientX, event.clientY)
  }

  function selectElement(chosen, clientX, clientY) {
    const existing = committed.find((item) => item.element === chosen)
    if (existing) {
      if (annotationDraft === existing) {
        commitAnnotationDraft()
        return
      }
      openAnnotation(existing)
      return
    }
    if (pendingElements.has(chosen)) return
    commitAnnotationDraft()
    pendingElements.add(chosen)
    const selectionId = uniqueId()
    const region = contextRect(chosen)
    const chosenBounds = chosen.getBoundingClientRect()
    const markerOffset = {
      x: clamp(clientX - chosenBounds.left, 0, chosenBounds.width),
      y: clamp(clientY - chosenBounds.top, 0, chosenBounds.height)
    }
    const annotation = {
      comment: '',
      id: uniqueId(),
      x: clamp((clientX - region.x) / region.width, 0, 1),
      y: clamp((clientY - region.y) / region.height, 0, 1)
    }
    selectionChain = selectionChain
      .then(async () => {
        const itemSequence = await reserveSelectionSequence()
        addCommitted(chosen, itemSequence, selectionId, annotation, markerOffset)
        pendingElements.delete(chosen)
        publishChain = publishChain
          .then(() => publish(chosen, itemSequence, selectionId, annotation, region))
          .catch(() => finish('selection-failed'))
        return undefined
      })
      .catch(() => {
        pendingElements.delete(chosen)
        finish('selection-failed')
      })
  }

  function waitForCleanPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  }

  function setRecordingChromeHidden(hidden) {
    host.setAttribute('data-recording-clean', hidden ? 'true' : 'false')
    host.style.setProperty('visibility', hidden ? 'hidden' : 'visible', 'important')
  }

  async function startRecording() {
    const item = commitAnnotationDraft() ?? committed.at(-1) ?? null
    recording = true
    setRecordingChromeHidden(true)
    await waitForCleanPaint()
    const response = await chrome.runtime.sendMessage({
      captureSessionId,
      kind: 'start-browser-motion-recording',
      startedAt: captureStartedAt
    })
    if (!response?.ok) {
      recording = false
      setRecordingChromeHidden(false)
      if (item) openAnnotation(item)
      throw new Error(response?.reason || 'Motion recording is unavailable')
    }
    host.setAttribute('data-recording-mode', response.mode || 'tab-capture')
  }

  async function toggleRecording() {
    if (!recording) return startRecording()
    const response = await chrome.runtime.sendMessage({
      captureSessionId,
      kind: 'stop-browser-motion-recording',
      startedAt: captureStartedAt
    })
    if (!response?.ok) throw new Error(response?.reason || 'Motion recording is unavailable')
    recording = false
    setRecordingChromeHidden(false)
    showExitHint()
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
      setRecordingChromeHidden(false)
      showExitHint()
    }
    return false
  }

  function keydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      finish('finished')
    } else if (event.key === 'Tab' && annotationDraft) {
      event.stopImmediatePropagation()
      annotationComposerKeydown(event)
    } else if (annotationDraft && event.key === 'Enter') {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (annotationFocusedControl === 'input') {
        commitAnnotationDraft()
      } else {
        let focusedButton = recordButton
        if (annotationFocusedControl === 'delete') focusedButton = deleteButton
        else if (annotationFocusedControl === 'dictate') focusedButton = dictateButton
        focusedButton.click()
      }
    } else if (
      event.key.toLowerCase() === 'r' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !annotationDraft &&
      !event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            (target instanceof HTMLElement && target.isContentEditable)
        )
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
    stopDictation()
    if (hoverFrame) cancelAnimationFrame(hoverFrame)
    if (embeddedShieldFrame) cancelAnimationFrame(embeddedShieldFrame)
    if (exitHintTimer) window.clearTimeout(exitHintTimer)
    embeddedObserver.disconnect()
    document.removeEventListener('pointermove', move, true)
    document.removeEventListener('click', choose, true)
    document.removeEventListener('keydown', keydown, true)
    document.removeEventListener('scroll', redraw, true)
    window.removeEventListener('resize', redraw)
    annotationComposer.removeEventListener('submit', submitAnnotation)
    annotationComposer.removeEventListener('pointerdown', annotationComposerPointerDown)
    annotationComposer.removeEventListener('click', stopAnnotationPointer)
    annotationInput.removeEventListener('input', annotationInputChanged)
    deleteButton.removeEventListener('click', deleteAnnotationSelection)
    dictateButton.removeEventListener('click', toggleAnnotationDictation)
    recordButton.removeEventListener('click', recordMotion)
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
    commitAnnotationDraft()
    finished = true
    cleanup()
  }

  function finish(reason = 'finished') {
    if (finished) return
    commitAnnotationDraft()
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
    sync(config, iconData) {
      const count = Number(config?.selectedCount)
      if (Number.isSafeInteger(count) && count >= 0) {
        sessionSelectionCount = Math.max(sessionSelectionCount, count)
      }
      if (iconData && typeof iconData === 'object') {
        pickerIcons = iconData
        setAnnotationIcon(annotationPinIcon, 'message-circle-filled')
        setAnnotationIcon(deleteIcon, 'trash-2')
        setAnnotationIcon(dictateIcon, dictationRecognition ? 'mic-off' : 'mic')
        setAnnotationIcon(recordIcon, 'video')
        for (const item of committed) {
          setAnnotationIcon(item.numberIcon, 'message-circle-filled')
        }
        updateIconReadiness()
      }
    }
  }
  document.addEventListener('pointermove', move, true)
  document.addEventListener('click', choose, true)
  document.addEventListener('keydown', keydown, true)
  document.addEventListener('scroll', redraw, true)
  window.addEventListener('resize', redraw)
  function submitAnnotation(event) {
    event.preventDefault()
    commitAnnotationDraft()
  }
  function annotationComposerPointerDown(event) {
    event.stopPropagation()
    if (event.composedPath().includes(annotationInput)) {
      annotationInput.focus({ preventScroll: true })
    }
  }
  function stopAnnotationPointer(event) {
    event.stopPropagation()
  }
  function annotationInputChanged() {
    host.setAttribute('data-annotation-value-length', String(annotationInput.value.length))
  }
  function annotationComposerKeydown(event) {
    if (event.key !== 'Tab') return
    const entries = [
      [annotationInput, 'input'],
      ...(!deleteButton.hidden ? [[deleteButton, 'delete']] : []),
      [dictateButton, 'dictate'],
      [recordButton, 'record']
    ]
    const controls = entries.map(([control]) => control)
    const controlNames = entries.map(([, name]) => name)
    const currentIndex = controlNames.indexOf(annotationFocusedControl)
    const offset = event.shiftKey ? -1 : 1
    const nextIndex = (Math.max(0, currentIndex) + offset + controls.length) % controls.length
    event.preventDefault()
    controls[nextIndex].focus({ preventScroll: true })
  }
  function recordMotion() {
    void startRecording().catch(() => showStatus('Motion recording unavailable', 3_000))
  }
  function toggleAnnotationDictation() {
    startDictation()
  }
  function deleteAnnotationSelection() {
    deleteSelection()
  }
  annotationComposer.addEventListener('submit', submitAnnotation)
  ;[
    [annotationInput, 'input'],
    [deleteButton, 'delete'],
    [dictateButton, 'dictate'],
    [recordButton, 'record']
  ].forEach(([control, name]) => {
    control.addEventListener('focus', () => {
      annotationFocusedControl = name
      host.setAttribute('data-annotation-focus', name)
    })
  })
  deleteButton.addEventListener('click', deleteAnnotationSelection)
  dictateButton.addEventListener('click', toggleAnnotationDictation)
  recordButton.addEventListener('click', recordMotion)
  annotationComposer.addEventListener('pointerdown', annotationComposerPointerDown)
  annotationComposer.addEventListener('click', stopAnnotationPointer)
  annotationInput.addEventListener('input', annotationInputChanged)
  chrome.runtime.onMessage?.addListener(receiveRuntimeMessage)
  const embeddedObserver = new MutationObserver(queueEmbeddedShieldSync)
  embeddedObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true
  })
  syncEmbeddedShields()
  draw(document.body)
  host.setAttribute('data-annotation-open', 'false')
  host.setAttribute('data-committed-count', '0')
  host.setAttribute('data-dictating', 'false')
  host.setAttribute('data-annotation-value-length', '0')
  host.setAttribute('data-recording-clean', 'false')
  showExitHint()
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
