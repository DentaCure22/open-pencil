;(() => {
  const RELAY_KEY = '__openpencilExternalLiveSurfaceRelay'
  const MESSAGE_KIND = 'browser-live-surface-input'
  const MEASURE_KIND = 'browser-live-surface-measure'

  globalThis[RELAY_KEY]?.dispose?.()

  let pointerTarget = null

  function compact(value, limit = 1_000) {
    return String(value || '')
      .replaceAll(/\s+/g, ' ')
      .trim()
      .slice(0, limit)
  }

  function accessibleName(element) {
    return compact(
      element?.getAttribute?.('aria-label') ||
        element?.getAttribute?.('title') ||
        element?.getAttribute?.('placeholder'),
      500
    )
  }

  function fingerprintScore(source, element) {
    if (!(element instanceof Element)) return 0
    let score = element.tagName.toLowerCase() === source.element.tag ? 0.3 : 0
    if (
      source.element.accessibleName &&
      accessibleName(element) === source.element.accessibleName
    ) {
      score += 0.3
    }
    const text = compact(element.innerText || element.textContent)
    if (source.element.text && text === source.element.text) score += 0.2
    const classes = Array.isArray(source.element.classes) ? source.element.classes : []
    if (classes.length) {
      score +=
        0.1 *
        (classes.filter((className) => element.classList.contains(className)).length /
          classes.length)
    }
    const attributes = Object.entries(source.element.attributes || {})
    if (attributes.length) {
      score +=
        0.1 *
        (attributes.filter(([name, value]) => compact(element.getAttribute(name), 500) === value)
          .length /
          attributes.length)
    }
    return score
  }

  function resolveSourceElement(source) {
    try {
      const direct = [...document.querySelectorAll(source.element.selector)]
      if (direct.length === 1) return direct[0]
      if (direct.length > 1) {
        return direct.sort(
          (left, right) => fingerprintScore(source, right) - fingerprintScore(source, left)
        )[0]
      }
    } catch (error) {
      console.debug('OpenPencil ignored an invalid retained source selector.', error)
    }
    const candidates = [...document.querySelectorAll(source.element.tag || '*')].slice(0, 2_500)
    const ranked = candidates
      .map((element) => ({ element, score: fingerprintScore(source, element) }))
      .sort((left, right) => right.score - left.score)
    return ranked[0]?.score >= 0.55 ? ranked[0].element : null
  }

  function pointFor(element, input) {
    const bounds = element.getBoundingClientRect()
    return {
      x: bounds.left + Math.min(1, Math.max(0, Number(input.xRatio))) * bounds.width,
      y: bounds.top + Math.min(1, Math.max(0, Number(input.yRatio))) * bounds.height
    }
  }

  function targetAt(element, point) {
    const candidate = document.elementFromPoint(point.x, point.y)
    return candidate instanceof Element && element.contains(candidate) ? candidate : element
  }

  function eventModifiers(input) {
    return {
      altKey: Boolean(input.altKey),
      ctrlKey: Boolean(input.ctrlKey),
      metaKey: Boolean(input.metaKey),
      shiftKey: Boolean(input.shiftKey)
    }
  }

  function relayPointer(element, input) {
    const point = pointFor(element, input)
    const currentTarget =
      input.phase === 'up' && pointerTarget?.isConnected ? pointerTarget : targetAt(element, point)
    if (input.phase === 'down') {
      pointerTarget = currentTarget
      currentTarget.focus?.({ preventScroll: true })
    }
    const pointerType = `pointer${input.phase}`
    const mouseType = `mouse${input.phase}`
    const init = {
      bubbles: true,
      button: Number(input.button) || 0,
      buttons: Number(input.buttons) || 0,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      view: window
    }
    currentTarget.dispatchEvent(new PointerEvent(pointerType, init))
    currentTarget.dispatchEvent(new MouseEvent(mouseType, init))
    if (input.phase === 'up') {
      currentTarget.click?.()
      pointerTarget = null
    }
    return true
  }

  function scrollOwner(element) {
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      if (/auto|scroll/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
        return current
      }
    }
    return document.scrollingElement
  }

  function relayWheel(element, input) {
    const point = pointFor(element, input)
    const target = targetAt(element, point)
    const init = {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaX: Number(input.deltaX) || 0,
      deltaY: Number(input.deltaY) || 0,
      view: window,
      ...eventModifiers(input)
    }
    const allowed = target.dispatchEvent(new WheelEvent('wheel', init))
    if (allowed) scrollOwner(target)?.scrollBy?.(init.deltaX, init.deltaY)
    return true
  }

  function editableTarget(element) {
    const focused = document.activeElement
    if (focused instanceof HTMLElement && element.contains(focused)) return focused
    if (element.matches('input, textarea, [contenteditable="true"]')) return element
    return element.querySelector('input, textarea, [contenteditable="true"]') || element
  }

  function relayText(element, input) {
    const target = editableTarget(element)
    target.focus?.({ preventScroll: true })
    const text = String(input.text || '')
    if (!text) return true
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const prototype =
        target instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      const start = target.selectionStart ?? target.value.length
      const end = target.selectionEnd ?? start
      const next = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`
      target.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: 'insertText'
        })
      )
      descriptor?.set?.call(target, next)
      target.setSelectionRange(start + text.length, start + text.length)
      target.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' })
      )
      return true
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      document.execCommand('insertText', false, text)
      return true
    }
    return false
  }

  function relayKey(element, input) {
    const target = editableTarget(element)
    target.focus?.({ preventScroll: true })
    const type = input.phase === 'up' ? 'keyup' : 'keydown'
    target.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        code: compact(input.code, 80),
        key: compact(input.key, 80),
        ...eventModifiers(input)
      })
    )
    if (input.phase === 'down' && (input.key === 'Enter' || input.code === 'Space')) {
      if (target.matches?.('button, a, input[type="button"], input[type="submit"]')) target.click()
    }
    return true
  }

  function receive(message, _sender, sendResponse) {
    if (message?.kind === MEASURE_KIND) {
      if (message.contract !== 'openpencil-browser-live-surface-measure/v1') return false
      const element = resolveSourceElement(message.source)
      if (!element) {
        sendResponse({ ok: false, reason: 'source-element-unavailable' })
        return false
      }
      const bounds = element.getBoundingClientRect()
      sendResponse({
        bounds: {
          height: bounds.height,
          width: bounds.width,
          x: bounds.x,
          y: bounds.y
        },
        ok: true,
        viewport: { height: window.innerHeight, width: window.innerWidth }
      })
      return false
    }
    if (message?.kind !== MESSAGE_KIND) {
      return false
    }
    if (message.contract !== 'openpencil-browser-live-surface-input/v1') {
      return false
    }
    const element = resolveSourceElement(message.source)
    if (!element) {
      sendResponse({ ok: false, reason: 'source-element-unavailable' })
      return false
    }
    const input = message.input
    let handled = false
    if (input?.kind === 'pointer') handled = relayPointer(element, input)
    if (input?.kind === 'wheel') handled = relayWheel(element, input)
    if (input?.kind === 'key') handled = relayKey(element, input)
    if (input?.kind === 'text') handled = relayText(element, input)
    sendResponse({ ok: handled, ...(handled ? {} : { reason: 'unsupported-input' }) })
    return false
  }

  chrome.runtime.onMessage.addListener(receive)
  globalThis[RELAY_KEY] = {
    dispose() {
      chrome.runtime.onMessage.removeListener(receive)
    }
  }
})()
