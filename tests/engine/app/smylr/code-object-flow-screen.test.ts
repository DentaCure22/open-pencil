import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { codeObjectDocument, setCodeObjectDocument } from '@/app/code-object/model'
import { syncAppScreenFlowCodeObjects } from '@/app/smylr-production/app-flow/code-objects'
import {
  SCREEN_STATES_DENTAL_CHART_APP_FLOW,
  TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW
} from '@/app/smylr-production/app-flow/model'
import {
  APP_FLOW_NATIVE_REACT_MEDIUM,
  appFlowPluginData,
  appScreenFlowPluginValue,
  isCodeObjectAppFlowFrame,
  isNativeReactAppFlowFrame,
  mergeAppFlowPluginData
} from '@/app/smylr-production/app-flow/primitives'
import { syncAppScreenFlowScene } from '@/app/smylr-production/app-flow/scene'
import { syncTechnicalFlowScene } from '@/app/smylr-production/technical-flow'

function flowFrame(graph: SceneGraph, pageId: string, flowNodeId: string) {
  const frame = graph
    .getChildren(pageId)
    .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === flowNodeId)
  if (!frame) throw new Error(`Missing ${flowNodeId} flow frame`)
  return frame
}

function addLegacyNativeReactProjection(graph: SceneGraph, pageId: string) {
  for (const flowNodeId of ['input-active', 'saved-undo']) {
    const frame = flowFrame(graph, pageId, flowNodeId)
    graph.createNode('RECTANGLE', frame.id, {
      height: 80,
      name: 'Legacy native React layer',
      width: 120
    })
    graph.updateNode(frame.id, {
      pluginData: mergeAppFlowPluginData(
        frame,
        ['renderMedium'],
        [appFlowPluginData('renderMedium', APP_FLOW_NATIVE_REACT_MEDIUM)]
      )
    })
    graph.createCollection(
      `React state · ${SCREEN_STATES_DENTAL_CHART_APP_FLOW.id} · ${flowNodeId}`
    )
  }
}

describe('Code Object flow screens', () => {
  test('attaches stable Code Object documents to existing ordinary frames', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    syncAppScreenFlowScene(graph, page.id, SCREEN_STATES_DENTAL_CHART_APP_FLOW)
    const inputBefore = flowFrame(graph, page.id, 'input-active')
    const savedBefore = flowFrame(graph, page.id, 'saved-undo')

    const result = syncAppScreenFlowCodeObjects(graph, page.id, SCREEN_STATES_DENTAL_CHART_APP_FLOW)
    const input = flowFrame(graph, page.id, 'input-active')
    const saved = flowFrame(graph, page.id, 'saved-undo')

    expect(result.changed).toBe(true)
    expect(result.frameIds).toEqual([inputBefore.id, savedBefore.id])
    expect(input.id).toBe(inputBefore.id)
    expect(saved.id).toBe(savedBefore.id)
    expect(isCodeObjectAppFlowFrame(input)).toBe(true)
    expect(isCodeObjectAppFlowFrame(saved)).toBe(true)
    expect(input.childIds).toEqual([])
    expect(saved.childIds).toEqual([])
    expect(codeObjectDocument(input)).toMatchObject({
      component: 'smylr-flow-screen',
      flowId: 'dental-chart-screen-states',
      route: '/dental-chart',
      screenId: 'input-active',
      state: { saveStatus: 'draft' },
      viewState: 'charting-controls'
    })
    expect(codeObjectDocument(saved)).toMatchObject({
      component: 'smylr-flow-screen',
      screenId: 'saved-undo',
      state: { saveStatus: 'saved' }
    })
    expect(appScreenFlowPluginValue(input, 'codeObjectTrust')).toBe('openpencil-owned')
    expect(appScreenFlowPluginValue(input, 'codeObjectInteractionMode')).toBe('design-or-interact')
  })

  test('keeps frame identity and persisted interaction state on rerun', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    syncAppScreenFlowScene(graph, page.id, SCREEN_STATES_DENTAL_CHART_APP_FLOW)
    syncAppScreenFlowCodeObjects(graph, page.id, SCREEN_STATES_DENTAL_CHART_APP_FLOW)
    const input = flowFrame(graph, page.id, 'input-active')
    const document = codeObjectDocument(input)
    if (document?.component !== 'smylr-flow-screen') throw new Error('Missing Code Object document')
    setCodeObjectDocument(graph, input.id, {
      ...document,
      state: {
        condition: 'Fracture',
        detailsOpen: true,
        saveStatus: 'saved',
        selectedTooth: 17
      }
    })

    const result = syncAppScreenFlowCodeObjects(graph, page.id, SCREEN_STATES_DENTAL_CHART_APP_FLOW)
    const rerun = flowFrame(graph, page.id, 'input-active')

    expect(result.changed).toBe(false)
    expect(rerun.id).toBe(input.id)
    expect(codeObjectDocument(rerun)?.state).toEqual({
      condition: 'Fracture',
      detailsOpen: true,
      saveStatus: 'saved',
      selectedTooth: 17
    })
  })

  test('reclaims a legacy editable React projection as the one Code Object', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    syncAppScreenFlowScene(graph, page.id, SCREEN_STATES_DENTAL_CHART_APP_FLOW)
    syncAppScreenFlowCodeObjects(graph, page.id, SCREEN_STATES_DENTAL_CHART_APP_FLOW)

    addLegacyNativeReactProjection(graph, page.id)
    const native = flowFrame(graph, page.id, 'input-active')
    expect(isNativeReactAppFlowFrame(native)).toBe(true)
    expect(native.childIds.length).toBeGreaterThan(0)

    const restored = syncAppScreenFlowCodeObjects(
      graph,
      page.id,
      SCREEN_STATES_DENTAL_CHART_APP_FLOW
    )
    const live = flowFrame(graph, page.id, 'input-active')
    expect(restored.removedNativeChildren).toBeGreaterThan(0)
    expect(restored.removedVariableCollections).toBe(2)
    expect(isCodeObjectAppFlowFrame(live)).toBe(true)
    expect(live.childIds).toEqual([])
  })

  test('leaves Technical Flow owned by native Mermaid shapes without Code Objects', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    syncTechnicalFlowScene(graph, page.id, TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW)

    const result = syncAppScreenFlowCodeObjects(
      graph,
      page.id,
      TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW
    )

    expect(result.frameIds).toEqual([])
    expect(graph.getChildren(page.id).some((node) => isCodeObjectAppFlowFrame(node))).toBe(false)
  })
})
