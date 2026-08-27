import {
  CODE_OBJECT_SCHEMA_VERSION,
  createUserCodeObjectDocument as createPersistedUserCodeObjectDocument,
  type CodeObjectAgentPresetId,
  type CodeObjectAppearance,
  type CodeObjectDocument as CoreCodeObjectDocument,
  type CodeObjectModality,
  type CodeObjectSurface
} from '@open-pencil/core/code-object'
import { randomHex } from '@open-pencil/core/random'

import type { CodeObjectBoardPermission } from './contracts'
import {
  CODE_STARTER_SOURCE,
  EARTH_SIGNALS_SOURCE,
  ORBIT_LAB_SOURCE,
  SIGNAL_BLOOM_SOURCE
} from './saved-sources'

export type EarthSignalsState = {
  autoRotate: boolean
  latitude: number
  longitude: number
}

export type OrbitLabState = {
  energy: number
  paused: boolean
  tilt: number
}

export type SignalBloomState = {
  frozen: boolean
  hue: number
  spread: number
}

export type CodeStarterState = {
  count: number
  title: string
}

export type UserCodeObjectProps = Record<string, unknown>
export type UserCodeObjectState = Record<string, unknown>

export type EarthSignalsDocument = CoreCodeObjectDocument<
  'earth-signals',
  EarthSignalsState,
  CodeObjectBoardPermission
>
export type OrbitLabDocument = CoreCodeObjectDocument<
  'orbit-lab',
  OrbitLabState,
  CodeObjectBoardPermission
>
export type SignalBloomDocument = CoreCodeObjectDocument<
  'signal-bloom',
  SignalBloomState,
  CodeObjectBoardPermission
>
export type CodeStarterDocument = CoreCodeObjectDocument<
  'code-starter',
  CodeStarterState,
  CodeObjectBoardPermission
>
export type UserCodeObjectDocument = CoreCodeObjectDocument<
  'user-code',
  UserCodeObjectState,
  CodeObjectBoardPermission
>

const DEFAULT_EARTH_SIGNALS_STATE: EarthSignalsState = {
  autoRotate: true,
  latitude: 12,
  longitude: -32
}

const DEFAULT_ORBIT_LAB_STATE: OrbitLabState = {
  energy: 1.12,
  paused: false,
  tilt: -14
}

const DEFAULT_SIGNAL_BLOOM_STATE: SignalBloomState = {
  frozen: false,
  hue: 268,
  spread: 1
}

const DEFAULT_CODE_STARTER_STATE: CodeStarterState = {
  count: 0,
  title: 'A living object on the board'
}

export const DEFAULT_CODE_OBJECT_SOURCE = `import { useMemo } from 'react'

type CodeObjectProps = {
  appearance: { theme: 'dark' | 'light'; tokens: Record<string, string> }
  interactionEnabled: boolean
  props: { title?: string }
  setState: (next: { count: number }) => void
  state: { count: number }
}

function Metric({ label, tokens, value }: { label: string; tokens: Record<string, string>; value: number }) {
  return (
    <div style={{ border: \`1px solid \${tokens.border}\`, borderRadius: tokens.radius, background: tokens.surface, padding: 16 }}>
      <div style={{ color: tokens.textMuted, fontSize: 12 }}>{label}</div>
      <div style={{ color: tokens.text, fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

export default function CodeObject({
  appearance,
  interactionEnabled,
  props,
  setState,
  state
}: CodeObjectProps) {
  const { tokens } = appearance
  const doubled = useMemo(() => state.count * 2, [state.count])
  const nextCount = state.count + 1
  const actionStyle = {
    border: 0,
    borderRadius: tokens.radius,
    padding: '10px 16px',
    background: interactionEnabled ? tokens.accent : tokens.textMuted,
    color: tokens.accentText,
    cursor: interactionEnabled ? 'pointer' : 'default',
    fontWeight: 700
  }
  return (
    <main
      style={{
        boxSizing: 'border-box',
        minHeight: '100%',
        padding: 28,
        color: tokens.text,
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        background: tokens.background
      }}
    >
      <p style={{ margin: 0, color: tokens.accent, fontSize: 12, fontWeight: 700 }}>
        OPENPENCIL CODE OBJECT
      </p>
      <h1 style={{ margin: '10px 0 20px', fontSize: 30 }}>
        {props.title ?? 'One TSX object'}
      </h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Metric label="Count" tokens={tokens} value={state.count} />
        <Metric label="Doubled" tokens={tokens} value={doubled} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
        <button
          disabled={!interactionEnabled}
          onClick={() => setState({ count: nextCount })}
          style={actionStyle}
        >
          {interactionEnabled ? 'Increment' : 'Enter to interact'}
        </button>
      </div>
    </main>
  )
}`

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function stringValue(value: unknown, fallback: string, maximum = 80) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : fallback
}

export function createEarthSignalsDocument(): EarthSignalsDocument {
  return {
    boardPermissions: [],
    component: 'earth-signals',
    definitionId: 'openpencil.earth-signals',
    modality: 'visual-experience',
    name: 'Earth signals',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: EARTH_SIGNALS_SOURCE,
    state: { ...DEFAULT_EARTH_SIGNALS_STATE }
  }
}

export function createCodeStarterDocument(): CodeStarterDocument {
  return {
    boardPermissions: [],
    component: 'code-starter',
    definitionId: 'openpencil.code-starter',
    modality: 'custom',
    name: 'Code starter',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: CODE_STARTER_SOURCE,
    state: { ...DEFAULT_CODE_STARTER_STATE }
  }
}

export function createUserCodeObjectDocument(
  input: {
    appearance?: CodeObjectAppearance
    boardPermissions?: CodeObjectBoardPermission[]
    definitionId?: string
    modality?: CodeObjectModality
    name?: string
    presetId?: CodeObjectAgentPresetId
    props?: UserCodeObjectProps
    source?: string
    state?: UserCodeObjectState
    surface?: CodeObjectSurface
  } = {}
): UserCodeObjectDocument {
  return createPersistedUserCodeObjectDocument({
    appearance: input.appearance,
    boardPermissions: input.boardPermissions,
    definitionId: input.definitionId?.trim() || `code-${randomHex(8)}`,
    modality: input.modality,
    name: input.name?.trim() || 'Code Object',
    presetId: input.presetId,
    props: input.props ?? { title: 'One TSX object' },
    source: input.source?.trim() || DEFAULT_CODE_OBJECT_SOURCE,
    state: input.state ?? { count: 0 },
    surface: input.surface
  })
}

export function createOrbitLabDocument(): OrbitLabDocument {
  return {
    boardPermissions: [],
    component: 'orbit-lab',
    definitionId: 'openpencil.orbit-lab',
    modality: 'visual-experience',
    name: 'Orbit lab',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: ORBIT_LAB_SOURCE,
    state: { ...DEFAULT_ORBIT_LAB_STATE }
  }
}

export function createSignalBloomDocument(): SignalBloomDocument {
  return {
    boardPermissions: [],
    component: 'signal-bloom',
    definitionId: 'openpencil.signal-bloom',
    modality: 'visual-experience',
    name: 'Signal bloom',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: SIGNAL_BLOOM_SOURCE,
    state: { ...DEFAULT_SIGNAL_BLOOM_STATE }
  }
}

export function normalizeEarthSignalsState(state: Record<string, unknown>): EarthSignalsState {
  return {
    autoRotate: state.autoRotate !== false,
    latitude: clamp(finiteNumber(state.latitude, DEFAULT_EARTH_SIGNALS_STATE.latitude), -70, 70),
    longitude:
      ((((finiteNumber(state.longitude, DEFAULT_EARTH_SIGNALS_STATE.longitude) + 180) % 360) +
        360) %
        360) -
      180
  }
}

export function normalizeOrbitLabState(state: Record<string, unknown>): OrbitLabState {
  return {
    energy: clamp(finiteNumber(state.energy, DEFAULT_ORBIT_LAB_STATE.energy), 0.35, 2.4),
    paused: state.paused === true,
    tilt: clamp(finiteNumber(state.tilt, DEFAULT_ORBIT_LAB_STATE.tilt), -36, 36)
  }
}

export function normalizeSignalBloomState(state: Record<string, unknown>): SignalBloomState {
  const hue = finiteNumber(state.hue, DEFAULT_SIGNAL_BLOOM_STATE.hue)
  return {
    frozen: state.frozen === true,
    hue: ((Math.round(hue) % 360) + 360) % 360,
    spread: clamp(finiteNumber(state.spread, DEFAULT_SIGNAL_BLOOM_STATE.spread), 0.55, 1.45)
  }
}

export function normalizeCodeStarterState(state: Record<string, unknown>): CodeStarterState {
  return {
    count: Math.max(0, Math.round(finiteNumber(state.count, DEFAULT_CODE_STARTER_STATE.count))),
    title: stringValue(state.title, DEFAULT_CODE_STARTER_STATE.title, 120)
  }
}
