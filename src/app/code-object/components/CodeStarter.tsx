import type { CSSProperties } from 'react'

import type { CodeStarterState } from '../model'

type CodeStarterProps = {
  interactionEnabled: boolean
  onStateChange: (state: CodeStarterState) => void
  state: CodeStarterState
}

const shellStyle: CSSProperties = {
  alignItems: 'stretch',
  background:
    'radial-gradient(circle at 18% 10%, rgba(122, 92, 255, 0.2), transparent 34%), #111217',
  boxSizing: 'border-box',
  color: '#f7f7fb',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  gap: 22,
  height: '100%',
  justifyContent: 'space-between',
  padding: 32,
  width: '100%'
}

const actionStyle: CSSProperties = {
  background: '#b8a9ff',
  border: 0,
  borderRadius: 10,
  color: '#19171f',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 700,
  padding: '13px 18px'
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.055)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 18
      }}
    >
      <span style={{ color: '#9395a1', fontSize: 11, fontWeight: 700, letterSpacing: 1.2 }}>
        {label}
      </span>
      <strong style={{ fontSize: 28, letterSpacing: -0.8 }}>{value}</strong>
    </div>
  )
}

export function CodeStarter({ interactionEnabled, onStateChange, state }: CodeStarterProps) {
  function increase() {
    if (!interactionEnabled) return
    onStateChange({ ...state, count: state.count + 1 })
  }

  return (
    <main data-test-id="code-starter" style={shellStyle}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ color: '#b8a9ff', fontSize: 11, fontWeight: 800, letterSpacing: 1.6 }}>
          OPENPENCIL CODE OBJECT
        </span>
        <h1 style={{ fontSize: 30, letterSpacing: -1, margin: 0 }}>{state.title}</h1>
        <p style={{ color: '#a7a8b2', fontSize: 14, lineHeight: 1.55, margin: 0 }}>
          One TSX component, one ReactDOM runtime, one ordinary board frame.
        </p>
      </header>

      <section style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        <Metric label="PERSISTED COUNT" value={String(state.count)} />
        <Metric label="BOARD MODE" value={interactionEnabled ? 'Interact' : 'Design'} />
      </section>

      <button
        data-test-id="code-starter-increase"
        disabled={!interactionEnabled}
        onClick={increase}
        style={{ ...actionStyle, opacity: interactionEnabled ? 1 : 0.55 }}
        type="button"
      >
        {interactionEnabled ? 'Increase count' : 'Enter to interact'}
      </button>
    </main>
  )
}
