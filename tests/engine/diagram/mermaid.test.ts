import { describe, expect, test } from 'bun:test'

import { parseColor } from '@open-pencil/core/color'
import {
  createMermaidSceneSpec,
  MERMAID_DIAGRAM_REVISION,
  MERMAID_PARSER,
  MERMAID_SVG_PARSER,
  isMermaidDiagramContainer,
  mermaidDiagramName,
  parseMermaidDiagram,
  type MermaidDiagram
} from '@open-pencil/core/diagram'
import {
  createEditor,
  mermaidDiagramOwner,
  reconcileMermaidDiagramSource
} from '@open-pencil/core/editor'
import { generateId, type SceneNode } from '@open-pencil/scene-graph'

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

function descendantIds(editor: ReturnType<typeof createEditor>, ownerId: string): string[] {
  const ids: string[] = []
  const visit = (parentId: string): void => {
    const parent = editor.graph.getNode(parentId)
    for (const childId of parent?.childIds ?? []) {
      ids.push(childId)
      visit(childId)
    }
  }
  visit(ownerId)
  return ids
}

describe('Mermaid diagram conversion', () => {
  test('names frontmatter and alias diagrams by modality', () => {
    expect(
      mermaidDiagramName(`---\nconfig:\n  sankey:\n    showValues: true\n---\nsankey-beta\nA,B,1`)
    ).toBe('Mermaid · Sankey')
    expect(mermaidDiagramName('graph TD\nA --> B')).toBe('Mermaid · Flowchart')
    expect(mermaidDiagramName('C4Container\nContainer(app, "App")')).toBe('Mermaid · C4')
    expect(mermaidDiagramName('radar-beta\naxis speed["Speed"]')).toBe('Mermaid · Radar')
    expect(mermaidDiagramName('treemap-beta\n"Product"')).toBe('Mermaid · Treemap')
  })

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
      scene.nodes.filter((node) => node.type === 'GROUP').map((node) => node.props.name)
    ).toEqual(expect.arrayContaining(['Start', 'Ready?', 'Diagram connector']))
    expect(scene.nodes.filter((node) => node.parentKey).length).toBeGreaterThanOrEqual(6)
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

  test('maps rendered Mermaid rectangles to editable rounded native shapes', () => {
    const startColor = parseColor('#4C6EF5')
    const endColor = parseColor('#845EF7')
    const scene = createMermaidSceneSpec({
      appearance: 'light',
      source: 'flowchart LR\nA[Draft] --> B[Review]',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      files: {},
      elements: [
        {
          id: 'draft-node',
          type: 'rectangle',
          name: 'Draft',
          x: 10,
          y: 20,
          width: 120,
          height: 56,
          cornerRadius: 10,
          backgroundColor: '#ECECFF',
          strokeColor: '#9370DB',
          strokeWidth: 2,
          strokeDasharray: [6, 4],
          strokeLineCap: 'round',
          fillOpacity: 0.5,
          opacity: 0.8,
          blendMode: 'SCREEN',
          fillPaint: {
            type: 'GRADIENT_LINEAR',
            color: startColor,
            opacity: 1,
            visible: true,
            gradientStops: [
              { color: startColor, position: 0 },
              { color: endColor, position: 1 }
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

    expect(scene.nodes).toHaveLength(1)
    expect(scene.nodes[0]).toMatchObject({
      type: 'RECTANGLE',
      props: {
        blendMode: 'SCREEN',
        cornerRadius: 10,
        height: 56,
        width: 120,
        fills: [
          {
            type: 'GRADIENT_LINEAR',
            opacity: 0.4,
            gradientStops: [
              { color: startColor, position: 0 },
              { color: endColor, position: 1 }
            ]
          }
        ],
        strokes: [{ cap: 'ROUND', dashPattern: [6, 4], weight: 2 }]
      }
    })
  })

  test('preserves an unfilled diamond without crashing', () => {
    const scene = createMermaidSceneSpec({
      source: 'flowchart TD\nA{Decision}',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_PARSER,
      files: {},
      elements: [
        {
          id: 'decision',
          type: 'diamond',
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          backgroundColor: 'none',
          strokeColor: '#9370DB'
        }
      ]
    })

    expect(scene.nodes[0]?.type).toBe('VECTOR')
    expect(scene.nodes[0]?.props.fills).toEqual([])
  })

  test('does not treat legacy Mermaid frames as current native owners', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const legacy = editor.graph.createNode('FRAME', pageId, {
      width: 200,
      height: 100,
      pluginData: [
        { pluginId: 'open-pencil', key: 'mermaid/diagram-id', value: 'legacy' },
        { pluginId: 'open-pencil', key: 'mermaid/source', value: 'flowchart TD\nA --> B' }
      ]
    })
    editor.graph.createNode('RECTANGLE', legacy.id, { width: 80, height: 40 })

    expect(isMermaidDiagramContainer(legacy)).toBe(false)
  })

  test('repairs low-contrast SVG connectors for a dark canvas', () => {
    const scene = createMermaidSceneSpec({
      appearance: 'dark',
      source: 'mindmap\n root((Readable))',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      files: {},
      elements: [
        {
          id: 'connector',
          type: 'path',
          path: 'M 0 0 L 120 80',
          strokeColor: '#111111',
          strokeWidth: 2
        }
      ]
    })

    expect(scene.nodes[0]?.props.strokes?.[0]?.color).toEqual(parseColor('#d7d9df'))
  })

  test('repairs low-contrast SVG path fills for a dark canvas', () => {
    const scene = createMermaidSceneSpec({
      appearance: 'dark',
      source: 'pie\n"Hidden" : 1',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      files: {},
      elements: [
        {
          id: 'slice',
          type: 'path',
          path: 'M 0 0 H 40 V 40 H 0 Z',
          backgroundColor: '#111111',
          strokeColor: 'none'
        }
      ]
    })

    expect(scene.nodes[0]?.props.fills?.[0]?.color).toEqual(parseColor('#646976'))
  })

  test('stores source alpha once in native paint opacity', () => {
    const scene = createMermaidSceneSpec({
      appearance: 'light',
      source: 'flowchart TD\nA[Transparent]',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      files: {},
      elements: [
        {
          id: 'transparent-node',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          backgroundColor: 'rgba(51, 102, 153, 0.5)',
          strokeColor: 'rgba(34, 68, 102, 0.5)'
        }
      ]
    })

    expect(scene.nodes[0]?.props.fills?.[0]).toMatchObject({
      color: { a: 1 },
      opacity: 0.5
    })
    expect(scene.nodes[0]?.props.strokes?.[0]).toMatchObject({
      color: { a: 1 },
      opacity: 0.5
    })

    const connector = createMermaidSceneSpec({
      appearance: 'light',
      source: 'flowchart TD\nA --> B',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_PARSER,
      files: {},
      elements: [
        {
          id: 'transparent-connector',
          type: 'arrow',
          points: [
            [0, 0],
            [100, 0]
          ],
          strokeColor: 'rgba(34, 68, 102, 0.5)'
        }
      ]
    })
    expect(
      connector.nodes.find((node) => node.type === 'VECTOR')?.props.strokes?.[0]
    ).toMatchObject({
      color: { a: 1 },
      opacity: 0.5
    })

    const svgConnector = createMermaidSceneSpec({
      appearance: 'light',
      source: 'flowchart TD\nA --> B',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      files: {},
      elements: [
        {
          id: 'transparent-svg-connector',
          type: 'path',
          path: 'M 0 0 L 100 0',
          strokeColor: '#224466',
          strokeOpacity: 0.35,
          endArrowhead: 'arrow'
        }
      ]
    })
    expect(
      svgConnector.nodes.find((node) => node.props.name === 'Arrowhead')?.props.fills?.[0]
    ).toMatchObject({ color: { a: 1 }, opacity: 0.35 })
  })

  test('uses the bundled font for rendered Mermaid SVG text', () => {
    const scene = createMermaidSceneSpec({
      source: 'sankey-beta\nSource,Target,10',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      files: {},
      elements: [
        {
          id: 'source-label',
          type: 'text',
          text: 'Source 10',
          x: 10,
          y: 20,
          width: 80,
          height: 20,
          fontFamily: 'trebuchet ms',
          fontSize: 14,
          rotation: 30,
          strokeColor: '#333333'
        }
      ]
    })

    expect(scene.nodes[0]?.type).toBe('TEXT')
    expect(scene.nodes[0]?.props.fontFamily).toBe('Inter')
    expect(scene.nodes[0]?.props.rotation).toBe(30)
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
        },
        {
          id: 'dark-theme-label',
          type: 'text',
          text: 'Dark theme label',
          x: 0,
          y: 60,
          width: 120,
          height: 20,
          strokeColor: 'rgb(31, 32, 32)'
        }
      ]
    })
    const shape = scene.nodes.find((node) => node.type === 'RECTANGLE')
    const labels = scene.nodes.filter((node) => node.type === 'TEXT')
    const connector = scene.nodes.find(
      (node) => node.type === 'VECTOR' && node.props.name === 'Diagram connector'
    )

    expect(shape?.props.fills?.[0]?.color).toEqual(parseColor('#24262c'))
    expect(shape?.props.strokes?.[0]?.color).toEqual(parseColor('#d7d9df'))
    expect(labels.map((label) => label.props.fills?.[0]?.color)).toEqual([
      parseColor('#f4f5f7'),
      parseColor('#f4f5f7')
    ])
    expect(connector?.props.strokes?.[0]?.color).toEqual(parseColor('#d7d9df'))
  })

  test('preserves readable Mermaid neutrals for a light canvas', () => {
    const scene = createMermaidSceneSpec({
      appearance: 'light',
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
        }
      ]
    })
    const shape = scene.nodes.find((node) => node.type === 'RECTANGLE')
    const label = scene.nodes.find((node) => node.type === 'TEXT')

    expect(scene.appearance).toBe('light')
    expect(shape?.props.fills?.[0]?.color).toEqual(parseColor('#ffffff'))
    expect(shape?.props.strokes?.[0]?.color).toEqual(parseColor('#1b1b1f'))
    expect(label?.props.fills?.[0]?.color).toEqual(parseColor('#1b1b1f'))
  })

  test('repairs unreadable text against its native Mermaid shape', () => {
    const scene = createMermaidSceneSpec({
      appearance: 'light',
      source: 'mindmap\n root((Product))',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      files: {},
      elements: [
        {
          id: 'root-shape',
          type: 'path',
          x: 0,
          y: 0,
          width: 160,
          height: 80,
          path: 'M 0 0 H 160 V 80 H 0 Z',
          backgroundColor: '#0000ff',
          strokeColor: '#0000ff'
        },
        {
          id: 'root-label',
          type: 'text',
          text: 'Product',
          x: 40,
          y: 25,
          width: 80,
          height: 24,
          strokeColor: '#000000'
        }
      ]
    })
    const label = scene.nodes.find((node) => node.type === 'TEXT')

    expect(label?.props.fills?.[0]?.color).toEqual(parseColor('#f4f5f7'))
  })

  test('uses strict black or white when a mid-tone Mermaid shape needs it', () => {
    const scene = createMermaidSceneSpec({
      appearance: 'dark',
      source: 'gitGraph\n commit\n branch feature',
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      files: {},
      elements: [
        {
          id: 'branch-label-background',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 32,
          backgroundColor: '#797d7d'
        },
        {
          id: 'branch-label',
          type: 'text',
          text: 'main',
          x: 20,
          y: 6,
          width: 60,
          height: 20,
          strokeColor: '#e2dcd6'
        }
      ]
    })
    const label = scene.nodes.find((node) => node.type === 'TEXT')

    expect(label?.props.fills?.[0]?.color).toEqual(parseColor('#000000'))
  })

  test('inserts editable pieces inside one owning group and restores one undo entry', () => {
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
      type: 'GROUP',
      name: 'Mermaid · Flowchart',
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
    expect(descendantIds(editor, owner.id).sort()).toEqual([...nodeIds].sort())
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

    expect(reconcileMermaidDiagramSource(editor.graph, owner.id)).toMatchObject({
      status: 'current',
      source: scene.source,
      revision: 1
    })
    editor.graph.nodes.set(
      firstNode.id,
      Object.fromEntries(Object.entries(firstNode).toReversed()) as SceneNode
    )
    expect(reconcileMermaidDiagramSource(editor.graph, owner.id)).toMatchObject({
      status: 'current',
      source: scene.source,
      revision: 1
    })
    editor.graph.updateNode(owner.id, { x: owner.x + 40, y: owner.y + 40 })
    expect(reconcileMermaidDiagramSource(editor.graph, owner.id)).toMatchObject({
      status: 'current',
      source: scene.source,
      revision: 1
    })
    const label = nodeIds
      .map((id) => editor.graph.getNode(id))
      .find((node) => node?.type === 'TEXT')
    if (!label) throw new Error('Expected Mermaid label')
    editor.graph.updateNode(label.id, { text: 'Changed natively' })
    expect(reconcileMermaidDiagramSource(editor.graph, label.id)).toMatchObject({
      status: 'unsupported',
      source: scene.source,
      revision: 1
    })

    const currentPage = getNodeOrThrow(editor.graph, editor.state.currentPageId)
    const attachedPageChildIds = [...currentPage.childIds]
    editor.graph.updateNode(currentPage.id, {
      childIds: currentPage.childIds.filter((id) => id !== owner.id)
    })
    expect(mermaidDiagramOwner(editor.graph, owner.id)).toBeNull()
    expect(reconcileMermaidDiagramSource(editor.graph, owner.id)).toBeNull()
    editor.graph.updateNode(currentPage.id, { childIds: attachedPageChildIds })

    editor.undo.undo()
    expect(editor.graph.getNode(owner.id)).toBeUndefined()
    expect(nodeIds.every((id) => editor.graph.getNode(id) === undefined)).toBe(true)
    expect(editor.state.selectedIds).toEqual(new Set([previousId]))

    editor.undo.redo()
    expect(descendantIds(editor, owner.id).sort()).toEqual([...nodeIds].sort())
    expect(editor.state.selectedIds).toEqual(new Set([owner.id]))
  })

  test('updates a Mermaid diagram in place with one undo entry', () => {
    const editor = createEditor()
    const original = createMermaidSceneSpec(exampleDiagram())
    const originalNodeIds = editor.insertMermaidDiagram(original, { x: 160, y: 240 })
    const ownerId = [...editor.state.selectedIds][0]
    if (!ownerId) throw new Error('Expected selected Mermaid owner')
    const originalOwner = getNodeOrThrow(editor.graph, ownerId)
    const diagramId = originalOwner.pluginData.find(
      (entry) => entry.key === 'mermaid/diagram-id'
    )?.value
    if (!diagramId) throw new Error('Expected Mermaid diagram identity')

    const replacement = createMermaidSceneSpec({
      ...exampleDiagram(),
      source: 'flowchart LR\n A[Updated] --> B[Ready]',
      elements: [
        {
          id: 'A',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 120,
          height: 50,
          backgroundColor: '#E7F5FF',
          strokeColor: '#1971C2',
          strokeWidth: 2,
          label: { text: 'Updated', fontSize: 16 }
        }
      ]
    })
    const replacementNodeIds = editor.replaceMermaidDiagram(ownerId, replacement)
    const replacementOwner = getNodeOrThrow(editor.graph, ownerId)

    expect(replacementOwner.id).toBe(ownerId)
    expect(replacementOwner.x).toBe(160)
    expect(replacementOwner.y).toBe(240)
    expect(replacementOwner.pluginData).toContainEqual({
      pluginId: 'open-pencil',
      key: 'mermaid/diagram-id',
      value: diagramId
    })
    expect(replacementOwner.pluginData).toContainEqual({
      pluginId: 'open-pencil',
      key: 'mermaid/source',
      value: replacement.source
    })
    expect(replacementNodeIds).not.toEqual(originalNodeIds)
    expect(reconcileMermaidDiagramSource(editor.graph, ownerId)).toMatchObject({
      status: 'current',
      source: replacement.source
    })

    editor.undo.undo()
    expect(getNodeOrThrow(editor.graph, ownerId).pluginData).toContainEqual({
      pluginId: 'open-pencil',
      key: 'mermaid/source',
      value: original.source
    })
    expect(descendantIds(editor, ownerId).sort()).toEqual([...originalNodeIds].sort())

    editor.undo.redo()
    expect(getNodeOrThrow(editor.graph, ownerId).pluginData).toContainEqual({
      pluginId: 'open-pencil',
      key: 'mermaid/source',
      value: replacement.source
    })
    expect(descendantIds(editor, ownerId).sort()).toEqual([...replacementNodeIds].sort())
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
    const pageIdsBefore = editor.graph.getPages().map((page) => page.id)

    const nodeIds = editor.insertMermaidDiagram(createMermaidSceneSpec(exampleDiagram()), {
      x: 40,
      y: 60
    })
    const ownerId = [...editor.state.selectedIds][0]

    expect(editor.graph.getPages().map((page) => page.id)).toEqual(pageIdsBefore)
    expect(reservedIds).not.toContain(ownerId)
    expect(nodeIds.every((id) => !reservedIds.includes(id))).toBe(true)
    expect(reservedIds.every((id) => editor.graph.getNode(id)?.type === 'CANVAS')).toBe(true)
  })
})
