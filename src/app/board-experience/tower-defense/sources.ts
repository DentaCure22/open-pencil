export const TOWER_DEFENSE_LANE_SOURCE = `
type LaneProps = {
  props: { title?: string }
}

export default function DefenseLane({ props }: LaneProps) {
  return (
    <main
      style={{
        boxSizing: 'border-box',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 28,
        background: 'linear-gradient(145deg, #111827, #0f172a)',
        border: '1px solid #334155',
        fontFamily: 'Inter, ui-sans-serif, system-ui'
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 1120 500" aria-label="Defense route">
        <defs>
          <linearGradient id="lane" x1="0" x2="1">
            <stop offset="0" stopColor="#475569" />
            <stop offset="1" stopColor="#64748b" />
          </linearGradient>
        </defs>
        <path
          d="M 40 105 H 315 V 360 H 650 V 155 H 1060"
          fill="none"
          stroke="#0f172a"
          strokeWidth="82"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M 40 105 H 315 V 360 H 650 V 155 H 1060"
          fill="none"
          stroke="url(#lane)"
          strokeWidth="60"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M 40 105 H 315 V 360 H 650 V 155 H 1060"
          fill="none"
          stroke="#94a3b8"
          strokeWidth="2"
          strokeDasharray="16 14"
        />
        <text x="32" y="56" fill="#e2e8f0" fontSize="20" fontWeight="700">
          {props.title ?? 'Defense lane'}
        </text>
        <text x="32" y="80" fill="#64748b" fontSize="12">
          Select, move, resize, duplicate, or replace this component.
        </text>
      </svg>
    </main>
  )
}
`.trim()

export const TOWER_DEFENSE_CONTROLS_SOURCE = `
type ControlState = {
  enemyCount?: number
  exitRequests?: number
  gold?: number
  lives?: number
  pulseRequests?: number
  rangeRequests?: number
  resetRequests?: number
  running?: boolean
  score?: number
}

type ControlsProps = {
  interactionEnabled: boolean
  setState: (next: ControlState) => void
  state: ControlState
}

function value(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ minWidth: 54 }}>
      <div style={{ color: '#64748b', fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase' }}>
        {label}
      </div>
      <strong style={{ color: '#f8fafc', fontSize: 17 }}>{value}</strong>
    </div>
  )
}

export default function TowerDefenseControls({
  interactionEnabled,
  setState,
  state
}: ControlsProps) {
  const running = state.running === true
  const gold = value(state.gold, 140)
  const update = (patch: Partial<ControlState>) => setState({ ...state, ...patch })
  const button = {
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '7px 11px',
    background: '#1e293b',
    color: '#f8fafc',
    cursor: interactionEnabled ? 'pointer' : 'default',
    fontSize: 11,
    fontWeight: 700
  }
  return (
    <main
      style={{
        boxSizing: 'border-box',
        width: '100%',
        height: '100%',
        padding: 14,
        borderRadius: 18,
        border: '1px solid #334155',
        background: '#0f172af5',
        color: '#f8fafc',
        fontFamily: 'Inter, ui-sans-serif, system-ui'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ minWidth: 138 }}>
          <div style={{ color: '#34d399', fontSize: 11, fontWeight: 800 }}>TOWER DEFENSE</div>
          <div style={{ color: '#94a3b8', fontSize: 10 }}>
            {interactionEnabled ? 'Controls are live' : 'Enter to interact'}
          </div>
        </div>
        <Metric label="Gold" value={gold} />
        <Metric label="Lives" value={value(state.lives, 12)} />
        <Metric label="Score" value={value(state.score)} />
        <Metric label="Enemies" value={value(state.enemyCount)} />
      </div>
      <div style={{ display: 'flex', gap: 7, marginTop: 11 }}>
        <button
          disabled={!interactionEnabled}
          onClick={() => update({ running: !running })}
          style={{ ...button, background: running ? '#7c3aed' : '#2563eb' }}
        >
          {running ? 'Pause wave' : 'Start wave'}
        </button>
        <button
          disabled={!interactionEnabled || gold < 45}
          onClick={() => update({ pulseRequests: value(state.pulseRequests) + 1 })}
          style={button}
        >
          Add pulse · 45g
        </button>
        <button
          disabled={!interactionEnabled || gold < 70}
          onClick={() => update({ rangeRequests: value(state.rangeRequests) + 1 })}
          style={button}
        >
          Add range · 70g
        </button>
        <button
          disabled={!interactionEnabled}
          onClick={() => update({ resetRequests: value(state.resetRequests) + 1 })}
          style={button}
        >
          Reset
        </button>
        <button
          disabled={!interactionEnabled}
          onClick={() => update({ exitRequests: value(state.exitRequests) + 1 })}
          style={{ ...button, marginLeft: 'auto', color: '#cbd5e1' }}
        >
          Exit
        </button>
      </div>
    </main>
  )
}
`.trim()

export const TOWER_DEFENSE_TOWER_SOURCE = `
type TowerState = {
  firing?: boolean
  kind?: 'pulse' | 'range'
}

type TowerProps = {
  state: TowerState
}

export default function DefenseTower({ state }: TowerProps) {
  const range = state.kind === 'range'
  const color = range ? '#2dd4bf' : '#a78bfa'
  return (
    <main
      style={{
        boxSizing: 'border-box',
        display: 'grid',
        width: '100%',
        height: '100%',
        placeItems: 'center',
        overflow: 'hidden',
        borderRadius: range ? '50%' : 18,
        border: '2px solid ' + color,
        background: 'radial-gradient(circle at 35% 28%, ' + color + ', #111827 68%)',
        boxShadow: state.firing ? '0 0 0 7px ' + color + '55, 0 0 28px ' + color : '0 10px 24px #02061766',
        color: '#f8fafc',
        fontFamily: 'Inter, ui-sans-serif, system-ui'
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>{range ? 'R' : 'P'}</div>
        <div style={{ fontSize: 8, letterSpacing: 1, textTransform: 'uppercase' }}>
          {range ? 'Range' : 'Pulse'}
        </div>
      </div>
    </main>
  )
}
`.trim()

export const TOWER_DEFENSE_ENEMY_SOURCE = `
type EnemyState = {
  health?: number
  maxHealth?: number
}

type EnemyProps = {
  interactionEnabled: boolean
  setState: (next: EnemyState) => void
  state: EnemyState
}

function health(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback
}

export default function DefenseEnemy({ interactionEnabled, setState, state }: EnemyProps) {
  const maximum = health(state.maxHealth, 8)
  const current = health(state.health, maximum)
  const ratio = maximum <= 0 ? 0 : current / maximum
  const color = ratio > 0.55 ? '#fb7185' : ratio > 0.25 ? '#f59e0b' : '#ef4444'
  return (
    <button
      type="button"
      aria-label="Damage enemy"
      disabled={!interactionEnabled}
      onClick={() => setState({ ...state, health: Math.max(0, current - 1) })}
      style={{
        boxSizing: 'border-box',
        display: 'grid',
        width: '100%',
        height: '100%',
        placeItems: 'center',
        borderRadius: '50%',
        border: '2px solid #fff',
        background: color,
        boxShadow: interactionEnabled ? '0 0 0 5px #ffffff33' : '0 6px 14px #02061788',
        color: '#fff',
        cursor: interactionEnabled ? 'crosshair' : 'default',
        fontSize: 11,
        fontWeight: 900
      }}
    >
      {current}
    </button>
  )
}
`.trim()
