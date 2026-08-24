import { describe, expect, test } from 'bun:test'

import { parseCodeObjectDocument } from '@open-pencil/core/code-object'
import { deserializeSceneGraph, serializeSceneGraph } from '@open-pencil/core/kiwi'

import { clearCompiledCodeObjectCache, compileCodeObjectSource } from '@/app/code-object/compiler'
import {
  CODE_OBJECT_PRESETS,
  codeObjectDocument,
  createCodeObjectBoardClient,
  createCodeObject,
  createCodeObjectFromPreset,
  createPdfDocumentDocument,
  createPptxDeckDocument,
  createSmylrFlowScreenDocument,
  createUserCodeObjectDocument,
  dispatchCodeObjectBoardAction,
  isCodeObjectFrame,
  setCodeObjectBoardShapeAccess,
  updateCodeObjectState
} from '@/app/code-object/model'
import { registeredCodeObjectAdapters } from '@/app/code-object/registry-implementation'
import { createEditorStore } from '@/app/editor/session'

describe('Code Objects', () => {
  test('keeps saved component renderers as compatibility adapters only', () => {
    expect(registeredCodeObjectAdapters()).toEqual([
      { component: 'code-starter', displayName: 'Legacy Code Starter' },
      { component: 'external-live-surface', displayName: 'External live surface' },
      { component: 'earth-signals', displayName: 'Earth signals' },
      { component: 'orbit-lab', displayName: 'Orbit lab' },
      { component: 'signal-bloom', displayName: 'Signal bloom' },
      { component: 'open-source-workspace', displayName: 'Open-source board piece' },
      { component: 'office-document', displayName: 'Document' },
      { component: 'office-spreadsheet', displayName: 'Spreadsheet' },
      { component: 'pdf-document', displayName: 'PDF document' },
      { component: 'pptx-deck', displayName: 'PowerPoint deck' },
      { component: 'smylr-flow-screen', displayName: 'Smylr flow screen' }
    ])

    const store = createEditorStore()
    const document = createSmylrFlowScreenDocument({
      flowId: 'example-flow',
      label: 'Review finding',
      route: '/dental-chart',
      screenId: 'review',
      viewState: 'saved-undo'
    })
    const frame = createCodeObject(store, {
      document,
      height: 540,
      name: 'Review finding',
      width: 860,
      x: 140,
      y: 180
    })

    expect(frame).toMatchObject({
      height: 540,
      name: 'Review finding',
      width: 860,
      x: 140,
      y: 180
    })
    expect(codeObjectDocument(frame)).toEqual(document)
    expect(parseCodeObjectDocument(frame)).toEqual(document)
  })

  test('compiles one trusted TypeScript/TSX source contract with nested components', () => {
    clearCompiledCodeObjectCache()
    const compiled = compileCodeObjectSource(`
      import { useMemo } from 'react'
      type Props = { state: { count: number } }
      function Child({ value }: { value: number }) {
        return <strong>{value}</strong>
      }
      export default function Example({ state }: Props) {
        const doubled = useMemo(() => state.count * 2, [state.count])
        return <section><Child value={doubled} /></section>
      }
    `)
    expect(compiled.error).toBeNull()
    expect(typeof compiled.component).toBe('function')

    const namedExport = compileCodeObjectSource(`
      export function ImportedCard() { return <article>Imported</article> }
    `)
    expect(namedExport.error).toBeNull()
    expect(typeof namedExport.component).toBe('function')

    const unsupported = compileCodeObjectSource(`
      import widget from 'unknown-widget'
      export default function Example() { return <div>{widget}</div> }
    `)
    expect(unsupported.component).toBeNull()
    expect(unsupported.error).toContain('can only import')
  })

  test('persists authored TSX, properties, and state on the ordinary frame', () => {
    const store = createEditorStore()
    const document = createUserCodeObjectDocument({
      definitionId: 'metric-card',
      name: 'Metric card',
      props: { label: 'Revenue' },
      source: 'export default function Metric() { return <strong>Revenue</strong> }',
      state: { value: 42 }
    })
    const frame = createCodeObject(store, {
      document,
      height: 320,
      name: document.name,
      width: 480
    })

    expect(codeObjectDocument(frame)).toEqual(document)
    expect(updateCodeObjectState(store, frame.id, { value: 84 })).toBe(true)
    const reloaded = deserializeSceneGraph(structuredClone(serializeSceneGraph(store.graph)))
    expect(codeObjectDocument(reloaded.getNode(frame.id))).toMatchObject({
      component: 'user-code',
      definitionId: 'metric-card',
      props: { label: 'Revenue' },
      source: document.source,
      state: { value: 84 }
    })
  })

  test('creates a Code Object as a normal persisted frame', () => {
    const store = createEditorStore()
    const frame = createCodeObjectFromPreset(store, 'earth-signals')
    if (!frame) throw new Error('Earth signals preset was not created')

    expect(frame).toMatchObject({
      childIds: [],
      clipsContent: true,
      fills: [],
      height: 760,
      name: 'Earth signals',
      strokes: [],
      type: 'FRAME',
      width: 760
    })
    expect(isCodeObjectFrame(frame)).toBe(true)
    expect(codeObjectDocument(frame)).toMatchObject({
      component: 'earth-signals',
      definitionId: 'openpencil.earth-signals',
      name: 'Earth signals',
      props: {},
      runtime: 'openpencil-code',
      schemaVersion: 1,
      state: { autoRotate: true, latitude: 12, longitude: -32 }
    })
    expect(codeObjectDocument(frame)?.source).toContain('EarthSignalsCodeObject')
    expect(frame.pluginData).toContainEqual({
      key: 'kind',
      pluginId: 'openpencil-code-object',
      value: 'code-object'
    })
  })

  test('persists component state and geometry through serialization', () => {
    const store = createEditorStore()
    const frame = createCodeObjectFromPreset(store, 'earth-signals')
    if (!frame) throw new Error('Earth signals preset was not created')
    store.graph.updateNode(frame.id, { height: 680, rotation: 7, width: 1040, x: 420, y: 260 })
    updateCodeObjectState(store, frame.id, {
      autoRotate: false,
      latitude: -18,
      longitude: 146
    })

    const reloaded = deserializeSceneGraph(structuredClone(serializeSceneGraph(store.graph)))
    const persisted = reloaded.getNode(frame.id)
    expect(persisted).toMatchObject({ height: 680, rotation: 7, width: 1040, x: 420, y: 260 })
    expect(codeObjectDocument(persisted)?.state).toEqual({
      autoRotate: false,
      latitude: -18,
      longitude: 146
    })
  })

  test('makes interaction state undoable and redoable', () => {
    const store = createEditorStore()
    const frame = createCodeObjectFromPreset(store, 'earth-signals')
    if (!frame) throw new Error('Earth signals preset was not created')

    expect(
      updateCodeObjectState(store, frame.id, {
        autoRotate: false,
        latitude: 28,
        longitude: 74
      })
    ).toBe(true)
    expect(codeObjectDocument(store.graph.getNode(frame.id))?.state.longitude).toBe(74)

    store.undo.undo()
    expect(codeObjectDocument(store.graph.getNode(frame.id))?.state).toEqual({
      autoRotate: true,
      latitude: 12,
      longitude: -32
    })

    store.undo.redo()
    expect(codeObjectDocument(store.graph.getNode(frame.id))?.state).toEqual({
      autoRotate: false,
      latitude: 28,
      longitude: 74
    })
  })

  test('gives an approved Code Object an undoable remote for its own native board shapes', async () => {
    const store = createEditorStore()
    const controller = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Board controller' }),
      height: 360,
      name: 'Board controller',
      width: 520,
      x: 100,
      y: 120
    })
    const dispatch = async (action: Parameters<typeof dispatchCodeObjectBoardAction>[2]) =>
      dispatchCodeObjectBoardAction(store, controller.id, action, {
        interactionEnabled: true
      })

    const deniedClient = createCodeObjectBoardClient(store, controller.id, dispatch)
    expect((await deniedClient.createShape({ kind: 'rectangle' })).reason).toBe('capability-denied')
    expect(setCodeObjectBoardShapeAccess(store, controller.id, true)).toBe(true)

    const client = createCodeObjectBoardClient(store, controller.id, dispatch)
    expect(client.permissions).toEqual([
      'shape.create',
      'shape.delete',
      'shape.update.appearance',
      'shape.update.geometry'
    ])
    const created = await client.createShape({
      fill: '#8B5CF6',
      height: 140,
      kind: 'rectangle',
      name: 'Remote card',
      width: 220,
      x: 700,
      y: 180
    })
    expect(created).toMatchObject({
      changed: true,
      shape: {
        fill: '#8B5CF6',
        height: 140,
        kind: 'rectangle',
        name: 'Remote card',
        width: 220,
        x: 700,
        y: 180
      },
      status: 'applied',
      type: 'code-object.board-shape.create'
    })
    const shapeId = created.targetNodeId
    if (!shapeId) throw new Error('Board remote did not return its native shape ID')

    const refreshed = createCodeObjectBoardClient(store, controller.id, dispatch)
    expect(refreshed.shapes.map((shape) => shape.id)).toEqual([shapeId])
    const updated = await refreshed.updateShape(shapeId, {
      fill: '#14B8A6',
      rotation: 12,
      x: 772
    })
    expect(updated).toMatchObject({
      changed: true,
      shape: { fill: '#14B8A6', rotation: 12, x: 772 },
      status: 'applied'
    })

    store.undo.undo()
    expect(store.graph.getNode(shapeId)).toMatchObject({ rotation: 0, x: 700 })
    store.undo.redo()
    expect(store.graph.getNode(shapeId)).toMatchObject({ rotation: 12, x: 772 })

    const unowned = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      height: 100,
      width: 100,
      x: 40,
      y: 40
    })
    expect((await refreshed.updateShape(unowned.id, { x: 80 })).reason).toBe('shape-not-owned')

    expect((await refreshed.deleteShape(shapeId)).status).toBe('applied')
    expect(store.graph.getNode(shapeId)).toBeUndefined()
    store.undo.undo()
    expect(store.graph.getNode(shapeId)).toMatchObject({ name: 'Remote card', x: 772 })
  })

  test('persists PowerPoint slide navigation as ordinary Code Object state', () => {
    const store = createEditorStore()
    const frame = createCodeObject(store, {
      document: createPptxDeckDocument(),
      height: 664,
      name: 'Source deck',
      width: 1180
    })

    expect(codeObjectDocument(frame)?.state).toEqual({ activeSlide: 0, view: 'deck' })
    expect(updateCodeObjectState(store, frame.id, { activeSlide: 2, view: 'deck' })).toBe(true)
    expect(codeObjectDocument(store.graph.getNode(frame.id))?.state).toEqual({
      activeSlide: 2,
      view: 'deck'
    })

    store.undo.undo()
    expect(codeObjectDocument(store.graph.getNode(frame.id))?.state).toEqual({
      activeSlide: 0,
      view: 'deck'
    })
  })

  test('persists PDF page navigation as ordinary Code Object state', () => {
    const store = createEditorStore()
    const frame = createCodeObject(store, {
      document: createPdfDocumentDocument(),
      height: 520,
      name: 'Research brief',
      width: 720
    })

    expect(codeObjectDocument(frame)?.state).toEqual({ activePage: 1, view: 'pdf' })
    expect(updateCodeObjectState(store, frame.id, { activePage: 4, view: 'pdf' })).toBe(true)
    expect(codeObjectDocument(store.graph.getNode(frame.id))?.state).toEqual({
      activePage: 4,
      view: 'pdf'
    })
    store.undo.undo()
    expect(codeObjectDocument(store.graph.getNode(frame.id))?.state).toEqual({
      activePage: 1,
      view: 'pdf'
    })
  })

  test('duplicates into an independent Code Object record', () => {
    const store = createEditorStore()
    const source = createCodeObjectFromPreset(store, 'earth-signals')
    if (!source) throw new Error('Earth signals preset was not created')
    store.duplicateSelected()
    const [duplicateId] = [...store.state.selectedIds]
    if (!duplicateId) throw new Error('Duplicate was not selected')
    const duplicate = store.graph.getNode(duplicateId)

    expect(duplicateId).not.toBe(source.id)
    expect(isCodeObjectFrame(duplicate)).toBe(true)
    expect(codeObjectDocument(duplicate)?.state).toEqual(codeObjectDocument(source)?.state)

    updateCodeObjectState(store, duplicateId, {
      autoRotate: false,
      latitude: 52,
      longitude: 118
    })
    expect(codeObjectDocument(duplicate)?.state.longitude).toBe(118)
    expect(codeObjectDocument(source)?.state.longitude).toBe(-32)
  })

  test('creates and normalizes every gallery preset', () => {
    const store = createEditorStore()
    const frames = CODE_OBJECT_PRESETS.map((preset) => createCodeObjectFromPreset(store, preset.id))
    expect(frames.every(Boolean)).toBe(true)
    expect(frames.map((frame) => codeObjectDocument(frame)?.component)).toEqual([
      'user-code',
      'user-code',
      'earth-signals',
      'orbit-lab',
      'signal-bloom',
      'open-source-workspace',
      'office-document',
      'office-spreadsheet',
      'user-code',
      'user-code',
      'user-code'
    ])

    const boardRemote = frames[1]
    const orbit = frames[3]
    const bloom = frames[4]
    const chart = frames[8]
    const form = frames[10]
    if (!boardRemote || !orbit || !bloom || !chart || !form) {
      throw new Error('Code Object presets were not created')
    }
    expect(codeObjectDocument(boardRemote)).toMatchObject({
      boardPermissions: [
        'shape.create',
        'shape.delete',
        'shape.update.appearance',
        'shape.update.geometry'
      ],
      component: 'user-code',
      definitionId: 'openpencil.board-remote',
      name: 'Board remote'
    })
    expect(codeObjectDocument(chart)).toMatchObject({
      component: 'user-code',
      definitionId: 'openpencil.analytics-chart',
      name: 'Chart',
      state: { range: '30d' }
    })
    expect(codeObjectDocument(form)).toMatchObject({
      component: 'user-code',
      definitionId: 'openpencil.interactive-form',
      name: 'Form',
      state: { email: '', name: '', status: 'draft' }
    })
    updateCodeObjectState(store, orbit.id, { energy: 99, paused: true, tilt: -90 })
    updateCodeObjectState(store, bloom.id, { frozen: true, hue: 725, spread: 0.1 })
    expect(codeObjectDocument(store.graph.getNode(orbit.id))?.state).toEqual({
      energy: 2.4,
      paused: true,
      tilt: -36
    })
    expect(codeObjectDocument(store.graph.getNode(bloom.id))?.state).toEqual({
      frozen: true,
      hue: 5,
      spread: 0.55
    })
  })

  test('creates architecture and Kanban as two independent frameless Code Objects', () => {
    const store = createEditorStore()
    const frame = createCodeObjectFromPreset(store, 'open-source-workspace', {
      x: 100,
      y: 200
    })
    if (!frame) throw new Error('Open-source surface kit was not created')
    const pageNodes = store.graph.getChildren(store.state.currentPageId)
    const architecture = pageNodes.find((node) => node.name === 'Architecture flow')
    const kanban = pageNodes.find((node) => node.name === 'Kanban board')

    expect(architecture).toMatchObject({ height: 620, type: 'FRAME', width: 1180 })
    expect(kanban).toMatchObject({ height: 620, type: 'FRAME', width: 1180 })
    expect(kanban?.x).toBe(1360)
    expect(pageNodes.some((node) => node.name === 'Architecture & Kanban')).toBe(false)
    if (!architecture || !kanban) throw new Error('Both Code Objects were not created')
    const architectureDocument = codeObjectDocument(architecture)
    const kanbanDocument = codeObjectDocument(kanban)
    if (
      architectureDocument?.component !== 'open-source-workspace' ||
      architectureDocument.state.piece !== 'architecture' ||
      kanbanDocument?.component !== 'open-source-workspace' ||
      kanbanDocument.state.piece !== 'kanban'
    ) {
      throw new Error('Architecture and Kanban state were not split correctly')
    }
    expect(
      updateCodeObjectState(store, architecture.id, {
        ...architectureDocument.state,
        nodes: architectureDocument.state.nodes.map((node) =>
          node.id === 'gateway' ? { ...node, x: 488, y: 172 } : node
        )
      })
    ).toBe(true)
    const updatedArchitecture = codeObjectDocument(store.graph.getNode(architecture.id))
    expect(
      updatedArchitecture?.component === 'open-source-workspace' &&
        updatedArchitecture.state.piece === 'architecture' &&
        updatedArchitecture.state.nodes.find((node) => node.id === 'gateway')?.x
    ).toBe(488)

    store.undo.undo()
    store.undo.undo()
    expect(store.graph.getNode(architecture.id)).toBeUndefined()
    expect(store.graph.getNode(kanban.id)).toBeUndefined()

    store.undo.redo()
    expect(isCodeObjectFrame(store.graph.getNode(architecture.id))).toBe(true)
    expect(isCodeObjectFrame(store.graph.getNode(kanban.id))).toBe(true)
  })

  test('restores the complete shape through creation undo and redo', () => {
    const store = createEditorStore()
    const frame = createCodeObjectFromPreset(store, 'earth-signals')
    if (!frame) throw new Error('Earth signals preset was not created')

    store.undo.undo()
    expect(store.graph.getNode(frame.id)).toBeUndefined()

    store.undo.redo()
    expect(isCodeObjectFrame(store.graph.getNode(frame.id))).toBe(true)
  })
})
