import { useEffect, useRef, useState } from 'react'

import type { ResolvedCodeObjectAppearance } from '@open-pencil/core/code-object'

import type { SignalBloomState } from '../model'

type SignalBloomProps = {
  appearance: ResolvedCodeObjectAppearance
  onStateChange: (state: SignalBloomState) => void
  state: SignalBloomState
}

type DragState = {
  hue: number
  pointerId: number
  spread: number
  x: number
  y: number
}

const PETALS = Array.from({ length: 20 }, (_, index) => ({
  angle: index * 18,
  length: 76 + (index % 5) * 13,
  width: 13 + (index % 3) * 4
}))

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizedHue(value: number) {
  return ((Math.round(value) % 360) + 360) % 360
}

export function SignalBloom({ appearance, onStateChange, state }: SignalBloomProps) {
  const bloomRef = useRef<SVGGElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const currentRef = useRef(state)
  const onStateChangeRef = useRef(onStateChange)
  const [viewState, setViewState] = useState(state)
  const { theme, tokens } = appearance

  useEffect(() => {
    onStateChangeRef.current = onStateChange
  }, [onStateChange])

  useEffect(() => {
    if (dragRef.current) return
    currentRef.current = state
    setViewState(state)
  }, [state])

  useEffect(() => {
    let frame = 0
    const startedAt = performance.now()
    function animate(time: number) {
      const current = currentRef.current
      const rotation = current.frozen ? 0 : (time - startedAt) * 0.005
      const breath = current.frozen ? 1 : 1 + Math.sin((time - startedAt) / 900) * 0.025
      bloomRef.current?.setAttribute(
        'transform',
        `translate(320 324) rotate(${rotation}) scale(${breath})`
      )
      frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frame)
  }, [])

  function preview(next: SignalBloomState) {
    currentRef.current = next
    setViewState(next)
  }

  function beginDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      hue: currentRef.current.hue,
      pointerId: event.pointerId,
      spread: currentRef.current.spread,
      x: event.clientX,
      y: event.clientY
    }
  }

  function moveDrag(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    preview({
      frozen: false,
      hue: normalizedHue(drag.hue + (event.clientX - drag.x) * 0.75),
      spread: clamp(drag.spread - (event.clientY - drag.y) * 0.0035, 0.55, 1.45)
    })
  }

  function endDrag(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    onStateChangeRef.current(currentRef.current)
  }

  function toggleFrozen() {
    const next = { ...currentRef.current, frozen: !currentRef.current.frozen }
    preview(next)
    onStateChangeRef.current(next)
  }

  return (
    <main
      className="relative size-full select-none overflow-hidden font-sans"
      data-test-id="code-object-signal-bloom"
      style={{ color: tokens.text }}
    >
      <div
        className="pointer-events-none absolute inset-[10%] rounded-full blur-3xl"
        style={{
          background: `radial-gradient(circle, hsla(${viewState.hue}, 88%, 63%, 0.17), transparent 66%)`
        }}
      />

      <svg
        aria-label="Responsive signal bloom. Drag to change color and spread."
        className="absolute inset-0 size-full cursor-grab touch-none overflow-visible active:cursor-grabbing"
        data-test-id="code-object-bloom-field"
        viewBox="0 0 640 640"
        onPointerCancel={endDrag}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      >
        <defs>
          <radialGradient id="bloom-core">
            <stop offset="0" stopColor="#fff7d6" />
            <stop offset="0.26" stopColor={`hsl(${viewState.hue + 42} 96% 72%)`} />
            <stop offset="1" stopColor={`hsl(${viewState.hue} 76% 37%)`} />
          </radialGradient>
          <filter id="bloom-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="14" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g ref={bloomRef}>
          {PETALS.map((petal, index) => {
            const hue = normalizedHue(viewState.hue + index * 5)
            const length = petal.length * viewState.spread
            return (
              <g key={petal.angle} transform={`rotate(${petal.angle})`}>
                <ellipse
                  cx="0"
                  cy={-68 - length / 2}
                  fill={`hsl(${hue} 88% ${58 + (index % 4) * 5}%)`}
                  opacity={0.28 + (index % 5) * 0.09}
                  rx={petal.width}
                  ry={length / 2}
                  transform={`rotate(${index % 2 === 0 ? -5 : 5})`}
                />
                <circle
                  cx="0"
                  cy={-92 - length}
                  fill={`hsl(${hue + 36} 96% 76%)`}
                  opacity="0.72"
                  r={1.5 + (index % 3) * 0.7}
                />
              </g>
            )
          })}
          <circle
            fill={`hsl(${viewState.hue} 88% 58%)`}
            opacity="0.2"
            r="76"
            filter="url(#bloom-glow)"
          />
          <circle
            fill="none"
            r="62"
            stroke="#fff8e7"
            strokeDasharray="1 8"
            strokeLinecap="round"
            strokeOpacity="0.24"
            strokeWidth="2"
          />
          <circle fill="url(#bloom-core)" r="43" />
          <circle cx="-12" cy="-15" fill="#fffceb" opacity="0.8" r="6" />
        </g>
      </svg>

      <header className="pointer-events-none absolute top-8 left-9">
        <div
          className="flex items-center gap-2 text-[9px] font-semibold tracking-[0.22em] uppercase"
          style={{ color: tokens.textMuted }}
        >
          <span
            className="size-1.5 rounded-full"
            style={{
              backgroundColor: `hsl(${viewState.hue} 92% 70%)`,
              boxShadow: `0 0 14px hsla(${viewState.hue}, 92%, 70%, 0.9)`
            }}
          />
          Resonance · open
        </div>
        <h1 className="mt-2 text-[26px] leading-none font-medium tracking-[-0.04em]">
          Signal bloom
        </h1>
      </header>

      <div className="pointer-events-none absolute bottom-8 left-9 flex items-end gap-5">
        <div>
          <div
            className="text-[8px] font-semibold tracking-[0.2em] uppercase"
            style={{ color: tokens.textMuted }}
          >
            Spectrum
          </div>
          <div
            className="mt-1 font-mono text-[22px] tracking-[-0.04em]"
            data-test-id="code-object-bloom-hue"
            style={{ color: `hsl(${viewState.hue} 82% ${theme === 'dark' ? 72 : 38}%)` }}
          >
            {String(viewState.hue).padStart(3, '0')}°
          </div>
        </div>
        <span className="mb-1 h-7 w-px" style={{ background: tokens.border }} />
        <div
          className="mb-1 text-[8px] font-semibold leading-4 tracking-[0.15em] uppercase"
          style={{ color: tokens.textMuted }}
        >
          Drag to tune
          <br />
          Lift to commit
        </div>
      </div>

      <button
        type="button"
        aria-pressed={viewState.frozen}
        className="absolute top-8 right-9 z-10 flex h-8 items-center gap-2 rounded-full border px-3 text-[9px] font-medium backdrop-blur-md transition"
        data-test-id="code-object-bloom-toggle"
        onClick={toggleFrozen}
        style={{
          background: tokens.surface,
          borderColor: tokens.border,
          boxShadow: tokens.shadow,
          color: tokens.textMuted
        }}
      >
        <span
          className="size-1.5 rounded-full"
          style={{
            backgroundColor: viewState.frozen ? tokens.textMuted : `hsl(${viewState.hue} 92% 70%)`
          }}
        />
        {viewState.frozen ? 'Release bloom' : 'Hold bloom'}
      </button>
    </main>
  )
}
