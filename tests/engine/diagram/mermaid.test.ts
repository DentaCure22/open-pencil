import { describe, expect, test } from 'bun:test'

import {
  createMermaidSceneSpec,
  createMermaidSvgSpec,
  isMermaidDiagramContainer,
  mermaidDiagramName,
  MERMAID_DIAGRAM_REVISION,
  MERMAID_SVG_PARSER,
  type MermaidDiagram
} from '@open-pencil/core/diagram'
import {
  createEditor,
  mermaidDiagramOwner,
  reconcileMermaidDiagramSource
} from '@open-pencil/core/editor'
import { generateId } from '@open-pencil/scene-graph'

import { getNodeOrThrow } from '#tests/helpers/assert'

const SOURCE = 'flowchart LR\n A[Start] --> B{Ready?}'

function renderedDiagram(source = SOURCE): MermaidDiagram {
  return {
    appearance: 'light',
    source,
    revision: MERMAID_DIAGRAM_REVISION,
    parser: MERMAID_SVG_PARSER,
    svg: '<svg viewBox="0 0 640 320"></svg>',
    width: 640,
    height: 320
  }
}

describe('Mermaid SVG diagrams', () => {
  test('names public Mermaid modalities', () => {
    expect(mermaidDiagramName('ishikawa-beta\n"Cause"')).toBe('Mermaid · Diagram')
    expect(mermaidDiagramName('ishikawa\n"Cause"')).toBe('Mermaid · Ishikawa')
    expect(mermaidDiagramName('venn\nset A')).toBe('Mermaid · Venn')
    expect(mermaidDiagramName('treeview\nroot')).toBe('Mermaid · Tree view')
    expect(mermaidDiagramName('graph TD\nA --> B')).toBe('Mermaid · Flowchart')
  })

  test('creates one source-backed SVG spec without native child specifications', () => {
    const scene = createMermaidSvgSpec(`  ${SOURCE}  `)

    expect(scene).toEqual({
      appearance: 'dark',
      source: SOURCE,
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      width: 720,
      height: 480
    })
    expect(scene).not.toHaveProperty('nodes')
    expect(scene).not.toHaveProperty('mode')
  })

  test('keeps the official Mermaid SVG and measured dimensions', () => {
    const scene = createMermaidSceneSpec(renderedDiagram())

    expect(scene).toMatchObject({
      appearance: 'light',
      source: SOURCE,
      parser: MERMAID_SVG_PARSER,
      svg: '<svg viewBox="0 0 640 320"></svg>',
      width: 640,
      height: 320
    })
  })

  test('inserts one selectable frame and restores it through Undo and Redo', () => {
    const editor = createEditor()
    const previousId = editor.createShape('RECTANGLE', 0, 0, 40, 40)
    editor.select([previousId])
    const scene = createMermaidSceneSpec(renderedDiagram())

    const nodeIds = editor.insertMermaidDiagram(scene, { x: 400, y: 300 })
    const ownerId = nodeIds[0]
    if (!ownerId) throw new Error('Expected Mermaid owner')
    const owner = getNodeOrThrow(editor.graph, ownerId)

    expect(nodeIds).toEqual([owner.id])
    expect(owner).toMatchObject({
      type: 'FRAME',
      name: 'Mermaid · Flowchart',
      x: 400,
      y: 300,
      width: 640,
      height: 320,
      childIds: []
    })
    expect(isMermaidDiagramContainer(owner)).toBe(true)
    expect(mermaidDiagramOwner(editor.graph, owner.id)?.id).toBe(owner.id)
    expect(reconcileMermaidDiagramSource(editor.graph, owner.id)).toMatchObject({
      status: 'current',
      source: SOURCE
    })

    editor.undo.undo()
    expect(editor.graph.getNode(owner.id)).toBeUndefined()
    expect(editor.state.selectedIds).toEqual(new Set([previousId]))

    editor.undo.redo()
    expect(getNodeOrThrow(editor.graph, owner.id).childIds).toEqual([])
    expect(editor.state.selectedIds).toEqual(new Set([owner.id]))
  })

  test('rewrites only the source while preserving frame identity and geometry', () => {
    const editor = createEditor()
    const original = createMermaidSceneSpec(renderedDiagram())
    const ownerId = editor.insertMermaidDiagram(original, { x: 160, y: 240 })[0]
    if (!ownerId) throw new Error('Expected Mermaid owner')
    editor.graph.updateNode(ownerId, { width: 900, height: 500 })
    const diagramId = getNodeOrThrow(editor.graph, ownerId).pluginData.find(
      (entry) => entry.key === 'mermaid/diagram-id'
    )?.value

    const replacement = createMermaidSvgSpec('sequenceDiagram\n A->>B: Updated')
    expect(editor.replaceMermaidDiagram(ownerId, replacement)).toEqual([ownerId])
    const owner = getNodeOrThrow(editor.graph, ownerId)

    expect(owner).toMatchObject({ x: 160, y: 240, width: 900, height: 500, childIds: [] })
    expect(owner.pluginData).toContainEqual({
      pluginId: 'open-pencil',
      key: 'mermaid/diagram-id',
      value: diagramId
    })
    expect(owner.pluginData).toContainEqual({
      pluginId: 'open-pencil',
      key: 'mermaid/source',
      value: replacement.source
    })

    editor.undo.undo()
    expect(getNodeOrThrow(editor.graph, ownerId).pluginData).toContainEqual({
      pluginId: 'open-pencil',
      key: 'mermaid/source',
      value: original.source
    })
  })

  test('does not overwrite restored graph nodes when the local ID counter is behind', () => {
    const editor = createEditor()
    const seedNumber = Number.parseInt(generateId().split(':')[1] ?? '', 10)
    if (!Number.isSafeInteger(seedNumber)) throw new Error('Expected a local scene node ID')
    const reservedIds = Array.from({ length: 12 }, (_, index) => `0:${seedNumber + index + 1}`)
    for (const [index, id] of reservedIds.entries()) {
      editor.graph.createNodeWithId(id, 'CANVAS', editor.graph.rootId, {
        name: `Reserved board ${index + 1}`
      })
    }

    const ownerId = editor.insertMermaidDiagram(createMermaidSvgSpec(SOURCE), { x: 40, y: 60 })[0]

    expect(reservedIds).not.toContain(ownerId)
    expect(reservedIds.every((id) => editor.graph.getNode(id)?.type === 'CANVAS')).toBe(true)
  })
})
