import { describe, expect, test } from 'bun:test'

import { mermaidDiagramOwner } from '@open-pencil/core/editor'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { APP_FLOW_LAYOUT_VERSION } from '@/app/smylr-production/app-flow/layout'
import {
  DENTAL_CHART_APP_FLOW,
  PRODUCT_MAP_DENTAL_CHART_APP_FLOW,
  SAVE_FINDING_RECOVERY_APP_FLOW,
  SCREEN_STATES_DENTAL_CHART_APP_FLOW,
  SMYLR_DURABLE_APP_FLOW_DEFINITIONS,
  TASK_FLOW_RECORD_FINDING_APP_FLOW,
  TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW,
  USER_JOURNEY_COMPLETE_DENTAL_EXAM_APP_FLOW,
  parseAppScreenFlowMarkdown,
  type AppScreenFlowDefinition
} from '@/app/smylr-production/app-flow/model'
import { APP_FLOW_COLOR } from '@/app/smylr-production/app-flow/primitives'
import {
  appScreenFlowPluginValue,
  syncAppScreenFlowGeometryForNode,
  syncAppScreenFlowScene,
  syncDentalChartAppFlowGeometry,
  syncDentalChartAppFlowScene,
  syncProductMapDentalChartAppFlowScene
} from '@/app/smylr-production/app-flow/scene'
import { SMYLR_BOARD_GUIDE_VERSION } from '@/app/smylr-production/board-guide'
import {
  syncTechnicalFlowScene,
  TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE
} from '@/app/smylr-production/technical-flow'

import { assertScreenFlowRouting } from './app-screen-flow-routing'

function createFlowFixture() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    name: 'Dental Chart — Flow',
    pluginData: [
      { key: 'kind', pluginId: 'smylr-production', value: 'smylr-flow-page' },
      { key: 'pageId', pluginId: 'smylr-production', value: 'dental-chart' }
    ]
  })
  return { graph, page }
}

type TestBounds = Pick<SceneNode, 'height' | 'width' | 'x' | 'y'>

function overlaps(left: TestBounds, right: TestBounds) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

function unionBounds(nodes: SceneNode[]): TestBounds {
  const first = nodes[0]
  if (!first) throw new Error('Expected at least one node for bounds')
  const minX = Math.min(...nodes.map((node) => node.x))
  const minY = Math.min(...nodes.map((node) => node.y))
  const maxX = Math.max(...nodes.map((node) => node.x + node.width))
  const maxY = Math.max(...nodes.map((node) => node.y + node.height))
  return { height: maxY - minY, width: maxX - minX, x: minX, y: minY }
}

function screenEvidenceShare(nodes: SceneNode[]) {
  const screens = nodes.filter(
    (node) => appScreenFlowPluginValue(node, 'kind') === 'smylr-code-object-frame'
  )
  const content = nodes.filter((node) =>
    ['app-screen-flow-feedback', 'smylr-code-object-frame'].includes(
      appScreenFlowPluginValue(node, 'kind') ?? ''
    )
  )
  const bounds = unionBounds(content)
  const screenArea = screens.reduce((sum, screen) => sum + screen.width * screen.height, 0)
  return screenArea / (bounds.width * bounds.height)
}

describe('Dental Chart Markdown journey lanes', () => {
  test('parses views, feedback, and Mermaid paths from the Markdown source', () => {
    const definition = parseAppScreenFlowMarkdown(DENTAL_CHART_APP_FLOW.source)

    expect(definition.sourceFile).toBe('dental-chart-journey.md')
    expect(definition.nodes).toHaveLength(9)
    expect(definition.edges).toHaveLength(10)
    expect(definition.nodes.filter((node) => node.lane === 'alternate')).toHaveLength(1)
    expect(definition.nodes.filter((node) => node.kind === 'feedback')).toHaveLength(2)
    expect(definition.nodes.some((node) => node.route === '/dental-imaging')).toBe(false)
    expect(definition.edges.find((edge) => edge.id === 'add-comment')?.kind).toBe('feedback')
  })

  test('rejects Mermaid paths that reference an unknown view', () => {
    expect(() =>
      parseAppScreenFlowMarkdown(
        DENTAL_CHART_APP_FLOW.source.replace(
          'entry -->|Open chart| current',
          'missing -->|Open chart| current'
        )
      )
    ).toThrow('references an unknown view')
  })

  test('parses the five durable Maps & Flows definitions with scoped source evidence', () => {
    expect(SMYLR_DURABLE_APP_FLOW_DEFINITIONS.map((definition) => definition.label)).toEqual([
      'User Journey — Complete Dental Exam',
      'Task Flow — Record Finding',
      'Screen States — Dental Chart',
      'Recovery Flow — Save Finding',
      'Technical Flow — Save Finding'
    ])
    expect(USER_JOURNEY_COMPLETE_DENTAL_EXAM_APP_FLOW.sourceFile).toBe(
      'user-journey-complete-dental-exam.md'
    )
    expect(TASK_FLOW_RECORD_FINDING_APP_FLOW.sourceFile).toBe('task-flow-record-finding.md')

    const journeyScreens = USER_JOURNEY_COMPLETE_DENTAL_EXAM_APP_FLOW.nodes.filter(
      (node) => node.kind === 'screen'
    )
    expect(journeyScreens.every((screen) => screen.captureSrc === undefined)).toBe(true)
    expect(TASK_FLOW_RECORD_FINDING_APP_FLOW.nodes.map((node) => node.id)).toEqual([
      'entry',
      'dental-chart-input',
      'dental-chart-saved',
      'exit',
      'missing-tooth',
      'conditional-details',
      'save-failure'
    ])
    expect(
      TASK_FLOW_RECORD_FINDING_APP_FLOW.edges.map((edge) => `${edge.sourceId}->${edge.targetId}`)
    ).toContainEqual('dental-chart-input->save-failure')
    expect(
      TASK_FLOW_RECORD_FINDING_APP_FLOW.edges.map((edge) => `${edge.sourceId}->${edge.targetId}`)
    ).not.toContainEqual('save-failure->dental-chart-saved')
    expect(SCREEN_STATES_DENTAL_CHART_APP_FLOW.sourceFile).toBe('dental-chart-screen-states.md')
    expect(
      SCREEN_STATES_DENTAL_CHART_APP_FLOW.nodes.every((node) => node.captureSrc === undefined)
    ).toBe(true)
    expect(
      SCREEN_STATES_DENTAL_CHART_APP_FLOW.edges.map((edge) => `${edge.sourceId}->${edge.targetId}`)
    ).toEqual([
      'entry->input-active',
      'input-active->saved-undo',
      'saved-undo->input-active',
      'saved-undo->exit',
      'input-active->conditional-details'
    ])
    expect(SCREEN_STATES_DENTAL_CHART_APP_FLOW.nodes.map((node) => node.id)).not.toContain(
      'edit-undo-return'
    )
    expect(SCREEN_STATES_DENTAL_CHART_APP_FLOW.nodes).toContainEqual(
      expect.objectContaining({ id: 'conditional-details', status: 'DETAILS REQUIRED' })
    )
    expect(SAVE_FINDING_RECOVERY_APP_FLOW.sourceFile).toBe('save-finding-recovery.md')
    expect(SAVE_FINDING_RECOVERY_APP_FLOW.nodes).toContainEqual(
      expect.objectContaining({ id: 'save-failure', status: 'SAVE FAILED' })
    )
    expect(
      SAVE_FINDING_RECOVERY_APP_FLOW.edges.map((edge) => `${edge.sourceId}->${edge.targetId}`)
    ).toEqual([
      'input-submit->saved',
      'saved->exit',
      'input-submit->save-failure',
      'save-failure->preserved-draft',
      'preserved-draft->edit-rework',
      'edit-rework->input-submit'
    ])
    expect(TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.schemaVersion).toBe('4')
    expect(TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.nodes.map((node) => node.captureSrc)).toEqual(
      Array.from({ length: 8 }, () => undefined)
    )
    expect(TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.nodes.map((node) => node.id)).toEqual([
      'submit',
      'resolve',
      'batch',
      'post',
      'write',
      'insert',
      'update',
      'recovery'
    ])
    expect(TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.edges.map((edge) => edge.label)).toEqual([
      'save finding',
      'resolved codes',
      'POST request',
      'write rows',
      'commit',
      'saved',
      'save failed',
      'retry save'
    ])
  })

  test('builds five source-backed screens, three lanes, feedback, entry, and exit', () => {
    const { graph, page } = createFlowFixture()
    const result = syncDentalChartAppFlowScene(graph, page.id)
    const children = graph.getChildren(page.id)
    const screens = children.filter(
      (node) => appScreenFlowPluginValue(node, 'appFlowNodeKind') === 'screen'
    )
    const edges = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-edge'
    )
    const feedback = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-feedback'
    )
    const lanes = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-lane'
    )
    const markers = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-marker'
    )

    expect(result.changed).toBe(true)
    expect(screens.map((node) => appScreenFlowPluginValue(node, 'appFlowNodeId'))).toEqual([
      'current',
      'exam-setup',
      'active-charting',
      'review',
      'treatment-plan'
    ])
    expect(edges).toHaveLength(10)
    expect(feedback).toHaveLength(2)
    expect(lanes).toHaveLength(3)
    expect(markers.map((node) => appScreenFlowPluginValue(node, 'appFlowNodeKind'))).toEqual([
      'entry',
      'exit'
    ])
    expect(markers.every((marker) => marker.height === 20 && marker.width === 20)).toBe(true)
    expect(
      markers.map(
        (marker) => graph.getChildren(marker.id).find((node) => node.type === 'TEXT')?.text
      )
    ).toEqual(['Start', 'Done'])
    expect(
      markers.every((marker) => {
        const label = graph.getChildren(marker.id).find((node) => node.type === 'TEXT')
        return label && (label.x < 0 || label.x > marker.width)
      })
    ).toBe(true)
    expect(
      markers.map(
        (marker) =>
          graph.getChildren(marker.id).find((node) => node.type === 'ELLIPSE')?.fills[0]?.color
      )
    ).toEqual([APP_FLOW_COLOR.connector, APP_FLOW_COLOR.green])
    expect(edges.every((edge) => graph.getChildren(edge.id).length > 0)).toBe(true)
    expect(appScreenFlowPluginValue(page, 'flowSourceFormat')).toBe('markdown')
    expect(appScreenFlowPluginValue(page, 'flowSourceFile')).toBe('dental-chart-journey.md')
  })

  test('keeps stable screen identity and avoids duplicate generated flow objects', () => {
    const { graph, page } = createFlowFixture()
    const first = syncDentalChartAppFlowScene(graph, page.id)
    const childCount = graph.getChildren(page.id).length
    const second = syncDentalChartAppFlowScene(graph, page.id)

    expect(second.changed).toBe(false)
    expect(second.screenIds).toEqual(first.screenIds)
    expect(graph.getChildren(page.id)).toHaveLength(childCount)
  })

  test('migrates the visual grammar in place and preserves generated identities', () => {
    const { graph, page } = createFlowFixture()
    syncProductMapDentalChartAppFlowScene(graph, page.id)
    const children = graph.getChildren(page.id)
    const frame = children.find(
      (node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'dental-chart'
    )
    const label = children.find(
      (node) =>
        appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-state-label' &&
        appScreenFlowPluginValue(node, 'appFlowNodeId') === 'dental-chart'
    )
    const edge = children.find(
      (node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === 'open-chart'
    )
    const guide = children.find(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'smylr-board-guide'
    )
    if (!frame || !label || !edge || !guide) throw new Error('Migration fixture is incomplete')

    graph.updateNode(page.id, {
      pluginData: page.pluginData.map((entry) =>
        entry.key === 'flowLayoutVersion' ? { ...entry, value: '2' } : entry
      )
    })
    graph.updateNode(guide.id, {
      pluginData: guide.pluginData.map((entry) =>
        entry.key === 'guideVersion' ? { ...entry, value: '4' } : entry
      )
    })

    const result = syncProductMapDentalChartAppFlowScene(graph, page.id)
    const migratedGuide = graph.getNode(guide.id)
    expect(result.changed).toBe(true)
    expect(graph.getNode(frame.id)?.id).toBe(frame.id)
    expect(graph.getNode(label.id)?.id).toBe(label.id)
    expect(graph.getNode(edge.id)?.id).toBe(edge.id)
    expect(migratedGuide?.id).toBe(guide.id)
    expect(migratedGuide?.type).toBe('FRAME')
    expect(migratedGuide?.width).toBe(1500)
    expect(migratedGuide?.height).toBe(56)
    expect(migratedGuide?.fills).toEqual([])
    const guideTitles = graph.getChildren(guide.id).filter((child) => child.type === 'TEXT')
    expect(guideTitles).toHaveLength(1)
    expect(guideTitles[0]?.text).toBe(PRODUCT_MAP_DENTAL_CHART_APP_FLOW.label)
    expect(guideTitles[0]?.fontSize).toBe(32)
    expect(appScreenFlowPluginValue(migratedGuide, 'guideVersion')).toBe(SMYLR_BOARD_GUIDE_VERSION)
    expect(appScreenFlowPluginValue(graph.getNode(page.id), 'flowLayoutVersion')).toBe(
      APP_FLOW_LAYOUT_VERSION
    )
  })

  test('reattaches labels, paths, and entry marker after a screen moves', () => {
    const { graph, page } = createFlowFixture()
    syncDentalChartAppFlowScene(graph, page.id)
    const current = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'current')
    const nextEdge = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === 'set-up-exam')
    if (!current || !nextEdge) throw new Error('Current screen path was not created')
    const edgeX = nextEdge.x
    const edgeY = nextEdge.y

    graph.updateNode(current.id, { x: current.x + 96, y: current.y + 48 })
    expect(syncDentalChartAppFlowGeometry(graph, page.id)).toBe(true)

    const label = graph
      .getChildren(page.id)
      .find(
        (node) =>
          appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-state-label' &&
          appScreenFlowPluginValue(node, 'appFlowNodeId') === 'current'
      )
    const entryMarker = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'entry')

    expect(label?.x).toBe(current.x)
    expect(label?.y).toBe(current.y - 128)
    expect(nextEdge.x).not.toBe(edgeX)
    expect(nextEdge.y).not.toBe(edgeY)
    expect(entryMarker?.x).toBe(current.x - 148)
  })

  test('reattaches feedback paths after a feedback card moves', () => {
    const { graph, page } = createFlowFixture()
    syncDentalChartAppFlowScene(graph, page.id)
    const comment = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'review-comment')
    const requestEdge = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === 'request-changes')
    if (!comment || !requestEdge) throw new Error('Feedback path was not created')
    const edgeBounds = {
      height: requestEdge.height,
      width: requestEdge.width,
      x: requestEdge.x,
      y: requestEdge.y
    }

    graph.updateNode(comment.id, { y: comment.y + 80 })
    expect(syncDentalChartAppFlowGeometry(graph, page.id)).toBe(true)

    const updatedEdge = graph.getNode(requestEdge.id)
    expect(updatedEdge).toBeDefined()
    expect({
      height: updatedEdge?.height,
      width: updatedEdge?.width,
      x: updatedEdge?.x,
      y: updatedEdge?.y
    }).not.toEqual(edgeBounds)
  })

  test('keeps the Product Map Markdown to five distinct native routes', () => {
    const definition = parseAppScreenFlowMarkdown(PRODUCT_MAP_DENTAL_CHART_APP_FLOW.source)
    const screens = definition.nodes.filter((node) => node.kind === 'screen')

    expect(definition.label).toBe('Product Map — Dental Chart')
    expect(definition.sourceFile).toBe('product-map.md')
    expect(definition.schemaVersion).toBe('5')
    expect(screens).toHaveLength(5)
    expect(screens.map((screen) => screen.route)).toEqual([
      '/calendar',
      '/patient-admin',
      '/dental-chart',
      '/treatment-plan',
      '/health-chart'
    ])
    expect(new Set(screens.map((screen) => screen.route)).size).toBe(5)
    expect(screens.every((screen) => screen.captureSrc === undefined)).toBe(true)
    expect(definition.edges.map((edge) => `${edge.sourceId}->${edge.targetId}`)).toEqual([
      'entry->calendar',
      'calendar->patient-admin',
      'patient-admin->dental-chart',
      'dental-chart->treatment-plan',
      'treatment-plan->exit',
      'patient-admin->health-chart',
      'health-chart->dental-chart'
    ])
  })

  test('projects Product Map as a native 3+2 composition without lane chrome', () => {
    const { graph, page } = createFlowFixture()
    const result = syncProductMapDentalChartAppFlowScene(graph, page.id)
    const children = graph.getChildren(page.id)
    const frames = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'smylr-code-object-frame'
    )
    const labels = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-state-label'
    )
    const lanes = children.filter((node) =>
      ['app-screen-flow-chapter', 'app-screen-flow-lane'].includes(
        appScreenFlowPluginValue(node, 'kind') ?? ''
      )
    )
    const edges = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-edge'
    )

    expect(result.changed).toBe(true)
    expect(frames).toHaveLength(5)
    expect(new Set(frames.map((frame) => appScreenFlowPluginValue(frame, 'route'))).size).toBe(5)
    expect(labels).toHaveLength(5)
    expect(lanes).toHaveLength(0)
    expect(edges).toHaveLength(7)
    expect(edges.every((edge) => graph.getChildren(edge.id).length > 0)).toBe(true)
    expect(appScreenFlowPluginValue(page, 'flowComposition')).toBe('product-map')
    expect(appScreenFlowPluginValue(page, 'flowSourceFile')).toBe('product-map.md')
  })

  test('makes Dental Chart the Product Map focal screen in a bounded 3+2 field', () => {
    const { graph, page } = createFlowFixture()
    syncProductMapDentalChartAppFlowScene(graph, page.id)
    const frame = (nodeId: string) => {
      const node = graph
        .getChildren(page.id)
        .find((candidate) => appScreenFlowPluginValue(candidate, 'appFlowNodeId') === nodeId)
      if (!node) throw new Error(`Missing Product Map frame ${nodeId}`)
      return node
    }
    const calendar = frame('calendar')
    const patientAdmin = frame('patient-admin')
    const dentalChart = frame('dental-chart')
    const treatmentPlan = frame('treatment-plan')
    const healthChart = frame('health-chart')
    const frames = [calendar, patientAdmin, dentalChart, treatmentPlan, healthChart]
    const topRow = frames.filter((screen) => screen.y < 500)
    const bottomRow = frames.filter((screen) => screen.y >= 500)
    const contentBounds = unionBounds(frames)

    expect(topRow).toHaveLength(3)
    expect(bottomRow).toHaveLength(2)
    expect(dentalChart.width * dentalChart.height).toBeGreaterThan(
      Math.max(
        calendar.width * calendar.height,
        patientAdmin.width * patientAdmin.height,
        treatmentPlan.width * treatmentPlan.height,
        healthChart.width * healthChart.height
      )
    )
    for (const [index, left] of frames.entries()) {
      for (const right of frames.slice(index + 1)) expect(overlaps(left, right)).toBe(false)
    }
    expect(contentBounds.width).toBeLessThanOrEqual(2880)
    expect(contentBounds.height).toBeLessThanOrEqual(1760)
    expect(screenEvidenceShare(graph.getChildren(page.id))).toBeGreaterThanOrEqual(0.55)
  })

  test('uses restrained borderless Product Map labels without detached transition chips', () => {
    const { graph, page } = createFlowFixture()
    syncProductMapDentalChartAppFlowScene(graph, page.id)
    const frames = graph
      .getChildren(page.id)
      .filter((node) => appScreenFlowPluginValue(node, 'kind') === 'smylr-code-object-frame')
    const labels = graph
      .getChildren(page.id)
      .filter((node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-state-label')
    const healthLabel = labels.find(
      (label) => appScreenFlowPluginValue(label, 'appFlowNodeId') === 'health-chart'
    )
    const chooseEdge = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === 'choose')

    expect(frames).toHaveLength(5)
    expect(
      frames.every((frame) => appScreenFlowPluginValue(frame, 'renderMedium') === 'code-object')
    ).toBe(true)
    expect(labels.every((label) => label.fills.length === 0 && label.strokes.length === 0)).toBe(
      true
    )
    expect(
      labels
        .map(
          (label) =>
            graph.getChildren(label.id).filter((child) => child.type === 'TEXT')[1]?.fontSize
        )
        .sort((left, right) => (left ?? 0) - (right ?? 0))
    ).toEqual([30, 30, 30, 30, 32])
    expect(
      labels.every((label) => {
        const children = graph.getChildren(label.id).filter((child) => child.type === 'TEXT')
        return (
          children.length === 2 &&
          children[0]?.fontSize === 18 &&
          (children[1]?.fontSize ?? 0) >= 30
        )
      })
    ).toBe(true)
    const healthText = graph
      .getChildren(healthLabel?.id ?? '')
      .filter((node) => node.type === 'TEXT')
    expect(healthText.map((node) => node.text)).toEqual(['ALTERNATE', 'Health Chart'])
    expect(healthText[0]?.fills[0]?.color).toEqual(APP_FLOW_COLOR.amber)
    expect(healthText[1]?.fills[0]?.color).toEqual(APP_FLOW_COLOR.white)
    expect(
      graph
        .getChildren(chooseEdge?.id ?? '')
        .find((node) => appScreenFlowPluginValue(node, 'part') === 'label')
    ).toBeUndefined()
    expect(
      ['start', 'done'].map((edgeId) =>
        appScreenFlowPluginValue(
          graph
            .getChildren(page.id)
            .find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === edgeId),
          'routeChannel'
        )
      )
    ).toEqual(['direct-horizontal', 'direct-horizontal'])
  })

  test('projects UX definitions with Code Objects and keeps Technical Flow diagram-only', () => {
    const graph = new SceneGraph()
    for (const [index, definition] of SMYLR_DURABLE_APP_FLOW_DEFINITIONS.entries()) {
      const page = index === 0 ? graph.getPages()[0] : graph.addPage(definition.label)
      graph.updateNode(page.id, { name: definition.label })
      const result =
        definition.id === 'technical-flow-save-finding'
          ? syncTechnicalFlowScene(graph, page.id, definition)
          : syncAppScreenFlowScene(graph, page.id, definition)
      const frames = graph
        .getChildren(page.id)
        .filter((node) => appScreenFlowPluginValue(node, 'kind') === 'smylr-code-object-frame')
      const edges = graph
        .getChildren(page.id)
        .filter((node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-edge')

      expect(result.changed).toBe(true)
      if (definition.id === 'technical-flow-save-finding') {
        expect(frames).toHaveLength(0)
        expect(edges).toHaveLength(0)
        expect(
          graph
            .getChildren(page.id)
            .filter((node) => appScreenFlowPluginValue(node, 'kind') === 'technical-flow-mermaid')
        ).toHaveLength(1)
      } else {
        expect(
          frames.every((frame) => appScreenFlowPluginValue(frame, 'renderMedium') === 'code-object')
        ).toBe(true)
        expect(edges).toHaveLength(definition.edges.length)
        expect(edges.every((edge) => graph.getChildren(edge.id).length > 0)).toBe(true)
      }
    }
  })

  test('routes every screen flow outside content with clear arrows, labels, and paint order', () => {
    const definitions: AppScreenFlowDefinition[] = [
      PRODUCT_MAP_DENTAL_CHART_APP_FLOW,
      ...SMYLR_DURABLE_APP_FLOW_DEFINITIONS.filter(
        (definition) => definition.id !== 'technical-flow-save-finding'
      )
    ]
    for (const definition of definitions) assertScreenFlowRouting(definition)
  })

  test('reroutes a durable task-flow connector through live node integration after a screen moves', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    syncAppScreenFlowScene(graph, page.id, TASK_FLOW_RECORD_FINDING_APP_FLOW)
    const input = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'dental-chart-input')
    const edge = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === 'record')
    if (!input || !edge) throw new Error('Task flow input path was not created')
    const originalX = edge.x

    graph.updateNode(input.id, { x: input.x + 128, y: input.y + 64 })
    expect(syncAppScreenFlowGeometryForNode(graph, graph.getNode(input.id))).toBe(true)
    expect(graph.getNode(edge.id)?.x).not.toBe(originalX)
    const parts = graph
      .getChildren(edge.id)
      .map((node) => appScreenFlowPluginValue(node, 'part') ?? '')
    const pathIndex = parts.indexOf('path')
    const arrowIndex = parts.indexOf('arrow')
    const labelIndex = parts.indexOf('label')
    expect(pathIndex).toBeLessThan(arrowIndex)
    expect(arrowIndex).toBeLessThan(labelIndex)
  })

  test('moves a Product Map screen without leaving a transition label on content', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    syncAppScreenFlowScene(graph, page.id, PRODUCT_MAP_DENTAL_CHART_APP_FLOW)
    const calendar = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'calendar')
    const choose = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === 'choose')
    if (!calendar || !choose) throw new Error('Product Map label path was not created')

    graph.updateNode(calendar.id, { x: calendar.x + 100, y: calendar.y - 100 })
    expect(syncAppScreenFlowGeometryForNode(graph, graph.getNode(calendar.id))).toBe(true)
    const label = graph
      .getChildren(choose.id)
      .find((node) => appScreenFlowPluginValue(node, 'part') === 'label')
    expect(label).toBeUndefined()
  })

  test('uses a numbered serpentine journey without a second chapter-label band', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    syncAppScreenFlowScene(graph, page.id, USER_JOURNEY_COMPLETE_DENTAL_EXAM_APP_FLOW)
    const children = graph.getChildren(page.id)
    const frames = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'smylr-code-object-frame'
    )
    const chapters = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-chapter'
    )
    const input = frames.find(
      (node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'dental-chart-input'
    )
    const saved = frames.find(
      (node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'dental-chart-saved'
    )
    if (!input || !saved) throw new Error('Journey focal states were not created')

    const stateLabels = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-state-label'
    )
    expect(chapters).toHaveLength(0)
    expect(
      stateLabels.map((label) =>
        graph
          .getChildren(label.id)
          .filter((node) => node.type === 'TEXT')
          .map((node) => node.text)
      )
    ).toEqual([
      ['01', 'Calendar'],
      ['02', 'Patient Admin'],
      ['03', 'Input'],
      ['04', 'Saved'],
      ['05', 'Treatment Plan'],
      ['ALTERNATE', 'Health Chart']
    ])
    expect(
      stateLabels.map(
        (label) => graph.getChildren(label.id).filter((node) => node.type === 'TEXT')[1]?.fontSize
      )
    ).toEqual([30, 30, 32, 30, 30, 30])
    for (const edgeId of ['open-chart', 'return']) {
      const edge = children.find(
        (node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === edgeId
      )
      expect(
        graph
          .getChildren(edge?.id ?? '')
          .some((node) => appScreenFlowPluginValue(node, 'part') === 'label')
      ).toBe(false)
    }
    expect(frames.filter((frame) => frame.y < 400)).toHaveLength(3)
    expect(frames.filter((frame) => frame.y >= 400)).toHaveLength(3)
    expect(saved.width * saved.height).toBeLessThan(input.width * input.height)
    expect(screenEvidenceShare(children)).toBeGreaterThanOrEqual(0.55)
    expect(unionBounds(frames).width).toBeLessThanOrEqual(2880)
  })

  test('keeps two dominant Task Flow screens with compact local validation branches', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    syncAppScreenFlowScene(graph, page.id, TASK_FLOW_RECORD_FINDING_APP_FLOW)

    const input = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'dental-chart-input')
    const saved = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'dental-chart-saved')
    const feedback = graph
      .getChildren(page.id)
      .filter((node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-feedback')
    const lanes = graph
      .getChildren(page.id)
      .filter((node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-lane')
    const record = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === 'record')

    if (!input || !saved || !record) throw new Error('Task flow compact layout was not created')

    expect({ height: input.height, width: input.width, y: input.y }).toEqual({
      height: 591,
      width: 840,
      y: 0
    })
    expect({ height: saved.height, width: saved.width, y: saved.y }).toEqual({
      height: 591,
      width: 840,
      y: 0
    })
    expect(feedback).toHaveLength(3)
    expect(feedback.every((card) => card.height <= 136 && card.width <= 640)).toBe(true)
    expect(feedback.every((card) => card.strokes.length === 0)).toBe(true)
    expect(
      feedback.every((card) => graph.getChildren(card.id).every((child) => child.type === 'TEXT'))
    ).toBe(true)
    expect(feedback.every((card) => card.y > input.y + input.height)).toBe(true)
    const missingTooth = feedback.find(
      (card) => appScreenFlowPluginValue(card, 'appFlowNodeId') === 'missing-tooth'
    )
    const saveFailure = feedback.find(
      (card) => appScreenFlowPluginValue(card, 'appFlowNodeId') === 'save-failure'
    )
    if (!missingTooth || !saveFailure) throw new Error('Task flow branches were not created')
    expect(missingTooth.x).toBeGreaterThanOrEqual(input.x)
    expect(missingTooth.x + missingTooth.width).toBeLessThanOrEqual(input.x + input.width)
    expect(saveFailure.y).toBeGreaterThan(missingTooth.y)
    expect(feedback.map((card) => appScreenFlowPluginValue(card, 'flowTone'))).toEqual([
      'amber',
      'amber',
      'coral'
    ])
    expect(appScreenFlowPluginValue(record, 'routeChannel')).toBe('direct-horizontal')
    expect(appScreenFlowPluginValue(record, 'sourceAnchorSide')).toBe('right')
    expect(appScreenFlowPluginValue(record, 'targetAnchorSide')).toBe('left')
    expect(lanes).toHaveLength(0)
    const feedbackEdges = graph
      .getChildren(page.id)
      .filter(
        (node) =>
          appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-edge' &&
          appScreenFlowPluginValue(node, 'edgeKind') === 'feedback'
      )
    expect(
      feedbackEdges.every(
        (edge) =>
          !graph
            .getChildren(edge.id)
            .some((part) => appScreenFlowPluginValue(part, 'part') === 'label')
      )
    ).toBe(true)
    expect(
      TASK_FLOW_RECORD_FINDING_APP_FLOW.edges.map((edge) => `${edge.sourceId}->${edge.targetId}`)
    ).not.toContain('missing-tooth->dental-chart-input')
    expect(
      TASK_FLOW_RECORD_FINDING_APP_FLOW.edges.map((edge) => `${edge.sourceId}->${edge.targetId}`)
    ).not.toContain('save-failure->dental-chart-saved')
  })

  test('centers an equal Screen States comparison with direct Save and Undo transitions', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const result = syncAppScreenFlowScene(graph, page.id, SCREEN_STATES_DENTAL_CHART_APP_FLOW)
    const children = graph.getChildren(page.id)
    const frames = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'smylr-code-object-frame'
    )
    const feedback = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-feedback'
    )
    const lanes = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-lane'
    )
    expect(result.changed).toBe(true)
    expect(appScreenFlowPluginValue(page, 'flowId')).toBe('dental-chart-screen-states')
    expect(appScreenFlowPluginValue(page, 'flowSourceFile')).toBe('dental-chart-screen-states.md')
    expect(frames).toHaveLength(2)
    expect(
      frames.every((frame) => appScreenFlowPluginValue(frame, 'renderMedium') === 'code-object')
    ).toBe(true)
    expect(frames.map(({ height, width, y }) => ({ height, width, y }))).toEqual([
      { height: 591, width: 840, y: 0 },
      { height: 591, width: 840, y: 0 }
    ])
    expect(feedback).toHaveLength(1)
    expect(feedback[0]).toMatchObject({ height: 112, width: 520, x: 440, y: 760 })
    expect(
      appScreenFlowPluginValue(
        feedback.find(
          (card) => appScreenFlowPluginValue(card, 'appFlowNodeId') === 'conditional-details'
        ),
        'flowFeedbackStatus'
      )
    ).toBe('DETAILS REQUIRED')
    expect(appScreenFlowPluginValue(feedback[0], 'flowTone')).toBe('amber')
    expect(lanes).toHaveLength(0)
    expect(
      SCREEN_STATES_DENTAL_CHART_APP_FLOW.edges.map((edge) => `${edge.sourceId}->${edge.targetId}`)
    ).toContain('saved-undo->input-active')
    expect(
      SCREEN_STATES_DENTAL_CHART_APP_FLOW.edges.map((edge) => `${edge.sourceId}->${edge.targetId}`)
    ).not.toContain('conditional-details->saved-undo')
    expect(
      children.some((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'current')
    ).toBe(false)
    expect(
      children.some((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'exam-setup')
    ).toBe(false)

    const save = children.find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === 'save')
    const undo = children.find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === 'undo')
    if (!save || !undo) throw new Error('Screen States Save and Undo paths were not created')
    expect(appScreenFlowPluginValue(save, 'routeChannel')).toBe('direct-horizontal')
    expect(appScreenFlowPluginValue(undo, 'routeChannel')).toBe('direct-horizontal')
    expect(appScreenFlowPluginValue(save, 'sourceAnchorSide')).toBe('right')
    expect(appScreenFlowPluginValue(undo, 'sourceAnchorSide')).toBe('left')
    const actionLabels = [save, undo].map((edge) =>
      graph.getChildren(edge.id).find((node) => appScreenFlowPluginValue(node, 'part') === 'label')
    )
    expect(actionLabels.every(Boolean)).toBe(true)
  })

  test('keeps Recovery in a compact local 2+1 well beneath Input', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const first = syncAppScreenFlowScene(graph, page.id, SAVE_FINDING_RECOVERY_APP_FLOW)
    const firstChildIds = graph.getChildren(page.id).map((node) => node.id)
    const children = graph.getChildren(page.id)
    const frames = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'smylr-code-object-frame'
    )
    const feedback = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-feedback'
    )
    const lanes = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-lane'
    )

    expect(first.changed).toBe(true)
    expect(frames).toHaveLength(2)
    expect(
      frames.every((frame) => appScreenFlowPluginValue(frame, 'renderMedium') === 'code-object')
    ).toBe(true)
    expect(feedback).toHaveLength(3)
    expect(feedback.map(({ height, width, x, y }) => ({ height, width, x, y }))).toEqual([
      { height: 144, width: 336, x: 304, y: 720 },
      { height: 144, width: 336, x: 760, y: 720 },
      { height: 144, width: 336, x: 528, y: 984 }
    ])
    expect(lanes).toHaveLength(0)
    expect(feedback.map((card) => appScreenFlowPluginValue(card, 'flowTone'))).toEqual([
      'coral',
      'amber',
      'amber'
    ])
    expect(
      feedback.map((card) => graph.getChildren(card.id).find((node) => node.text)?.text)
    ).toEqual(['SAVE FAILED', 'DRAFT PRESERVED', 'READY TO RETRY'])
    expect(
      feedback.map((card) =>
        graph
          .getChildren(card.id)
          .filter((node) => node.type === 'TEXT')
          .map((node) => node.fontSize)
      )
    ).toEqual([
      [16, 26, 18],
      [16, 26, 18],
      [16, 26, 18]
    ])
    expect(
      SAVE_FINDING_RECOVERY_APP_FLOW.edges.map((edge) => `${edge.sourceId}->${edge.targetId}`)
    ).toContain('preserved-draft->edit-rework')
    const [saveFailure, preservedDraft, retry] = feedback
    if (!saveFailure || !preservedDraft || !retry) {
      throw new Error('Recovery well cards were not created')
    }
    expect(preservedDraft.x - (saveFailure.x + saveFailure.width)).toBe(120)
    expect(retry.y - (saveFailure.y + saveFailure.height)).toBe(120)
    expect(saveFailure.x).toBeGreaterThanOrEqual(frames[0]?.x ?? 0)
    expect(preservedDraft.x + preservedDraft.width).toBeLessThanOrEqual(
      (frames[0]?.x ?? 0) + (frames[0]?.width ?? 0)
    )
    const recoveryEdges = children.filter(
      (node) =>
        appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-edge' &&
        appScreenFlowPluginValue(node, 'edgeKind') === 'feedback'
    )
    expect(
      recoveryEdges.slice(0, 3).map((edge) => appScreenFlowPluginValue(edge, 'routeChannel'))
    ).toEqual(['direct-vertical', 'direct-horizontal', 'direct-vertical'])
    expect(appScreenFlowPluginValue(recoveryEdges[3], 'routeChannel')).toMatch(/^outside:left/)
    const savedFrame = frames[1]
    if (!savedFrame) throw new Error('Saved screen was not created')
    expect(recoveryEdges.every((edge) => edge.x + edge.width < savedFrame.x)).toBe(true)
    const failureEdge = recoveryEdges[0]
    if (!failureEdge) throw new Error('Save failure path was not created')
    expect(failureEdge.x).toBeGreaterThanOrEqual(frames[0]?.x ?? 0)
    expect(failureEdge.x + failureEdge.width).toBeLessThanOrEqual(
      (frames[0]?.x ?? 0) + (frames[0]?.width ?? 0)
    )
    expect(screenEvidenceShare(children)).toBeGreaterThanOrEqual(0.44)

    const second = syncAppScreenFlowScene(graph, page.id, SAVE_FINDING_RECOVERY_APP_FLOW)
    expect(second.changed).toBe(false)
    expect(graph.getChildren(page.id).map((node) => node.id)).toEqual(firstChildIds)
  })

  test('keeps Technical Flow diagram-only, owned, and idempotent', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const first = syncTechnicalFlowScene(graph, page.id)
    const children = graph.getChildren(page.id)
    const frames = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'smylr-code-object-frame'
    )
    const owner = children.find(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'technical-flow-mermaid'
    )

    expect(first.changed).toBe(true)
    expect(first.ownerId).toBe(owner?.id)
    expect(first.screenIds).toEqual([])
    expect(frames).toHaveLength(0)
    expect({ x: owner?.x, y: owner?.y }).toEqual({ x: 320, y: 160 })
    expect(
      owner?.pluginData.find(
        (entry) => entry.pluginId === 'open-pencil' && entry.key === 'mermaid/source'
      )?.value
    ).toBe(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE)
    expect(graph.getChildren(owner?.id ?? '').length).toBeGreaterThan(10)
    expect(children.some((node) => node.name === 'Mermaid diagram')).toBe(false)
    expect(children.some((node) => node.name === 'Toggle / Live')).toBe(false)
    expect(
      children.some((node) => appScreenFlowPluginValue(node, 'kind') === 'smylr-board-guide')
    ).toBe(false)

    const legacyFrame = graph.createNode('FRAME', page.id, {
      name: 'Technical Flow — Save Finding / legacy web view',
      pluginData: [
        {
          key: 'flowId',
          pluginId: 'smylr-production',
          value: 'technical-flow-save-finding'
        }
      ]
    })
    const legacyGuide = graph.createNode('SECTION', page.id, {
      name: 'Technical Flow — Save Finding',
      pluginData: [
        { key: 'kind', pluginId: 'smylr-production', value: 'smylr-board-guide' },
        {
          key: 'sourceFile',
          pluginId: 'smylr-production',
          value: 'technical-flow-save-finding.md'
        }
      ]
    })
    const unrelatedMermaid = graph.createNode('GROUP', page.id, {
      name: 'Mermaid diagram',
      pluginData: [
        { key: 'mermaid/diagram-id', pluginId: 'open-pencil', value: 'unrelated-diagram' },
        {
          key: 'mermaid/source',
          pluginId: 'open-pencil',
          value: 'flowchart LR\n  unrelated-a --> unrelated-b'
        },
        { key: 'mermaid/role', pluginId: 'open-pencil', value: 'diagram' }
      ]
    })
    const unrelatedToggle = graph.createNode('FRAME', page.id, { name: 'Toggle / Live' })
    const unrelated = graph.createNode('FRAME', page.id, { name: 'User annotation' })

    const legacyFrameId = legacyFrame.id
    const legacyGuideId = legacyGuide.id
    const unrelatedMermaidId = unrelatedMermaid.id
    const unrelatedToggleId = unrelatedToggle.id
    const unrelatedId = unrelated.id
    const firstChildIds = graph.getChildren(page.id).map((node) => node.id)
    const second = syncTechnicalFlowScene(graph, page.id)
    expect(second.changed).toBe(true)
    expect(second.ownerId).toBe(first.ownerId)
    expect(graph.getNode(legacyFrameId)).toBeUndefined()
    expect(graph.getNode(legacyGuideId)).toBeUndefined()
    expect(graph.getNode(unrelatedMermaidId)?.name).toBe('Mermaid diagram')
    expect(graph.getNode(unrelatedToggleId)?.name).toBe('Toggle / Live')
    expect(graph.getNode(unrelatedId)?.name).toBe('User annotation')

    const thirdChildIds = graph.getChildren(page.id).map((node) => node.id)
    const third = syncTechnicalFlowScene(graph, page.id)
    expect(third.changed).toBe(false)
    expect(third.ownerId).toBe(first.ownerId)
    expect(graph.getChildren(page.id).map((node) => node.id)).toEqual(thirdChildIds)
    expect(thirdChildIds).not.toEqual(firstChildIds)
  })

  test('creates the stable Technical Flow owner beside an unrelated Mermaid owner', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const unrelatedMermaid = graph.createNode('GROUP', page.id, {
      height: 120,
      name: 'Mermaid diagram',
      pluginData: [
        { key: 'mermaid/diagram-id', pluginId: 'open-pencil', value: 'unrelated-diagram' },
        {
          key: 'mermaid/source',
          pluginId: 'open-pencil',
          value: 'flowchart LR\n  unrelated-a --> unrelated-b'
        },
        { key: 'mermaid/role', pluginId: 'open-pencil', value: 'diagram' }
      ],
      width: 220,
      x: 40,
      y: 60
    })
    const unrelatedChild = graph.createNode('RECTANGLE', unrelatedMermaid.id, {
      height: 80,
      name: 'Unrelated Mermaid node',
      width: 140
    })
    const unrelatedMermaidId = unrelatedMermaid.id
    const unrelatedChildId = unrelatedChild.id
    const unrelatedSnapshot = {
      height: unrelatedMermaid.height,
      name: unrelatedMermaid.name,
      pluginData: structuredClone(unrelatedMermaid.pluginData),
      width: unrelatedMermaid.width,
      x: unrelatedMermaid.x,
      y: unrelatedMermaid.y
    }

    const first = syncTechnicalFlowScene(graph, page.id)
    const technicalOwner = graph.getNode(first.ownerId ?? '')

    expect(first.changed).toBe(true)
    expect(first.ownerId).toBe('smylr-technical-flow-save-finding-mermaid')
    expect(technicalOwner?.name).toBe('Mermaid · Flowchart')
    expect(graph.getNode(unrelatedMermaidId)).toMatchObject(unrelatedSnapshot)
    expect(graph.getNode(unrelatedChildId)?.name).toBe('Unrelated Mermaid node')
    expect(
      graph.getChildren(page.id).filter((node) => mermaidDiagramOwner(graph, node.id))
    ).toHaveLength(2)

    const second = syncTechnicalFlowScene(graph, page.id)
    expect(second.changed).toBe(false)
    expect(graph.getNode(unrelatedMermaidId)).toMatchObject(unrelatedSnapshot)
    expect(graph.getNode(unrelatedChildId)?.name).toBe('Unrelated Mermaid node')
  })

  test('migrates a legacy Mermaid owner without role metadata in place', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    syncTechnicalFlowScene(graph, page.id)
    const owner = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'kind') === 'technical-flow-mermaid')
    if (!owner) throw new Error('Expected Technical Flow Mermaid owner')
    const diagramId = owner.pluginData.find(
      (entry) => entry.pluginId === 'open-pencil' && entry.key === 'mermaid/diagram-id'
    )?.value
    if (!diagramId) throw new Error('Expected Mermaid diagram identity')

    graph.updateNode(owner.id, {
      height: 262,
      name: 'Mermaid diagram',
      pluginData: owner.pluginData.filter(
        (entry) => !(entry.pluginId === 'open-pencil' && entry.key === 'mermaid/role')
      ),
      width: 1061,
      x: 109,
      y: 229
    })
    const unrelated = graph.createNode('FRAME', page.id, { name: 'User annotation' })

    const migrated = syncTechnicalFlowScene(graph, page.id)
    const nextOwner = graph.getNode(owner.id)
    if (!nextOwner) throw new Error('Expected migrated Mermaid owner')

    expect(migrated.changed).toBe(true)
    expect(migrated.ownerId).toBe(owner.id)
    expect(nextOwner.name).toBe('Mermaid · Flowchart')
    expect({ x: nextOwner.x, y: nextOwner.y }).toEqual({ x: 320, y: 160 })
    expect(nextOwner.width).toBeGreaterThan(0)
    expect(nextOwner.height).toBeGreaterThan(0)
    expect(
      nextOwner.pluginData.find(
        (entry) => entry.pluginId === 'open-pencil' && entry.key === 'mermaid/diagram-id'
      )?.value
    ).toBe(diagramId)
    expect(
      nextOwner.pluginData.find(
        (entry) => entry.pluginId === 'open-pencil' && entry.key === 'mermaid/source'
      )?.value
    ).toBe(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE)
    expect(graph.getNode(unrelated.id)?.name).toBe('User annotation')
    expect(
      graph
        .getChildren(page.id)
        .filter((node) => appScreenFlowPluginValue(node, 'kind') === 'technical-flow-mermaid')
    ).toHaveLength(1)

    const firstChildIds = graph.getChildren(page.id).map((node) => node.id)
    const second = syncTechnicalFlowScene(graph, page.id)
    expect(second.changed).toBe(false)
    expect(second.ownerId).toBe(owner.id)
    expect(graph.getChildren(page.id).map((node) => node.id)).toEqual(firstChildIds)
  })
})
