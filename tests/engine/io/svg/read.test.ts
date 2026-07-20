import { beforeAll, describe, expect, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile } from '@open-pencil/core'
import {
  applySVGReconciliation,
  readContentSource,
  readSourceReconciliation,
  reconcileSVGSource
} from '@open-pencil/core/io'

import { readSVGFile, svgToSceneGraph } from '#core/io/formats/svg/read'

import { getNodeOrThrow } from '#tests/helpers/assert'

const SOURCE = `<svg viewBox="0 0 100 60">
  <rect x="4" y="6" width="40" height="24" fill="#4C6EF5"/>
  <path d="M50 30 L92 30" fill="none" stroke="#CED4DA" stroke-width="2"/>
</svg>`

describe('SVG source document import', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('reuses native SVG import while retaining exact source metadata', async () => {
    const graph = await readSVGFile(new TextEncoder().encode(SOURCE), {
      fileName: 'status-flow.svg',
      mimeType: 'image/svg+xml'
    })
    const page = graph.getPages()[0]
    const frame = getNodeOrThrow(graph, page.childIds[0] ?? '')
    const children = graph.getChildren(frame.id)

    expect(page.name).toBe('status-flow')
    expect(frame.name).toBe('status-flow')
    expect(frame.type).toBe('FRAME')
    expect(children).toHaveLength(2)
    expect(children.every((node) => node.type === 'VECTOR')).toBe(true)
    expect(readContentSource(frame)).toEqual({
      format: 'svg',
      mimeType: 'image/svg+xml',
      fileName: 'status-flow.svg',
      revision: 1,
      source: SOURCE
    })

    const firstChild = children[0]
    graph.updateNode(firstChild.id, { x: 18 })
    expect(getNodeOrThrow(graph, firstChild.id).x).toBe(18)
    expect(readContentSource(getNodeOrThrow(graph, frame.id))?.source).toBe(SOURCE)
  })

  test('supports source-only callers with canonical defaults', async () => {
    const graph = await svgToSceneGraph(SOURCE)
    const page = graph.getPages()[0]
    const frame = getNodeOrThrow(graph, page.childIds[0] ?? '')

    expect(page.name).toBe('SVG')
    expect(readContentSource(frame)).toEqual({
      format: 'svg',
      mimeType: 'image/svg+xml',
      fileName: null,
      revision: 1,
      source: SOURCE
    })
  })

  test('preserves exact SVG source and blocks lossy native regeneration', async () => {
    const graph = await svgToSceneGraph(SOURCE, { fileName: 'status-flow.svg' })
    const frame = getNodeOrThrow(graph, graph.getPages()[0]?.childIds[0] ?? '')
    const child = graph.getChildren(frame.id)[0]
    if (!child) throw new Error('Expected imported SVG child')

    expect(reconcileSVGSource(graph, frame)).toMatchObject({
      status: 'current',
      source: SOURCE,
      revision: 1
    })

    graph.updateNode(child.id, { x: child.x + 8 })
    const result = reconcileSVGSource(graph, frame)
    applySVGReconciliation(graph, frame, result)

    expect(result).toMatchObject({ status: 'unsupported', source: SOURCE, revision: 1 })
    expect(readContentSource(frame)?.source).toBe(SOURCE)
    expect(readSourceReconciliation(frame)).toMatchObject({
      status: 'unsupported',
      revision: 1
    })
  })

  test('preserves the source envelope through the native document format', async () => {
    const graph = await svgToSceneGraph(SOURCE, { fileName: 'status-flow.svg' })
    const restored = await parseFigFile((await exportFigFile(graph)).buffer as ArrayBuffer)
    const frame = [...restored.getAllNodes()].find(
      (node) => node.type === 'FRAME' && node.name === 'status-flow'
    )

    expect(frame ? readContentSource(frame) : null).toEqual({
      format: 'svg',
      mimeType: 'image/svg+xml',
      fileName: 'status-flow.svg',
      revision: 1,
      source: SOURCE
    })
  })

  test('surfaces the existing importer limitation for unsupported SVG content', async () => {
    const source = '<svg viewBox="0 0 100 20"><text>Label</text></svg>'

    expect(svgToSceneGraph(source)).rejects.toThrow('No supported SVG elements')
  })
})
