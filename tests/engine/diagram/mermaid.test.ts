import { describe, expect, test } from 'bun:test'

import { parseColor } from '@open-pencil/core/color'
import {
  createMermaidSceneSpec,
  MERMAID_DIAGRAM_REVISION,
  MERMAID_PARSER,
  MERMAID_SVG_PARSER,
  parseMermaidDiagram,
  type MermaidDiagram
} from '@open-pencil/core/diagram'
import { createEditor } from '@open-pencil/core/editor'

import { getNodeOrThrow } from '#tests/helpers/assert'

function exampleDiagram(): MermaidDiagram {
  return {
    source: 'flowchart LR\n A[Start] --> B{Ready?}',
    revision: MERMAID_DIAGRAM_REVISION,
    parser: MERMAID_PARSER,
    files: {},
    elements: [
      {
        id: 'A',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        backgroundColor: '#E7F5FF',
        strokeColor: '#1971C2',
        strokeWidth: 2,
        label: { text: 'Start', fontSize: 16 }
      },
      {
        id: 'B',
        type: 'diamond',
        x: 220,
        y: 10,
        width: 110,
        height: 70,
        backgroundColor: '#FFF4E6',
        strokeColor: '#D9480F',
        label: { text: 'Ready?', fontSize: 16 }
      },
      {
        id: 'A_B',
        type: 'arrow',
        x: 110,
        y: 45,
        points: [
          [0, 0],
          [55, 0],
          [110, 0]
        ],
        strokeColor: '#343A40',
        strokeWidth: 2
      }
    ]
  }
}

describe('Mermaid diagram conversion', () => {
  test('retries quoted definitions without losing the original source', async () => {
    const calls: string[] = []
    const diagram = await parseMermaidDiagram('flowchart TD\n A["Quoted"]', async (source) => {
      calls.push(source)
      if (source.includes('"')) throw new Error('quoted parse failed')
      return { elements: [{ type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }] }
    })

    expect(calls).toEqual(['flowchart TD\n A["Quoted"]', "flowchart TD\n A['Quoted']"])
    expect(diagram.source).toBe('flowchart TD\n A["Quoted"]')
    expect(diagram.parser).toBe(MERMAID_PARSER)
    expect(diagram.files).toEqual({})
  })

  test('rejects flattened Mermaid images so browser callers convert their SVG pieces', async () => {
    const diagram = await parseMermaidDiagram('architecture-beta', async () => ({
      elements: [{ type: 'image', fileId: 'architecture', x: 0, y: 0, width: 640, height: 360 }],
      files: {
        architecture: {
          id: 'architecture',
          mimeType: 'image/png',
          dataURL: 'data:image/png;base64,AQID'
        }
      }
    }))
    expect(() => createMermaidSceneSpec(diagram)).toThrow(
      'must be converted into editable SVG pieces first'
    )
  })

  test('maps containers, labels, connectors, and arrowheads to native scene nodes', () => {
    const scene = createMermaidSceneSpec(exampleDiagram())

    expect(scene.width).toBeGreaterThan(300)
    expect(scene.height).toBeGreaterThan(60)
    expect(scene.nodes.some((node) => node.type === 'RECTANGLE')).toBe(true)
    expect(scene.nodes.filter((node) => node.type === 'TEXT')).toHaveLength(2)
    expect(scene.nodes.filter((node) => node.type === 'VECTOR').length).toBeGreaterThanOrEqual(3)
    expect(scene.nodes.some((node) => node.props.name === 'Arrowhead')).toBe(true)
    expect(
      scene.nodes.some((node) =>
        node.props.pluginData?.some(
          (entry) => entry.key === 'mermaid/element-id' && entry.value === 'A'
        )
      )
    ).toBe(true)
  })

  test('maps rendered SVG paths with transforms to editable native vectors', () => {
    const scene = createMermaidSceneSpec({
      source: 'pie\n "A" : 1',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_PARSER,
      files: {},
      elements: [
        {
          id: 'slice-a',
          type: 'path',
          name: 'Pie slice',
          x: 10,
          y: 20,
          width: 80,
          height: 80,
          path: 'M 0 0 L 40 0 A 40 40 0 0 1 0 40 Z',
          transform: [2, 0, 0, 2, 10, 20],
          backgroundColor: '#4C6EF5',
          strokeColor: '#D7D9DF',
          strokeWidth: 2
        }
      ]
    })

    expect(scene.mode).toBe('editable')
    expect(scene.nodes).toHaveLength(1)
    expect(scene.nodes[0]?.type).toBe('VECTOR')
    expect(scene.nodes[0]?.props.name).toBe('Pie slice')
    expect(scene.nodes[0]?.props.vectorNetwork?.vertices.length).toBeGreaterThan(2)
    expect(scene.nodes[0]?.props.fills?.[0]?.type).toBe('SOLID')
  })

  test('preserves Mermaid SVG gradient paints, transparency, and link blending', () => {
    const sourceColor = parseColor('#4C6EF5')
    const targetColor = parseColor('#F06595')
    const scene = createMermaidSceneSpec({
      source: 'sankey-beta\nSource,Target,10',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      files: {},
      elements: [
        {
          id: 'link-1',
          type: 'path',
          name: 'Sankey link',
          x: 0,
          y: 0,
          width: 240,
          height: 80,
          path: 'M 0 10 C 80 10 160 70 240 70',
          strokeWidth: 24,
          strokeOpacity: 0.5,
          strokeLineCap: 'butt',
          blendMode: 'MULTIPLY',
          strokePaint: {
            type: 'GRADIENT_LINEAR',
            color: sourceColor,
            opacity: 1,
            visible: true,
            gradientStops: [
              { color: sourceColor, position: 0 },
              { color: targetColor, position: 1 }
            ],
            gradientTransform: {
              m00: -1,
              m01: 0,
              m02: 1,
              m10: 0,
              m11: 0,
              m12: 0
            }
          }
        }
      ]
    })

    const link = scene.nodes[0]
    expect(link?.type).toBe('VECTOR')
    expect(link?.props.blendMode).toBe('MULTIPLY')
    expect(link?.props.strokes?.[0]).toMatchObject({
      weight: 24,
      opacity: 0.5,
      paint: {
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { color: sourceColor, position: 0 },
          { color: targetColor, position: 1 }
        ]
      }
    })
    expect(link?.props.fills).toEqual([])
  })

  test('adapts Excalidraw neutral colors to the native dark canvas', () => {
    const scene = createMermaidSceneSpec({
      source: 'flowchart LR\n A[Start] --> B[Finish]',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_PARSER,
      files: {},
      elements: [
        {
          id: 'A',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          backgroundColor: '#ffffff',
          strokeColor: '#1b1b1f',
          label: { text: 'Start', strokeColor: '#1b1b1f' }
        },
        {
          id: 'A_B',
          type: 'arrow',
          x: 100,
          y: 25,
          points: [
            [0, 0],
            [100, 0]
          ],
          strokeColor: '#1b1b1f'
        }
      ]
    })
    const shape = scene.nodes.find((node) => node.type === 'RECTANGLE')
    const label = scene.nodes.find((node) => node.type === 'TEXT')
    const connector = scene.nodes.find((node) => node.props.name === 'Diagram connector')

    expect(shape?.props.fills?.[0]?.color).toEqual(parseColor('#24262c'))
    expect(shape?.props.strokes?.[0]?.color).toEqual(parseColor('#d7d9df'))
    expect(label?.props.fills?.[0]?.color).toEqual(parseColor('#f4f5f7'))
    expect(connector?.props.strokes?.[0]?.color).toEqual(parseColor('#d7d9df'))
  })

  test('inserts editable pieces inside one owning frame and restores one undo entry', () => {
    const editor = createEditor()
    const previousId = editor.createShape('RECTANGLE', 0, 0, 40, 40)
    editor.select([previousId])
    const scene = createMermaidSceneSpec(exampleDiagram())
    const pageId = editor.state.currentPageId

    const nodeIds = editor.insertMermaidDiagram(scene, { x: 400, y: 300 })
    const page = getNodeOrThrow(editor.graph, pageId)
    const owner = getNodeOrThrow(editor.graph, page.childIds.at(-1) ?? '')
    const firstNode = getNodeOrThrow(editor.graph, nodeIds[0] ?? '')
    const diagramId = firstNode.pluginData.find(
      (entry) => entry.key === 'mermaid/diagram-id'
    )?.value
    if (!diagramId) throw new Error('Expected Mermaid diagram metadata')

    expect(nodeIds).toHaveLength(scene.nodes.length)
    expect(owner).toMatchObject({
      type: 'FRAME',
      name: 'Mermaid diagram',
      parentId: pageId,
      x: 400,
      y: 300,
      width: scene.width,
      height: scene.height,
      fills: [],
      strokes: [],
      blendMode: 'NORMAL',
      clipsContent: false
    })
    expect(owner.childIds).toEqual(nodeIds)
    expect(firstNode.parentId).toBe(owner.id)
    expect(firstNode.x).toBe(scene.nodes[0]?.props.x ?? 0)
    expect(firstNode.y).toBe(scene.nodes[0]?.props.y ?? 0)
    expect(editor.graph.getAbsolutePosition(firstNode.id)).toEqual({
      x: 400 + (scene.nodes[0]?.props.x ?? 0),
      y: 300 + (scene.nodes[0]?.props.y ?? 0)
    })
    expect(owner.pluginData).toContainEqual({
      pluginId: 'open-pencil',
      key: 'mermaid/source',
      value: scene.source
    })
    expect(firstNode.pluginData).toContainEqual({
      pluginId: 'open-pencil',
      key: 'mermaid/diagram-id',
      value: diagramId
    })
    expect(firstNode.pluginData).toContainEqual({
      pluginId: 'open-pencil',
      key: 'mermaid/source',
      value: scene.source
    })
    expect(
      nodeIds.every((id) =>
        editor.graph
          .getNode(id)
          ?.pluginData.some(
            (entry) => entry.key === 'mermaid/diagram-id' && entry.value === diagramId
          )
      )
    ).toBe(true)
    expect(editor.state.selectedIds).toEqual(new Set([owner.id]))

    editor.undo.undo()
    expect(editor.graph.getNode(owner.id)).toBeUndefined()
    expect(nodeIds.every((id) => editor.graph.getNode(id) === undefined)).toBe(true)
    expect(editor.state.selectedIds).toEqual(new Set([previousId]))

    editor.undo.redo()
    expect(getNodeOrThrow(editor.graph, owner.id).childIds).toEqual(nodeIds)
    expect(nodeIds.every((id) => editor.graph.getNode(id)?.parentId === owner.id)).toBe(true)
    expect(editor.state.selectedIds).toEqual(new Set([owner.id]))
  })
})
