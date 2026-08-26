import { onUnmounted, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

const INITIAL_ANIMATED_TAIL_LENGTH = 18
const IDEAL_STREAM_FRAME_MS = 1_000 / 60
const MAX_STREAM_FRAME_MS = 40

export function prefersStreamedTextMotion(): boolean {
  return typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function alignStreamedText(
  displayed: string,
  incoming: string
): {
  displayed: string
  from: number
  incoming: string
  snap: boolean
} {
  if (incoming === displayed) {
    return { displayed, from: displayed.length, incoming, snap: true }
  }
  if (incoming.startsWith(displayed)) {
    return { displayed, from: displayed.length, incoming, snap: false }
  }
  return { displayed: incoming, from: incoming.length, incoming, snap: true }
}

export function nextStreamedLength(input: {
  displayed: number
  elapsedMs: number
  finishing?: boolean
  incoming: number
  reduceMotion?: boolean
}): number {
  if (input.reduceMotion || input.incoming <= input.displayed) return input.incoming
  const backlog = input.incoming - input.displayed
  const elapsed = Math.min(MAX_STREAM_FRAME_MS, Math.max(1, input.elapsedMs))
  // Pi's live transcript arrives every ~80 ms. A three-character minimum step
  // drains each update in a short burst, then visibly pauses until the next
  // poll. Keep the reveal velocity continuous instead: one glyph on an ordinary
  // frame, with a bounded catch-up rate only when the queue grows.
  const baseRate = input.finishing ? 110 : 42
  const backlogRate = backlog * (input.finishing ? 5 : 2.6)
  const maximumRate = input.finishing ? 360 : 240
  const charactersPerSecond = Math.min(maximumRate, baseRate + backlogRate)
  const step = Math.max(1, Math.ceil((charactersPerSecond * elapsed) / 1_000))
  return Math.min(input.incoming, input.displayed + step)
}

export function sliceStreamedText(value: string, length: number): string {
  if (length >= value.length) return value
  if (length <= 0) return ''
  const cut = value.slice(0, length)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) return cut.slice(0, -1)
  return cut
}

export type StreamedTextTailSegment = {
  glyphs?: Array<{ key: string; value: string }>
  key: string
  value?: string
}

export function splitStreamedTextTail(
  value: string,
  maximumTailLength = 24
): { stable: string; tail: StreamedTextTailSegment[] } {
  const glyphs = Array.from(value)
  if (!glyphs.length) return { stable: '', tail: [] }
  let start = Math.max(0, glyphs.length - maximumTailLength)
  // Start the animated tail at a word boundary when it is nearby. Keeping each
  // word in one nowrap wrapper preserves ordinary browser line wrapping while
  // the individual glyphs fade in.
  const earliest = Math.max(0, start - 12)
  while (start > earliest && start > 0 && !/\s/u.test(glyphs[start - 1] ?? '')) start -= 1

  const stableGlyphs = glyphs.slice(0, start)
  const stable = stableGlyphs.join('')
  let codeUnitOffset = stable.length
  const tail: StreamedTextTailSegment[] = []
  let word: Array<{ key: string; value: string }> = []

  function flushWord() {
    if (!word.length) return
    tail.push({ glyphs: word, key: `word-${word[0]?.key ?? '0'}` })
    word = []
  }

  for (const glyph of glyphs.slice(start)) {
    const key = String(codeUnitOffset)
    codeUnitOffset += glyph.length
    if (/\s/u.test(glyph)) {
      flushWord()
      tail.push({ key: `space-${key}`, value: glyph })
      continue
    }
    word.push({ key: `glyph-${key}-${glyph}`, value: glyph })
  }
  flushWord()
  return { stable, tail }
}

function initialStreamedText(value: string): string {
  return sliceStreamedText(value, Math.max(0, value.length - INITIAL_ANIMATED_TAIL_LENGTH))
}

export function useStreamedText(
  content: MaybeRefOrGetter<string>,
  streaming: MaybeRefOrGetter<boolean>,
  options: { animateRewrites?: MaybeRefOrGetter<boolean> } = {}
): Ref<string> {
  const initial = toValue(content)
  const animateInitial = toValue(streaming) && prefersStreamedTextMotion()
  const displayed = ref(animateInitial ? initialStreamedText(initial) : initial)
  let incoming = initial
  let frame = 0
  let previousFrameAt = 0

  function stop() {
    if (!frame) return
    cancelAnimationFrame(frame)
    frame = 0
    previousFrameAt = 0
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(paint)
  }

  function alignIncoming(next: string): boolean {
    if (next === incoming) return true
    if (next.startsWith(displayed.value)) {
      incoming = next
      return true
    }
    if (
      toValue(streaming) &&
      toValue(options.animateRewrites ?? false) &&
      prefersStreamedTextMotion()
    ) {
      displayed.value = initialStreamedText(next)
      incoming = next
      previousFrameAt = 0
      return true
    }
    displayed.value = next
    incoming = next
    previousFrameAt = 0
    return false
  }

  function paint(now: number) {
    frame = 0
    const live = toValue(streaming)
    const next = toValue(content)
    if (!prefersStreamedTextMotion()) {
      displayed.value = next
      incoming = next
      previousFrameAt = 0
      return
    }
    if (!alignIncoming(next)) return
    if (displayed.value.length >= incoming.length) {
      displayed.value = incoming
      previousFrameAt = 0
      return
    }
    const elapsedMs = previousFrameAt ? now - previousFrameAt : IDEAL_STREAM_FRAME_MS
    previousFrameAt = now
    displayed.value = sliceStreamedText(
      incoming,
      nextStreamedLength({
        displayed: displayed.value.length,
        elapsedMs,
        finishing: !live,
        incoming: incoming.length
      })
    )
    if (displayed.value.length < incoming.length) schedule()
    else previousFrameAt = 0
  }

  watch(
    () => [toValue(content), toValue(streaming)] as const,
    () => {
      if (!prefersStreamedTextMotion()) {
        stop()
        displayed.value = toValue(content)
        incoming = displayed.value
        return
      }
      if (!alignIncoming(toValue(content))) return
      if (displayed.value.length < incoming.length) schedule()
    },
    { immediate: true }
  )

  onUnmounted(stop)
  return displayed
}
