import { useEffect, useRef, useState } from 'react'

import type { OrbitLabState } from '../model'

type OrbitLabProps = {
  onStateChange: (state: OrbitLabState) => void
  state: OrbitLabState
}

type DragState = {
  energy: number
  pointerId: number
  tilt: number
  x: number
  y: number
}

const PARTICLES = Array.from({ length: 14 }, (_, index) => ({
  angle: index * 25.714,
  orbit: index % 3,
  radius: 1.5 + (index % 4) * 0.35
}))

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function particleColor(index: number) {
  if (index % 4 === 0) return '#ffbd72'
  if (index % 3 === 0) return '#75eee1'
  return '#c5afff'
}

export function OrbitLab({ onStateChange, state }: OrbitLabProps) {
  const orbitRef = useRef<SVGGElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const currentRef = useRef(state)
  const onStateChangeRef = useRef(onStateChange)
  const [viewState, setViewState] = useState(state)

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
      const elapsed = current.paused ? 0 : time - startedAt
      const rotation = elapsed * 0.008 * current.energy
      orbitRef.current?.setAttribute(
        'transform',
        `translate(360 304) rotate(${rotation + current.tilt * 0.22})`
      )
      frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frame)
  }, [])

  function preview(next: OrbitLabState) {
    currentRef.current = next
    setViewState(next)
  }

  function beginDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      energy: currentRef.current.energy,
      pointerId: event.pointerId,
      tilt: currentRef.current.tilt,
      x: event.clientX,
      y: event.clientY
    }
  }

  function moveDrag(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    preview({
      energy: clamp(drag.energy + (event.clientX - drag.x) * 0.006, 0.35, 2.4),
      paused: false,
      tilt: clamp(drag.tilt + (event.clientY - drag.y) * 0.18, -36, 36)
    })
  }

  function endDrag(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    onStateChangeRef.current(currentRef.current)
  }

  function togglePaused() {
    const next = { ...currentRef.current, paused: !currentRef.current.paused }
    preview(next)
    onStateChangeRef.current(next)
  }

  const energyPercent = Math.round((viewState.energy / 2.4) * 100)

  return (
    <main
      className="relative size-full select-none overflow-hidden font-sans text-[#f7f5ff]"
      data-test-id="code-object-orbit-lab"
    >
      <div className="pointer-events-none absolute inset-[12%] rounded-full bg-[radial-gradient(circle,rgba(142,104,255,0.19),rgba(32,22,64,0.11)_45%,transparent_72%)] blur-2xl" />

      <svg
        aria-label="Kinetic orbit. Drag to change energy and tilt."
        className="absolute inset-0 size-full cursor-grab touch-none overflow-visible active:cursor-grabbing"
        data-test-id="code-object-orbit-field"
        viewBox="0 0 720 600"
        onPointerCancel={endDrag}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      >
        <defs>
          <radialGradient id="orbit-core" cx="35%" cy="28%">
            <stop offset="0" stopColor="#fff6de" />
            <stop offset="0.23" stopColor="#ffbe6c" />
            <stop offset="0.68" stopColor="#a855f7" />
            <stop offset="1" stopColor="#241148" />
          </radialGradient>
          <linearGradient id="orbit-ring" x1="0" x2="1">
            <stop stopColor="#75f4e5" stopOpacity="0.08" />
            <stop offset="0.48" stopColor="#cbb9ff" stopOpacity="0.8" />
            <stop offset="1" stopColor="#ffad62" stopOpacity="0.08" />
          </linearGradient>
          <filter id="orbit-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="13" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g ref={orbitRef}>
          <ellipse
            cx="0"
            cy="0"
            fill="none"
            rx={204 + viewState.energy * 8}
            ry="72"
            stroke="url(#orbit-ring)"
            strokeWidth="1.3"
            transform={`rotate(${viewState.tilt})`}
          />
          <ellipse
            cx="0"
            cy="0"
            fill="none"
            rx="176"
            ry={58 + viewState.energy * 6}
            stroke="#a98cff"
            strokeDasharray="2 9"
            strokeLinecap="round"
            strokeOpacity="0.42"
            strokeWidth="1.7"
            transform={`rotate(${viewState.tilt + 63})`}
          />
          <ellipse
            cx="0"
            cy="0"
            fill="none"
            rx="142"
            ry="45"
            stroke="#72eadd"
            strokeDasharray="24 11"
            strokeOpacity="0.23"
            transform={`rotate(${viewState.tilt - 58})`}
          />

          {PARTICLES.map((particle, index) => {
            const angle = (particle.angle * Math.PI) / 180
            const orbitRadius = [198, 172, 140][particle.orbit] ?? 172
            const orbitHeight = [70, 58, 45][particle.orbit] ?? 58
            return (
              <circle
                key={particle.angle}
                cx={Math.cos(angle) * orbitRadius}
                cy={Math.sin(angle) * orbitHeight}
                fill={particleColor(index)}
                opacity={0.45 + (index % 5) * 0.1}
                r={particle.radius}
              />
            )
          })}

          <circle cx="0" cy="0" fill="#9f68ff" opacity="0.18" r="70" filter="url(#orbit-glow)" />
          <circle cx="0" cy="0" fill="url(#orbit-core)" r={34 + viewState.energy * 4} />
          <circle cx="-10" cy="-12" fill="#fff8df" opacity="0.75" r="5" />
        </g>
      </svg>

      <header className="pointer-events-none absolute top-8 left-9">
        <div className="flex items-center gap-2 text-[9px] font-semibold tracking-[0.22em] text-[#bca7ff] uppercase">
          <span className="size-1.5 rounded-full bg-[#bca7ff] shadow-[0_0_14px_rgba(188,167,255,0.95)]" />
          Field 07 · stable
        </div>
        <h1 className="mt-2 text-[26px] leading-none font-medium tracking-[-0.04em]">Orbit lab</h1>
      </header>

      <div className="pointer-events-none absolute bottom-8 left-9">
        <div className="text-[8px] font-semibold tracking-[0.2em] text-white/34 uppercase">
          Kinetic energy
        </div>
        <div
          className="mt-1 font-mono text-[24px] tracking-[-0.05em] text-[#ffbd72]"
          data-test-id="code-object-orbit-energy"
        >
          {energyPercent}
          <span className="ml-1 text-[9px] text-white/35">%</span>
        </div>
      </div>

      <div className="pointer-events-none absolute right-9 bottom-9 text-right text-[8px] font-semibold tracking-[0.17em] text-white/28 uppercase">
        Drag horizontal for energy
        <br />
        Drag vertical for tilt
      </div>

      <button
        type="button"
        aria-pressed={viewState.paused}
        className="absolute top-8 right-9 z-10 flex h-8 items-center gap-2 rounded-full border border-white/10 bg-[#120c21]/65 px-3 text-[9px] font-medium text-white/58 shadow-[0_8px_26px_rgba(0,0,0,0.22)] backdrop-blur-md transition hover:bg-[#1c1232]/85 hover:text-white"
        data-test-id="code-object-orbit-toggle"
        onClick={togglePaused}
      >
        <span
          className={`size-1.5 rounded-full ${viewState.paused ? 'bg-white/28' : 'bg-[#ffbd72]'}`}
        />
        {viewState.paused ? 'Resume field' : 'Hold field'}
      </button>
    </main>
  )
}
