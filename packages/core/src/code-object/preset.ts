import { BRIEFING_REPORT_CODE_OBJECT_SOURCE } from './briefing'
import type { CodeObjectSurface } from './document'

type JsonRecord = Record<string, unknown>

export const CODE_OBJECT_MODALITY_DEFINITIONS = [
  {
    description: 'Flexible authored objects without a narrower preset contract',
    id: 'custom',
    label: 'Custom'
  },
  {
    description: 'Plans, tasks, and durable working surfaces',
    id: 'work',
    label: 'Work'
  },
  {
    description: 'Documents, spreadsheets, presentations, and portable files',
    id: 'document',
    label: 'Documents'
  },
  {
    description: 'Images, video, audio, and other playable or inspectable media',
    id: 'media',
    label: 'Media'
  },
  {
    description: 'Three-dimensional scenes and spatial tools',
    id: 'spatial',
    label: 'Spatial'
  },
  {
    description: 'Charts, dashboards, forms, and data-driven interfaces',
    id: 'data-interface',
    label: 'Data & interfaces'
  },
  {
    description: 'Objects that inspect, arrange, or operate on the Board',
    id: 'board-tool',
    label: 'Board tools'
  },
  {
    description: 'Full application surfaces with their own runtime and state',
    id: 'live-app',
    label: 'Live apps'
  },
  {
    description: 'Agent conversations, terminals, and delegated work surfaces',
    id: 'agent',
    label: 'Agents'
  },
  {
    description: 'Interactive visual instruments and expressive experiences',
    id: 'visual-experience',
    label: 'Visual experiences'
  }
] as const

export type CodeObjectModality = (typeof CODE_OBJECT_MODALITY_DEFINITIONS)[number]['id']

export const CODE_OBJECT_MODALITY_IDS = [
  'custom',
  'work',
  'document',
  'media',
  'spatial',
  'data-interface',
  'board-tool',
  'live-app',
  'agent',
  'visual-experience'
] as const satisfies readonly CodeObjectModality[]

export const CODE_OBJECT_AGENT_PRESET_IDS = [
  'custom-starter',
  'work-plan',
  'briefing-report',
  'document-starter',
  'media-starter',
  'spatial-starter',
  'data-interface-starter',
  'board-tool-starter',
  'live-app-starter',
  'agent-starter',
  'visual-experience-starter'
] as const

export type CodeObjectAgentPresetId = (typeof CODE_OBJECT_AGENT_PRESET_IDS)[number]

export type CodeObjectAgentPreset = {
  boardPermissions: readonly CodeObjectBoardPermission[]
  definitionId: string
  id: CodeObjectAgentPresetId
  modality: CodeObjectModality
  name: string
  props: JsonRecord
  source: string
  state: JsonRecord
  surface: CodeObjectSurface
}

export const CODE_OBJECT_BOARD_PERMISSIONS = [
  'component.create',
  'component.delete',
  'component.update.appearance',
  'component.update.geometry',
  'component.update.props',
  'component.update.source',
  'component.update.state',
  'page.reconcile',
  'shape.create',
  'shape.delete',
  'shape.update.appearance',
  'shape.update.geometry',
  'target.action.execute',
  'target.data.write',
  'target.state.write'
] as const

export type CodeObjectBoardPermission = (typeof CODE_OBJECT_BOARD_PERMISSIONS)[number]

export const WORK_PLAN_BLOCK_TYPES = [
  'outcome',
  'steps',
  'questions',
  'evidence',
  'decisions',
  'options',
  'milestones',
  'acceptance',
  'handoff',
  'notes',
  'diagram',
  'chart',
  'table',
  'artifact'
] as const

export const WORK_PLAN_ARTIFACT_KINDS = [
  'sheet',
  'document',
  'slides',
  'pdf',
  'dataset',
  'image',
  'video',
  'audio',
  'spatial',
  'code_object',
  'app',
  'file'
] as const

export const WORK_PLAN_CHART_KINDS = ['line', 'bar', 'area'] as const

export type WorkPlanBlockType = (typeof WORK_PLAN_BLOCK_TYPES)[number]
export type WorkPlanArtifactKind = (typeof WORK_PLAN_ARTIFACT_KINDS)[number]
export type WorkPlanChartKind = (typeof WORK_PLAN_CHART_KINDS)[number]

export type WorkPlanItem = {
  id: string
  label: string
  note?: string
  status?: 'pending' | 'active' | 'blocked' | 'done'
}

export type WorkPlanReference = {
  id: string
  kind: 'board_object' | 'chat' | 'file' | 'image' | 'trace_evidence' | 'url'
  label: string
  note?: string
}

export type WorkPlanDiagram = {
  appearance?: 'auto' | 'dark' | 'light'
  caption?: string
  format: 'mermaid'
  objectId?: string
  pageId?: string
  source?: string
}

export type WorkPlanChartSeries = {
  color?: string
  id: string
  label: string
  values: number[]
}

export type WorkPlanChart = {
  kind: WorkPlanChartKind
  labels: string[]
  series: WorkPlanChartSeries[]
  sourceLabel?: string
}

export type WorkPlanTable = {
  columns: Array<{ align?: 'left' | 'right'; key: string; label: string }>
  rows: Array<Record<string, number | string>>
  sourceLabel?: string
}

export type WorkPlanArtifact = {
  caption?: string
  id: string
  kind: WorkPlanArtifactKind
  label: string
  objectId?: string
  pageId?: string
  path?: string
  thumbnailUrl?: string
  url?: string
}

export type WorkPlanBlock = {
  artifacts?: WorkPlanArtifact[]
  body?: string
  chart?: WorkPlanChart
  diagram?: WorkPlanDiagram
  id: string
  items?: WorkPlanItem[]
  references?: WorkPlanReference[]
  table?: WorkPlanTable
  title: string
  type: WorkPlanBlockType
}

export type WorkPlan = {
  blocks: WorkPlanBlock[]
  shape: 'checklist' | 'investigation' | 'design' | 'build' | 'decision' | 'research' | 'mixed'
  status: 'draft' | 'active' | 'complete'
  summary?: string
  title: string
  updatedAt: string
  version: 1
}

const WORK_PLAN_BLOCK_TYPE_SOURCE = WORK_PLAN_BLOCK_TYPES.map((value) => `'${value}'`).join(' | ')
const WORK_PLAN_ARTIFACT_KIND_SOURCE = WORK_PLAN_ARTIFACT_KINDS.map((value) => `'${value}'`).join(
  ' | '
)
const WORK_PLAN_CHART_KIND_SOURCE = WORK_PLAN_CHART_KINDS.map((value) => `'${value}'`).join(' | ')

export const CODE_OBJECT_MODALITY_STARTER_SOURCE = `type StarterModel = {
  accent?: string
  eyebrow?: string
  items?: string[]
  summary?: string
  title?: string
}

type StarterProps = {
  interactionEnabled: boolean
  props: { model?: StarterModel }
  setState: (next: { active: number }) => void
  state: { active?: number }
}

const fallback: Required<StarterModel> = {
  accent: '#6d5dfc',
  eyebrow: 'CODE OBJECT',
  items: ['Shape the content', 'Connect real data', 'Refine the interaction'],
  summary: 'A preset-backed surface ready for focused content and behavior.',
  title: 'Modality starter'
}

export default function ModalityStarter({
  interactionEnabled,
  props,
  setState,
  state
}: StarterProps) {
  const model = props.model ?? fallback
  const items = Array.isArray(model.items) && model.items.length > 0 ? model.items : fallback.items
  const active = typeof state.active === 'number' ? Math.max(0, Math.min(items.length - 1, state.active)) : 0
  const accent = model.accent ?? fallback.accent
  return (
    <main
      style={{
        boxSizing: 'border-box',
        display: 'grid',
        height: '100%',
        padding: 18,
        width: '100%',
        background: 'transparent',
        color: '#1f2430',
        fontFamily: 'Inter, ui-sans-serif, system-ui'
      }}
    >
      <section
        style={{
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          padding: 24,
          border: '1px solid #50546829',
          borderRadius: 24,
          background: '#ffffffe6',
          boxShadow: '0 20px 60px #2d2e4021',
          backdropFilter: 'blur(18px)'
        }}
      >
        <div style={{ color: accent, fontSize: 10, fontWeight: 800, letterSpacing: '0.16em' }}>
          {model.eyebrow ?? fallback.eyebrow}
        </div>
        <h1 style={{ margin: '10px 0 7px', fontSize: 28, lineHeight: 1.08 }}>
          {model.title ?? fallback.title}
        </h1>
        <p style={{ margin: 0, maxWidth: 520, color: '#6d7180', fontSize: 14, lineHeight: 1.55 }}>
          {model.summary ?? fallback.summary}
        </p>
        <div style={{ display: 'grid', gap: 9, marginTop: 24 }}>
          {items.map((item, index) => (
            <button
              key={item}
              disabled={!interactionEnabled}
              onClick={() => setState({ active: index })}
              style={{
                boxSizing: 'border-box',
                width: '100%',
                padding: '12px 14px',
                border: index === active ? '1px solid transparent' : '1px solid #e7e8ed',
                borderRadius: 13,
                background: index === active ? accent : '#f7f8fbe6',
                color: index === active ? 'white' : '#313543',
                cursor: interactionEnabled ? 'pointer' : 'default',
                fontSize: 13,
                fontWeight: 650,
                textAlign: 'left'
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 'auto', paddingTop: 20, color: '#9a9daa', fontSize: 11 }}>
          Preset-owned renderer · persisted selection
        </div>
      </section>
    </main>
  )
}`

export const WORK_PLAN_CODE_OBJECT_SOURCE = `import { DataChart, DataTable, MermaidDiagram } from '@open-pencil/code-object-ui'

type WorkPlanItem = {
  id: string
  label: string
  note?: string
  status?: 'pending' | 'active' | 'blocked' | 'done'
}

type WorkPlanReference = {
  id: string
  kind: 'board_object' | 'chat' | 'file' | 'image' | 'trace_evidence' | 'url'
  label: string
  note?: string
}

type WorkPlanBlock = {
  id: string
  type: ${WORK_PLAN_BLOCK_TYPE_SOURCE}
  title: string
  body?: string
  items?: WorkPlanItem[]
  references?: WorkPlanReference[]
  diagram?: {
    appearance?: 'auto' | 'dark' | 'light'
    caption?: string
    format: 'mermaid'
    objectId?: string
    pageId?: string
    source?: string
  }
  chart?: {
    kind: ${WORK_PLAN_CHART_KIND_SOURCE}
    labels: string[]
    series: Array<{ color?: string; id: string; label: string; values: number[] }>
    sourceLabel?: string
  }
  table?: {
    columns: Array<{ align?: 'left' | 'right'; key: string; label: string }>
    rows: Array<Record<string, number | string>>
    sourceLabel?: string
  }
  artifacts?: Array<{
    caption?: string
    id: string
    kind: ${WORK_PLAN_ARTIFACT_KIND_SOURCE}
    label: string
    objectId?: string
    pageId?: string
    path?: string
    thumbnailUrl?: string
    url?: string
  }>
}

type WorkPlan = {
  version: 1
  title: string
  summary?: string
  shape: 'checklist' | 'investigation' | 'design' | 'build' | 'decision' | 'research' | 'mixed'
  status: 'draft' | 'active' | 'complete'
  blocks: WorkPlanBlock[]
  updatedAt: string
}

type WorkPlanDocumentProps = { props: { plan?: WorkPlan }; theme: 'dark' | 'light' }

const statusColor = {
  active: 'var(--code-accent)',
  blocked: 'var(--code-danger)',
  done: 'var(--code-success)',
  pending: 'var(--code-text-muted)'
} as const

function artifactLocation(artifact: NonNullable<WorkPlanBlock['artifacts']>[number]) {
  if (artifact.objectId) return artifact.pageId
    ? artifact.objectId + ' · ' + artifact.pageId
    : artifact.objectId
  return artifact.path ?? artifact.url ?? 'Linked artifact'
}

export default function WorkPlanDocument({ props, theme }: WorkPlanDocumentProps) {
  const plan = props.plan
  if (!plan) {
    return (
      <main style={{ padding: 32, color: '#69707f', fontFamily: 'Inter, ui-sans-serif, system-ui' }}>
        Add plan content to begin.
      </main>
    )
  }
  const blocks = Array.isArray(plan.blocks) ? plan.blocks : []
  return (
    <main
      style={{
        boxSizing: 'border-box',
        minHeight: '100%',
        padding: '36px 42px 52px',
        background: 'transparent',
        color: 'var(--code-text)',
        fontFamily: 'Inter, ui-sans-serif, system-ui'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--code-text-muted)', fontSize: 11 }}>
        <span style={{ color: 'var(--code-accent)', fontWeight: 800, letterSpacing: '0.12em' }}>PLAN</span>
        <span>·</span>
        <span>{plan.shape}</span>
        <span>·</span>
        <span>{plan.status}</span>
      </div>
      <h1 style={{ margin: '13px 0 8px', fontSize: 31, letterSpacing: '-0.025em', lineHeight: 1.12 }}>
        {plan.title}
      </h1>
      {plan.summary ? (
        <p style={{ margin: 0, maxWidth: 650, color: 'var(--code-text-muted)', fontSize: 15, lineHeight: 1.6 }}>
          {plan.summary}
        </p>
      ) : null}
      <div style={{ height: 1, margin: '28px 0 2px', background: 'var(--code-border)' }} />
      {blocks.map((block) => (
        <section key={block.id} style={{ padding: '24px 0', borderBottom: '1px solid var(--code-border)' }}>
          <div style={{ color: 'var(--code-text-muted)', fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {block.type}
          </div>
          <h2 style={{ margin: '7px 0 8px', fontSize: 19 }}>{block.title}</h2>
          {block.body ? (
            <p style={{ margin: '0 0 12px', color: 'var(--code-text-muted)', fontSize: 14, lineHeight: 1.6 }}>
              {block.body}
            </p>
          ) : null}
          {Array.isArray(block.items) ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {block.items.map((item) => (
                <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '9px 1fr', gap: 11, alignItems: 'start' }}>
                  <span style={{ width: 8, height: 8, marginTop: 6, borderRadius: 99, background: statusColor[item.status ?? 'pending'] }} />
                  <div>
                    <div style={{ fontSize: 14, lineHeight: 1.45 }}>{item.label}</div>
                    {item.note ? <div style={{ marginTop: 2, color: 'var(--code-text-muted)', fontSize: 12, lineHeight: 1.45 }}>{item.note}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {block.diagram?.format === 'mermaid' && block.diagram.source ? (
            <div style={{ marginTop: 14 }}>
              <MermaidDiagram
                appearance={block.diagram.appearance ?? theme}
                source={block.diagram.source}
              />
              {block.diagram.caption ? (
                <div style={{ marginTop: 7, color: 'var(--code-text-muted)', fontSize: 11 }}>
                  {block.diagram.caption}
                </div>
              ) : null}
            </div>
          ) : null}
          {block.chart ? (
            <div style={{ marginTop: 14 }}>
              <DataChart model={block.chart} />
              {block.chart.sourceLabel ? (
                <div style={{ marginTop: 7, color: 'var(--code-text-muted)', fontSize: 11 }}>
                  Source · {block.chart.sourceLabel}
                </div>
              ) : null}
            </div>
          ) : null}
          {block.table ? (
            <div style={{ marginTop: 14, overflow: 'hidden', border: '1px solid var(--code-border)', borderRadius: 12 }}>
              <DataTable model={{ columns: block.table.columns, rows: block.table.rows, title: block.title }} />
              {block.table.sourceLabel ? (
                <div style={{ padding: '8px 12px', borderTop: '1px solid var(--code-border)', color: 'var(--code-text-muted)', fontSize: 11 }}>
                  Source · {block.table.sourceLabel}
                </div>
              ) : null}
            </div>
          ) : null}
          {Array.isArray(block.artifacts) ? (
            <div style={{ display: 'grid', gap: 9, marginTop: 13 }}>
              {block.artifacts.map((artifact) => (
                <div key={artifact.id} style={{ display: 'grid', gridTemplateColumns: artifact.thumbnailUrl ? '96px 1fr' : '1fr', gap: 12, overflow: 'hidden', border: '1px solid var(--code-border)', borderRadius: 12, background: 'var(--code-surface)' }}>
                  {artifact.thumbnailUrl ? (
                    <img alt="" src={artifact.thumbnailUrl} style={{ width: 96, height: '100%', minHeight: 76, objectFit: 'cover', background: 'var(--code-surface-elevated)' }} />
                  ) : null}
                  <div style={{ minWidth: 0, padding: artifact.thumbnailUrl ? '11px 12px 11px 0' : '11px 12px' }}>
                    <div style={{ color: 'var(--code-accent)', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{artifact.kind.replaceAll('_', ' ')}</div>
                    <div style={{ marginTop: 4, fontSize: 13, fontWeight: 650 }}>{artifact.label}</div>
                    <div style={{ marginTop: 3, overflow: 'hidden', color: 'var(--code-text-muted)', fontSize: 11, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artifactLocation(artifact)}</div>
                    {artifact.caption ? <div style={{ marginTop: 5, color: 'var(--code-text-muted)', fontSize: 12, lineHeight: 1.4 }}>{artifact.caption}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {Array.isArray(block.references) ? (
            <div style={{ display: 'grid', gap: 7, marginTop: 13 }}>
              {block.references.map((reference) => (
                <div key={reference.id} style={{ padding: '9px 11px', border: '1px solid var(--code-border)', borderRadius: 10, background: 'var(--code-surface)' }}>
                  <div style={{ fontSize: 13, fontWeight: 650 }}>{reference.label}</div>
                  <div style={{ marginTop: 2, color: 'var(--code-text-muted)', fontSize: 11 }}>{reference.kind} · {reference.id}</div>
                  {reference.note ? <div style={{ marginTop: 4, color: 'var(--code-text-muted)', fontSize: 12 }}>{reference.note}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ))}
      <div style={{ marginTop: 18, color: 'var(--code-text-muted)', fontSize: 10 }}>Updated {plan.updatedAt}</div>
    </main>
  )
}`

function starterPreset(input: {
  accent: string
  id: Exclude<CodeObjectAgentPresetId, 'work-plan'>
  items: string[]
  modality: Exclude<CodeObjectModality, 'work'>
  name: string
  summary: string
  surface: CodeObjectSurface
}): CodeObjectAgentPreset {
  return {
    boardPermissions: [],
    definitionId: `openpencil.preset.${input.id}`,
    id: input.id,
    modality: input.modality,
    name: input.name,
    props: {
      model: {
        accent: input.accent,
        eyebrow: input.modality.replaceAll('-', ' ').toUpperCase(),
        items: input.items,
        summary: input.summary,
        title: input.name
      }
    },
    source: CODE_OBJECT_MODALITY_STARTER_SOURCE,
    state: { active: 0 },
    surface: input.surface
  }
}

export const CODE_OBJECT_AGENT_PRESETS: readonly CodeObjectAgentPreset[] = [
  starterPreset({
    accent: '#6d5dfc',
    id: 'custom-starter',
    items: ['Define the idea', 'Add real content', 'Refine the interaction'],
    modality: 'custom',
    name: 'Custom Code Object',
    summary: 'A flexible authored surface without a narrower product contract.',
    surface: { background: 'transparent', overflow: 'clip' }
  }),
  {
    boardPermissions: [],
    definitionId: 'openpencil.preset.work-plan',
    id: 'work-plan',
    modality: 'work',
    name: 'Work plan',
    props: {},
    source: WORK_PLAN_CODE_OBJECT_SOURCE,
    state: {},
    surface: { background: 'transparent', overflow: 'scroll' }
  },
  {
    boardPermissions: [],
    definitionId: 'openpencil.preset.briefing-report',
    id: 'briefing-report',
    modality: 'document',
    name: 'Briefing report',
    props: {},
    source: BRIEFING_REPORT_CODE_OBJECT_SOURCE,
    state: {},
    surface: { background: 'surface', overflow: 'scroll' }
  },
  starterPreset({
    accent: '#3568c9',
    id: 'document-starter',
    items: ['Outline', 'Draft', 'Review'],
    modality: 'document',
    name: 'Document',
    summary: 'A readable, scroll-ready document surface.',
    surface: { background: 'transparent', overflow: 'scroll' }
  }),
  starterPreset({
    accent: '#c55787',
    id: 'media-starter',
    items: ['Choose source media', 'Add controls', 'Define the passive state'],
    modality: 'media',
    name: 'Media experience',
    summary: 'A transparent starting point for image, video, or audio behavior.',
    surface: { background: 'transparent', overflow: 'clip' }
  }),
  starterPreset({
    accent: '#2f8d87',
    id: 'spatial-starter',
    items: ['Establish the scene', 'Add navigation', 'Persist the viewpoint'],
    modality: 'spatial',
    name: 'Spatial experience',
    summary: 'A transparent starting point for 3D scenes and spatial tools.',
    surface: { background: 'transparent', overflow: 'clip' }
  }),
  starterPreset({
    accent: '#256aa6',
    id: 'data-interface-starter',
    items: ['Connect the model', 'Choose the useful view', 'Add focused controls'],
    modality: 'data-interface',
    name: 'Data interface',
    summary: 'A stateful starting point for charts, dashboards, and forms.',
    surface: { background: 'transparent', overflow: 'clip' }
  }),
  starterPreset({
    accent: '#9b5c28',
    id: 'board-tool-starter',
    items: ['Define the target', 'Request narrow permission', 'Return a receipt'],
    modality: 'board-tool',
    name: 'Board tool',
    summary: 'A transparent tool surface; Board authority remains explicit.',
    surface: { background: 'transparent', overflow: 'clip' }
  }),
  starterPreset({
    accent: '#4d55bd',
    id: 'live-app-starter',
    items: ['Define the first view', 'Add navigation', 'Persist app state'],
    modality: 'live-app',
    name: 'Live app',
    summary: 'A contained application surface with its own interaction state.',
    surface: { background: 'transparent', overflow: 'clip' }
  }),
  starterPreset({
    accent: '#7553a6',
    id: 'agent-starter',
    items: ['Show current work', 'Expose useful controls', 'Keep history bounded'],
    modality: 'agent',
    name: 'Agent surface',
    summary: 'A scroll-ready surface for an agent, terminal, or delegated task.',
    surface: { background: 'transparent', overflow: 'scroll' }
  }),
  starterPreset({
    accent: '#c34f3c',
    id: 'visual-experience-starter',
    items: ['Set the visual system', 'Add one meaningful control', 'Persist the response'],
    modality: 'visual-experience',
    name: 'Visual experience',
    summary: 'A frameless interactive instrument or expressive experience.',
    surface: { background: 'transparent', overflow: 'clip' }
  })
]

export function isCodeObjectModality(value: unknown): value is CodeObjectModality {
  return CODE_OBJECT_MODALITY_DEFINITIONS.some((modality) => modality.id === value)
}

export function isCodeObjectAgentPresetId(value: unknown): value is CodeObjectAgentPresetId {
  return CODE_OBJECT_AGENT_PRESET_IDS.includes(value as CodeObjectAgentPresetId)
}

export function codeObjectAgentPreset(id: CodeObjectAgentPresetId): CodeObjectAgentPreset {
  const preset = CODE_OBJECT_AGENT_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`Unknown Code Object agent preset "${id}".`)
  return preset
}

export function codeObjectAgentPresetForModality(
  modality: CodeObjectModality
): CodeObjectAgentPreset {
  const preset = CODE_OBJECT_AGENT_PRESETS.find((candidate) => candidate.modality === modality)
  if (!preset) throw new Error(`No Code Object agent preset is registered for "${modality}".`)
  return preset
}
