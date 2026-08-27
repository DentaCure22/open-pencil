import { describe, expect, test } from 'bun:test'

import {
  CODE_OBJECT_KIND,
  CODE_OBJECT_PLUGIN_ID,
  createSmylrTrustedWebAppDocument,
  createUserCodeObjectDocument,
  isCodeObjectKind,
  normalizeCodeObjectAppearance,
  parseCodeObjectDocument,
  resolveCodeObjectAppearance,
  serializeCodeObjectPluginData,
  SMYLR_CODE_OBJECT_FRAME_KIND,
  SMYLR_PRODUCTION_PLUGIN_ID
} from '@open-pencil/core/code-object'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('Code Object persisted document contract', () => {
  test('normalizes system-aware appearance and resolves semantic token overrides', () => {
    expect(normalizeCodeObjectAppearance(undefined)).toEqual({ preference: 'system' })
    const appearance = normalizeCodeObjectAppearance({
      preference: 'system',
      tokens: {
        dark: { accent: '  #ff66cc  ', unknown: 'ignored' },
        light: { text: '#10121a' }
      }
    })

    expect(appearance).toEqual({
      preference: 'system',
      tokens: {
        dark: { accent: '#ff66cc' },
        light: { text: '#10121a' }
      }
    })
    expect(resolveCodeObjectAppearance(appearance, 'dark')).toMatchObject({
      preference: 'system',
      theme: 'dark',
      tokens: { accent: '#ff66cc' }
    })
    expect(
      resolveCodeObjectAppearance({ ...appearance, preference: 'light' }, 'dark')
    ).toMatchObject({
      preference: 'light',
      theme: 'light',
      tokens: { text: '#10121a' }
    })
  })

  test('serializes and parses one canonical user document without losing unrelated metadata', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      height: 320,
      name: 'Metric',
      pluginData: [{ key: 'other', pluginId: 'example', value: 'preserved' }],
      width: 480
    })
    const document = createUserCodeObjectDocument({
      definitionId: 'metric-card',
      name: 'Metric card',
      props: { label: 'Revenue' },
      source: 'export default function Metric() { return <strong>Revenue</strong> }',
      state: { value: 42 }
    })

    expect(document.appearance).toEqual({ preference: 'system' })

    graph.updateNode(frame.id, { pluginData: serializeCodeObjectPluginData(frame, document) })
    const persisted = graph.getNode(frame.id)

    expect(parseCodeObjectDocument(persisted)).toEqual(document)
    expect(persisted?.pluginData).toContainEqual({
      key: 'kind',
      pluginId: CODE_OBJECT_PLUGIN_ID,
      value: CODE_OBJECT_KIND
    })
    expect(persisted?.pluginData).toContainEqual({
      key: 'other',
      pluginId: 'example',
      value: 'preserved'
    })
  })

  test('fails closed for non-frames and malformed persisted envelopes', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const text = graph.createNode('TEXT', page.id, { text: 'Not a Code Object' })
    const frame = graph.createNode('FRAME', page.id, {
      height: 100,
      pluginData: [
        { key: 'kind', pluginId: CODE_OBJECT_PLUGIN_ID, value: CODE_OBJECT_KIND },
        { key: 'document', pluginId: CODE_OBJECT_PLUGIN_ID, value: '{bad json' }
      ],
      width: 100
    })

    expect(parseCodeObjectDocument(text)).toBeNull()
    expect(parseCodeObjectDocument(frame)).toBeNull()
    expect(isCodeObjectKind(text)).toBe(false)
    expect(isCodeObjectKind(frame)).toBe(true)
  })

  test('serializes the complete registered Smylr iframe contract', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      height: 720,
      pluginData: [
        { key: 'kind', pluginId: SMYLR_PRODUCTION_PLUGIN_ID, value: 'stale' },
        { key: 'flowId', pluginId: SMYLR_PRODUCTION_PLUGIN_ID, value: 'preserved' }
      ],
      width: 520
    })
    const document = createSmylrTrustedWebAppDocument({
      label: 'Analytics',
      route: '/practice-analytics'
    })

    const pluginData = serializeCodeObjectPluginData(frame, document)
    graph.updateNode(frame.id, { pluginData })

    expect(pluginData.filter(({ pluginId }) => pluginId === SMYLR_PRODUCTION_PLUGIN_ID)).toEqual([
      { key: 'flowId', pluginId: SMYLR_PRODUCTION_PLUGIN_ID, value: 'preserved' },
      {
        key: 'kind',
        pluginId: SMYLR_PRODUCTION_PLUGIN_ID,
        value: SMYLR_CODE_OBJECT_FRAME_KIND
      },
      { key: 'pageId', pluginId: SMYLR_PRODUCTION_PLUGIN_ID, value: 'analytics' },
      { key: 'route', pluginId: SMYLR_PRODUCTION_PLUGIN_ID, value: '/practice-analytics' },
      { key: 'state', pluginId: SMYLR_PRODUCTION_PLUGIN_ID, value: 'current' }
    ])
    expect(parseCodeObjectDocument(graph.getNode(frame.id))).toEqual(document)
  })
})
