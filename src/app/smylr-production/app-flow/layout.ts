import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { AppScreenFlowDefinition, AppScreenFlowLane, AppScreenFlowNode } from './model'

export const APP_FLOW_LAYOUT_VERSION = '33'
export const APP_FLOW_SCREEN_WIDTH = 960
export const APP_FLOW_SCREEN_HEIGHT = 675
export const APP_FLOW_SCREEN_GAP = 192

export type AppFlowCompositionKind =
  | 'default'
  | 'product-map'
  | 'recovery'
  | 'screen-states'
  | 'task-flow'
  | 'user-journey'

export type AppFlowTone = 'amber' | 'coral' | 'violet'

export type AppFlowNodePlacement = Rect & {
  emphasis?: 'focal' | 'subordinate'
  routeLane?: AppScreenFlowLane
  tone?: AppFlowTone
}

export type AppFlowCompositionGuide = {
  id: string
  kind: 'chapter' | 'lane'
  label: string
  lane?: AppScreenFlowLane
  tone: AppFlowTone
  width: number
  x: number
  y: number
}

export type AppFlowComposition = {
  guides: readonly AppFlowCompositionGuide[]
  kind: AppFlowCompositionKind
  placements: Readonly<Record<string, AppFlowNodePlacement>>
  visibleLanes: readonly AppScreenFlowLane[]
}

const PRODUCT_MAP: AppFlowComposition = {
  guides: [],
  kind: 'product-map',
  placements: {
    calendar: { height: 422, width: 600, x: 224, y: 0 },
    'patient-admin': { height: 422, width: 600, x: 944, y: 0 },
    'health-chart': {
      height: 422,
      routeLane: 'primary',
      tone: 'amber',
      width: 600,
      x: 1664,
      y: 0
    },
    'dental-chart': {
      emphasis: 'focal',
      height: 620,
      routeLane: 'alternate',
      width: 960,
      x: 1040,
      y: 540
    },
    'treatment-plan': {
      height: 422,
      routeLane: 'alternate',
      width: 600,
      x: 2120,
      y: 639
    }
  },
  visibleLanes: ['alternate', 'primary']
}

const USER_JOURNEY: AppFlowComposition = {
  guides: [],
  kind: 'user-journey',
  placements: {
    calendar: { height: 416, width: 592, x: 224, y: 0 },
    'patient-admin': { height: 416, width: 592, x: 928, y: 0 },
    'health-chart': {
      height: 416,
      routeLane: 'primary',
      tone: 'amber',
      width: 592,
      x: 1632,
      y: 0
    },
    'dental-chart-input': {
      emphasis: 'focal',
      height: 450,
      routeLane: 'alternate',
      width: 640,
      x: 1632,
      y: 624
    },
    'dental-chart-saved': {
      emphasis: 'subordinate',
      height: 416,
      routeLane: 'alternate',
      width: 592,
      x: 928,
      y: 656
    },
    'treatment-plan': {
      height: 416,
      routeLane: 'alternate',
      width: 592,
      x: 224,
      y: 656
    },
    'request-changes': { height: 128, tone: 'amber', width: 420, x: 1572, y: 1200 },
    'review-comment': { height: 128, tone: 'violet', width: 420, x: 952, y: 1200 }
  },
  visibleLanes: ['alternate', 'primary', 'feedback']
}

const TASK_FLOW: AppFlowComposition = {
  guides: [],
  kind: 'task-flow',
  placements: {
    'dental-chart-input': { emphasis: 'focal', height: 591, width: 840, x: 280, y: 0 },
    'dental-chart-saved': { emphasis: 'focal', height: 591, width: 840, x: 1440, y: 0 },
    'missing-tooth': { height: 128, tone: 'amber', width: 440, x: 360, y: 800 },
    'conditional-details': { height: 128, tone: 'amber', width: 440, x: 1560, y: 800 },
    'save-failure': { height: 136, tone: 'coral', width: 640, x: 920, y: 1040 }
  },
  visibleLanes: ['primary', 'feedback']
}

const SCREEN_STATES: AppFlowComposition = {
  guides: [],
  kind: 'screen-states',
  placements: {
    'input-active': { emphasis: 'focal', height: 591, width: 840, x: 280, y: 0 },
    'saved-undo': { emphasis: 'focal', height: 591, width: 840, x: 1440, y: 0 },
    'conditional-details': { height: 112, tone: 'amber', width: 520, x: 440, y: 760 }
  },
  visibleLanes: ['primary', 'feedback']
}

const RECOVERY: AppFlowComposition = {
  guides: [],
  kind: 'recovery',
  placements: {
    'input-submit': { emphasis: 'focal', height: 591, width: 840, x: 280, y: 0 },
    saved: { emphasis: 'focal', height: 591, width: 840, x: 1440, y: 0 },
    'save-failure': { height: 144, tone: 'coral', width: 336, x: 304, y: 720 },
    'preserved-draft': { height: 144, tone: 'amber', width: 336, x: 760, y: 720 },
    'edit-rework': {
      height: 144,
      routeLane: 'alternate',
      tone: 'amber',
      width: 336,
      x: 528,
      y: 984
    }
  },
  visibleLanes: ['primary', 'feedback']
}

const PREMIUM_LAYOUTS: Readonly<Record<string, AppFlowComposition>> = {
  'dental-chart-screen-states': SCREEN_STATES,
  'product-map-dental-chart': PRODUCT_MAP,
  'save-finding-recovery': RECOVERY,
  'task-flow-record-finding': TASK_FLOW,
  'user-journey-complete-dental-exam': USER_JOURNEY
}

function genericComposition(definition: AppScreenFlowDefinition): AppFlowComposition {
  const hasAlternate = definition.nodes.some(
    (node) => node.lane === 'alternate' && (node.kind === 'feedback' || node.kind === 'screen')
  )
  const primaryY = hasAlternate ? 707 : -160
  const laneY = { alternate: -160, feedback: primaryY + 867, primary: primaryY }
  const placements = Object.fromEntries(
    definition.nodes.flatMap((node, index) => {
      if (node.kind !== 'feedback' && node.kind !== 'screen') return []
      const width = node.kind === 'screen' ? APP_FLOW_SCREEN_WIDTH : 640
      const height = node.kind === 'screen' ? APP_FLOW_SCREEN_HEIGHT : 240
      return [
        [
          node.id,
          {
            height,
            width,
            x:
              560 +
              (node.column ?? index) * (APP_FLOW_SCREEN_WIDTH + APP_FLOW_SCREEN_GAP) +
              (APP_FLOW_SCREEN_WIDTH - width) / 2,
            y: laneY[node.lane]
          }
        ]
      ]
    })
  )
  const visibleLanes = (['alternate', 'primary', 'feedback'] as const).filter((lane) =>
    definition.nodes.some(
      (node) => node.lane === lane && (node.kind === 'feedback' || node.kind === 'screen')
    )
  )
  const maxColumn = Math.max(0, ...definition.nodes.map((node) => node.column ?? 0))
  const guideWidth = 240 + (maxColumn + 1) * (APP_FLOW_SCREEN_WIDTH + APP_FLOW_SCREEN_GAP)
  const labels = {
    alternate: 'ALTERNATES',
    feedback: 'FEEDBACK + REWORK',
    primary: 'PRIMARY'
  } satisfies Record<AppScreenFlowLane, string>
  const tones = {
    alternate: 'amber',
    feedback: 'coral',
    primary: 'violet'
  } satisfies Record<AppScreenFlowLane, AppFlowTone>
  return {
    guides: visibleLanes.map((lane) => ({
      id: `default-${lane}`,
      kind: 'lane',
      label: labels[lane],
      lane,
      tone: tones[lane],
      width: guideWidth,
      x: 320,
      y: laneY[lane] - 136
    })),
    kind: 'default',
    placements,
    visibleLanes
  }
}

export function resolveAppFlowComposition(definition: AppScreenFlowDefinition): AppFlowComposition {
  return PREMIUM_LAYOUTS[definition.id] ?? genericComposition(definition)
}

export function appFlowNodePlacement(
  composition: AppFlowComposition,
  node: AppScreenFlowNode
): AppFlowNodePlacement | undefined {
  return composition.placements[node.id]
}
