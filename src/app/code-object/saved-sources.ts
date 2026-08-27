import { CONFIGURED_CODE_OBJECT_SOURCE } from '@open-pencil/core/code-object'

export const FINANCIAL_DASHBOARD_SOURCE = CONFIGURED_CODE_OBJECT_SOURCE

export const ANALYTICS_CHART_SOURCE = `type CodeObjectProps = {
  appearance: { theme: 'dark' | 'light'; tokens: Record<string, string> }
  interactionEnabled: boolean
  props: { title?: string }
  setState: (next: { range: '7d' | '30d' | '90d' }) => void
  state: { range: '7d' | '30d' | '90d' }
}

const SERIES = {
  '7d': [42, 55, 48, 72, 67, 88, 94],
  '30d': [38, 46, 51, 58, 64, 69, 77, 82, 91, 98],
  '90d': [26, 34, 31, 45, 52, 49, 63, 68, 74, 83, 89, 96]
} as const

function RangeButton({
  active,
  children,
  disabled,
  onClick,
  tokens
}: {
  active: boolean
  children: string
  disabled: boolean
  onClick: () => void
  tokens: Record<string, string>
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        border: 0,
        borderRadius: 999,
        padding: '7px 11px',
        background: active ? tokens.accent : tokens.surface,
        color: active ? tokens.accentText : tokens.textMuted,
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 12,
        fontWeight: 700
      }}
    >
      {children}
    </button>
  )
}

export default function AnalyticsChart({
  appearance,
  interactionEnabled,
  props,
  setState,
  state
}: CodeObjectProps) {
  const { tokens } = appearance
  const values = SERIES[state.range] ?? SERIES['30d']
  const maximum = Math.max(...values)
  return (
    <main
      data-test-id="saved-chart"
      style={{
        boxSizing: 'border-box',
        minHeight: '100%',
        padding: 28,
        color: tokens.text,
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        background: tokens.background
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ margin: 0, color: tokens.textMuted, fontSize: 11, fontWeight: 800 }}>
            CODE OBJECT PRESET
          </p>
          <h1 style={{ margin: '8px 0 4px', fontSize: 26 }}>
            {props.title ?? 'Activation trend'}
          </h1>
          <p style={{ margin: 0, color: tokens.textMuted, fontSize: 13 }}>
            Interactive chart · persisted range
          </p>
        </div>
        <strong style={{ color: tokens.accent, fontSize: 30 }}>+18.4%</strong>
      </div>
      <div
        style={{
          height: 230,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 9,
          marginTop: 28,
          padding: '18px 16px 0',
          border: \`1px solid \${tokens.border}\`,
          borderRadius: tokens.radius,
          background: tokens.surface
        }}
      >
        {values.map((value, index) => (
          <div
            key={index}
            aria-label={\`Point \${index + 1}: \${value}\`}
            style={{
              flex: 1,
              height: \`\${Math.max(8, (value / maximum) * 100)}%\`,
              borderRadius: '7px 7px 2px 2px',
              background: index === values.length - 1 ? tokens.accent : tokens.success
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        {(['7d', '30d', '90d'] as const).map((range) => (
          <RangeButton
            key={range}
            active={state.range === range}
            disabled={!interactionEnabled}
            onClick={() => setState({ range })}
            tokens={tokens}
          >
            {range}
          </RangeButton>
        ))}
      </div>
    </main>
  )
}`

export const INTERACTIVE_FORM_SOURCE = `type CodeObjectProps = {
  appearance: { theme: 'dark' | 'light'; tokens: Record<string, string> }
  interactionEnabled: boolean
  setState: (next: { email: string; name: string; status: 'draft' | 'submitted' }) => void
  state: { email: string; name: string; status: 'draft' | 'submitted' }
}

function fieldStyle(tokens: Record<string, string>) {
  return {
    boxSizing: 'border-box',
    width: '100%',
    border: \`1px solid \${tokens.border}\`,
    borderRadius: tokens.radius,
    padding: '11px 12px',
    background: tokens.surfaceElevated,
    color: tokens.text,
    fontSize: 14
  } as const
}

export default function InteractiveForm({
  appearance,
  interactionEnabled,
  setState,
  state
}: CodeObjectProps) {
  const { tokens } = appearance
  return (
    <main
      data-test-id="saved-form"
      style={{
        boxSizing: 'border-box',
        minHeight: '100%',
        padding: 30,
        color: tokens.text,
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        background: tokens.background
      }}
    >
      <p style={{ margin: 0, color: tokens.accent, fontSize: 11, fontWeight: 800 }}>
        CODE OBJECT PRESET
      </p>
      <h1 style={{ margin: '8px 0 6px', fontSize: 27 }}>Research signup</h1>
      <p style={{ margin: '0 0 24px', color: tokens.textMuted, fontSize: 13 }}>
        Form values are serializable Code Object state.
      </p>
      <label style={{ display: 'grid', gap: 7, marginBottom: 15, fontSize: 12, fontWeight: 700 }}>
        Name
        <input
          disabled={!interactionEnabled}
          value={state.name}
          onChange={(event) =>
            setState({ ...state, name: event.currentTarget.value, status: 'draft' })
          }
          style={fieldStyle(tokens)}
        />
      </label>
      <label style={{ display: 'grid', gap: 7, marginBottom: 20, fontSize: 12, fontWeight: 700 }}>
        Email
        <input
          disabled={!interactionEnabled}
          type="email"
          value={state.email}
          onChange={(event) =>
            setState({ ...state, email: event.currentTarget.value, status: 'draft' })
          }
          style={fieldStyle(tokens)}
        />
      </label>
      <button
        disabled={!interactionEnabled || !state.email.trim()}
        onClick={() => setState({ ...state, status: 'submitted' })}
        style={{
          width: '100%',
          border: 0,
          borderRadius: tokens.radius,
          padding: '12px 16px',
          background: interactionEnabled ? tokens.accent : tokens.textMuted,
          color: tokens.accentText,
          cursor: interactionEnabled ? 'pointer' : 'default',
          fontWeight: 800
        }}
      >
        {state.status === 'submitted' ? 'Submitted' : interactionEnabled ? 'Submit' : 'Enter to interact'}
      </button>
    </main>
  )
}`

export const BOARD_REMOTE_SOURCE = `type BoardShape = {
  fill: string
  height: number
  id: string
  name: string
  opacity: number
  rotation: number
  width: number
  x: number
  y: number
}

type BoardRemote = {
  permissions: string[]
  self: { height: number; width: number; x: number; y: number }
  shapes: BoardShape[]
  createShape: (shape: {
    fill: string
    height: number
    kind: 'ellipse' | 'rectangle'
    name: string
    width: number
    x: number
    y: number
  }) => Promise<{ status: 'applied' | 'denied' | 'noop' }>
  deleteShape: (shapeId: string) => Promise<{ status: 'applied' | 'denied' | 'noop' }>
  updateShape: (
    shapeId: string,
    changes: Partial<BoardShape>
  ) => Promise<{ status: 'applied' | 'denied' | 'noop' }>
}

type CodeObjectProps = {
  board: BoardRemote
  interactionEnabled: boolean
}

const palette = ['#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B']

function ControlButton({
  children,
  disabled,
  onClick,
  testId
}: {
  children: string
  disabled: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      data-test-id={testId}
      disabled={disabled}
      onClick={onClick}
      style={{
        border: '1px solid #ffffff18',
        borderRadius: 12,
        padding: '10px 13px',
        background: disabled ? '#24242c' : '#ffffff0d',
        color: disabled ? '#6f707b' : '#f5f4fb',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 12,
        fontWeight: 750,
        textAlign: 'left'
      }}
    >
      {children}
    </button>
  )
}

export default function BoardRemoteDemo({ board, interactionEnabled }: CodeObjectProps) {
  const active = board.shapes[board.shapes.length - 1]
  const hasAccess = board.permissions.includes('shape.create')
  const disabled = !interactionEnabled || !hasAccess

  async function addShape() {
    await board.createShape({
      fill: palette[board.shapes.length % palette.length],
      height: 150,
      kind: board.shapes.length % 2 === 0 ? 'rectangle' : 'ellipse',
      name: \`Remote object \${board.shapes.length + 1}\`,
      width: 210,
      x: board.self.x + board.self.width + 72 + board.shapes.length * 28,
      y: board.self.y + 70 + board.shapes.length * 28
    })
  }

  async function moveShape() {
    if (!active) return
    await board.updateShape(active.id, {
      rotation: active.rotation + 8,
      x: active.x + 72
    })
  }

  async function resizeShape() {
    if (!active) return
    const expanded = active.width > 230
    await board.updateShape(active.id, {
      height: expanded ? 150 : 190,
      width: expanded ? 210 : 300
    })
  }

  async function recolorShape() {
    if (!active) return
    const currentIndex = Math.max(0, palette.indexOf(active.fill))
    await board.updateShape(active.id, {
      fill: palette[(currentIndex + 1) % palette.length]
    })
  }

  return (
    <main
      data-test-id="board-remote-demo"
      style={{
        boxSizing: 'border-box',
        minHeight: '100%',
        padding: 28,
        color: '#f8f7fc',
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        background:
          'radial-gradient(circle at 90% 0%, #7c3aed33, transparent 38%), linear-gradient(145deg, #15151c, #20202a)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ margin: 0, color: '#a78bfa', fontSize: 11, fontWeight: 850 }}>
            SHARED BOARD AUTHORITY
          </p>
          <h1 style={{ margin: '8px 0 6px', fontSize: 28 }}>Board remote</h1>
          <p style={{ margin: 0, maxWidth: 360, color: '#a7a7b3', fontSize: 13, lineHeight: 1.5 }}>
            This Code Object controls ordinary native shapes beside it. The board still owns every
            change, permission, and Undo step.
          </p>
        </div>
        <div
          style={{
            borderRadius: 999,
            padding: '7px 10px',
            background: hasAccess ? '#14b8a622' : '#ef444422',
            color: hasAccess ? '#5eead4' : '#fca5a5',
            fontSize: 10,
            fontWeight: 850
          }}
        >
          {hasAccess ? 'BOARD ACCESS ON' : 'BOARD ACCESS OFF'}
        </div>
      </div>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginTop: 24
        }}
      >
        <div style={{ borderRadius: 16, padding: 16, background: '#ffffff0a' }}>
          <div style={{ color: '#858692', fontSize: 10, fontWeight: 800 }}>OWNED SHAPES</div>
          <strong data-test-id="board-remote-count" style={{ display: 'block', marginTop: 6, fontSize: 30 }}>
            {board.shapes.length}
          </strong>
        </div>
        <div style={{ borderRadius: 16, padding: 16, background: '#ffffff0a' }}>
          <div style={{ color: '#858692', fontSize: 10, fontWeight: 800 }}>ACTIVE OBJECT</div>
          <strong
            data-test-id="board-remote-active"
            style={{ display: 'block', overflow: 'hidden', marginTop: 9, fontSize: 15, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {active?.name ?? 'None yet'}
          </strong>
        </div>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 9,
          marginTop: 16
        }}
      >
        <ControlButton
          disabled={disabled}
          onClick={() => void addShape()}
          testId="board-remote-add"
        >
          Add native shape
        </ControlButton>
        <ControlButton
          disabled={disabled || !active}
          onClick={() => void moveShape()}
          testId="board-remote-move"
        >
          Move + rotate
        </ControlButton>
        <ControlButton
          disabled={disabled || !active}
          onClick={() => void resizeShape()}
          testId="board-remote-resize"
        >
          Resize
        </ControlButton>
        <ControlButton
          disabled={disabled || !active}
          onClick={() => void recolorShape()}
          testId="board-remote-recolor"
        >
          Change color
        </ControlButton>
        <ControlButton
          disabled={disabled || !active}
          onClick={() => active && void board.deleteShape(active.id)}
          testId="board-remote-delete"
        >
          Delete active
        </ControlButton>
      </div>

      <p style={{ margin: '18px 0 0', color: '#777883', fontSize: 11 }}>
        {interactionEnabled ? 'Controls are live.' : 'Press Enter or double-click to interact.'}
      </p>
    </main>
  )
}`

function registeredComponentSource(componentName: string): string {
  return `import type { ReactNode } from 'react'

type CodeObjectProps = {
  renderComponent: () => ReactNode
}

export default function ${componentName}CodeObject({
  renderComponent
}: CodeObjectProps) {
  return renderComponent()
}`
}

export const CODE_STARTER_SOURCE = registeredComponentSource('CodeStarter')
export const EARTH_SIGNALS_SOURCE = registeredComponentSource('EarthSignals')
export const EXTERNAL_LIVE_SURFACE_SOURCE = registeredComponentSource('ExternalLiveSurface')
export const ORBIT_LAB_SOURCE = registeredComponentSource('OrbitLab')
export const SIGNAL_BLOOM_SOURCE = registeredComponentSource('SignalBloom')
export const OPEN_SOURCE_WORKSPACE_SOURCE = registeredComponentSource('OpenSourceWorkspace')
export const OFFICE_DOCUMENT_SOURCE = registeredComponentSource('Document')
export const OFFICE_SPREADSHEET_SOURCE = registeredComponentSource('Spreadsheet')
export const PPTX_DECK_SOURCE = registeredComponentSource('PptxDeck')
export const PDF_DOCUMENT_SOURCE = registeredComponentSource('PdfDocument')
export const SMYLR_FLOW_SCREEN_SOURCE = registeredComponentSource('SmylrFlowScreen')
