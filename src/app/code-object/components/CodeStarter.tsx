import type { CSSProperties } from 'react'

import type {
  ResolvedCodeObjectAppearance,
  CodeObjectThemeTokens
} from '@open-pencil/core/code-object'

import type { CodeStarterState } from '../model'

type CodeStarterProps = {
  appearance: ResolvedCodeObjectAppearance
  interactionEnabled: boolean
  onStateChange: (state: CodeStarterState) => void
  state: CodeStarterState
}

const shellStyle: CSSProperties = {
  alignItems: 'stretch',
  boxSizing: 'border-box',
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
  border: 0,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 700,
  padding: '13px 18px'
}

function Metric({
  label,
  tokens,
  value
}: {
  label: string
  tokens: CodeObjectThemeTokens
  value: string
}) {
  return (
    <div
      style={{
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 18
      }}
    >
      <span style={{ color: tokens.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2 }}>
        {label}
      </span>
      <strong style={{ fontSize: 28, letterSpacing: -0.8 }}>{value}</strong>
    </div>
  )
}

export function CodeStarter({
  appearance,
  interactionEnabled,
  onStateChange,
  state
}: CodeStarterProps) {
  const { theme, tokens } = appearance
  function increase() {
    if (!interactionEnabled) return
    onStateChange({ ...state, count: state.count + 1 })
  }

  return (
    <main
      data-test-id="code-starter"
      style={{
        ...shellStyle,
        background: `radial-gradient(circle at 18% 10%, ${tokens.focusRing}, transparent 34%), ${tokens.background}`,
        color: tokens.text
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ color: tokens.accent, fontSize: 11, fontWeight: 800, letterSpacing: 1.6 }}>
          OPENPENCIL CODE OBJECT
        </span>
        <h1 style={{ fontSize: 30, letterSpacing: -1, margin: 0 }}>{state.title}</h1>
        <p style={{ color: tokens.textMuted, fontSize: 14, lineHeight: 1.55, margin: 0 }}>
          One TSX component, one ReactDOM runtime, one ordinary board frame · {theme}.
        </p>
      </header>

      <section style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        <Metric label="PERSISTED COUNT" tokens={tokens} value={String(state.count)} />
        <Metric
          label="BOARD MODE"
          tokens={tokens}
          value={interactionEnabled ? 'Interact' : 'Design'}
        />
      </section>

      <button
        data-test-id="code-starter-increase"
        disabled={!interactionEnabled}
        onClick={increase}
        style={{
          ...actionStyle,
          background: tokens.accent,
          borderRadius: tokens.radius,
          color: tokens.accentText,
          opacity: interactionEnabled ? 1 : 0.55
        }}
        type="button"
      >
        {interactionEnabled ? 'Increase count' : 'Enter to interact'}
      </button>
    </main>
  )
}
