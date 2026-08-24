import { onUnmounted, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

export function prefersStreamedTextMotion(): boolean {
  return typeof matchMedia !== 'function' || !matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function alignStreamedText(displayed: string, incoming: string): {
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
  from: number
  incoming: number
  reduceMotion?: boolean
}): number {
  if (input.reduceMotion || input.incoming <= input.displayed) return input.incoming
  const span = Math.max(1, input.incoming - input.from)
  const duration = span > 96 ? 150 : span > 36 ? 210 : 280
  const t = Math.min(1, Math.max(0, input.elapsedMs) / duration)
  const eased = 1 - (1 - t) ** 3
  const easedLength = input.from + Math.ceil(span * eased)
  const step = input.displayed + (span > 96 ? 14 : span > 36 ? 6 : 3)
  return Math.min(input.incoming, Math.max(easedLength, step))
}

export function sliceStreamedText(value: string, length: number): string {
  if (length >= value.length) return value
  if (length <= 0) return ''
  const cut = value.slice(0, length)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) return cut.slice(0, -1)
  return cut
}

export function useStreamedText(
  content: MaybeRefOrGetter<string>,
  streaming: MaybeRefOrGetter<boolean>
): Ref<string> {
  const displayed = ref(toValue(content))
  let from = displayed.value.length
  let incoming = displayed.value
  let startedAt = 0
  let frame = 0

  function stop() {
    if (!frame) return
    cancelAnimationFrame(frame)
    frame = 0
  }

  function paint(now: number) {
    frame = 0
    const live = toValue(streaming)
    const next = toValue(content)
    if (!live || !prefersStreamedTextMotion()) {
      displayed.value = next
      incoming = next
      from = next.length
      return
    }
    if (next !== incoming) {
      const aligned = alignStreamedText(displayed.value, next)
      displayed.value = aligned.displayed
      incoming = aligned.incoming
      from = aligned.from
      startedAt = now
      if (aligned.snap) return
    }
    if (displayed.value.length >= incoming.length) {
      displayed.value = incoming
      return
    }
    displayed.value = sliceStreamedText(
      incoming,
      nextStreamedLength({
        displayed: displayed.value.length,
        elapsedMs: now - startedAt,
        from,
        incoming: incoming.length
      })
    )
    if (displayed.value.length < incoming.length) frame = requestAnimationFrame(paint)
  }

  watch(
    () => [toValue(content), toValue(streaming)] as const,
    () => {
      if (!toValue(streaming) || !prefersStreamedTextMotion()) {
        stop()
        displayed.value = toValue(content)
        incoming = displayed.value
        from = displayed.value.length
        return
      }
      if (!frame) frame = requestAnimationFrame(paint)
    },
    { immediate: true }
  )

  onUnmounted(stop)
  return displayed
}
