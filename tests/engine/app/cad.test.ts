import { beforeAll, describe, expect, test } from 'bun:test'

import { initCodec } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'

import { classifyCadFile, MAX_DXF_SOURCE_BYTES } from '@/app/cad/classify'
import { placeCadDrawingFiles } from '@/app/cad/intake'
import { CadDrawingError, parseDxfDrawing } from '@/app/cad/runtime/dxf'
import { cadDrawingSource } from '@/app/cad/source'
import { classifyBoardFile } from '@/app/file-intake/classify'
import '@/app/file-intake/intake'

const FIXTURE_PATH = 'tests/fixtures/cad/basic-drawing.dxf'

async function fixtureBytes(): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(FIXTURE_PATH).arrayBuffer())
}

function fixtureFile(bytes: Uint8Array): File {
  return new File([bytes.slice().buffer], 'basic-drawing.dxf', { type: 'image/vnd.dxf' })
}

describe('source-backed CAD intake', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('claims bounded DXF while keeping kernel and proprietary formats as exact-byte fallbacks', () => {
    expect(classifyCadFile(new File([], 'drawing.dxf'))).toMatchObject({
      disposition: 'cad-viewer',
      format: 'dxf',
      kind: 'cad-drawing'
    })
    expect(classifyCadFile(new File([], '', { type: 'image/vnd.dxf' }))).toMatchObject({
      disposition: 'cad-viewer',
      format: 'dxf'
    })
    expect(
      classifyCadFile({ name: 'huge.dxf', size: MAX_DXF_SOURCE_BYTES + 1, type: '' })
    ).toMatchObject({
      disposition: 'generic-source',
      fidelity: { editable: false, topology: 'unverified', units: 'retained-only' }
    })
    for (const name of ['assembly.step', 'surface.iges', 'solid.brep']) {
      expect(classifyCadFile(new File([], name))).toMatchObject({
        disposition: 'generic-source',
        fidelity: { editable: false, topology: 'unverified', units: 'unverified' }
      })
    }
    expect(classifyCadFile(new File([], 'drawing.dwg'))).toMatchObject({
      disposition: 'generic-source',
      reason: expect.stringContaining('proprietary')
    })
    expect(classifyBoardFile(new File([], 'drawing.dxf'))).toEqual({
      adapterId: 'cad-drawing',
      kind: 'specialized'
    })
    expect(classifyBoardFile(new File([], 'assembly.step'))).toEqual({
      kind: 'source-object',
      reason: 'no-board-adapter'
    })
  })

  test('parses bounded visible 2D entities and discloses unsupported entities', async () => {
    const drawing = parseDxfDrawing(await fixtureBytes())
    expect(drawing).toMatchObject({
      entityCount: 6,
      layerCount: 2,
      omittedEntityCount: 1,
      renderedEntityCount: 5,
      units: 'Millimeters'
    })
    expect(drawing.paths).toHaveLength(4)
    expect(drawing.texts).toEqual([
      expect.objectContaining({ content: 'PHASE 1 DXF', layer: 'Notes' })
    ])
    expect(drawing.bounds).toMatchObject({ height: 92, minX: 0, minY: -92, width: 120 })
  })

  test('rejects binary DXF from rendering without discarding its source classification', () => {
    const bytes = new TextEncoder().encode('AutoCAD Binary DXF\r\n\u001a\0')
    expect(() => parseDxfDrawing(bytes)).toThrow(CadDrawingError)
    try {
      parseDxfDrawing(bytes)
    } catch (error) {
      expect(error).toMatchObject({ kind: 'unsupported' })
    }
  })

  test('preserves exact DXF bytes, selection, undo/redo, and native document reopen', async () => {
    const editor = createEditor()
    const previous = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
      height: 20,
      name: 'Previous selection',
      width: 20
    })
    editor.select([previous.id])
    const bytes = await fixtureBytes()
    const [id] = await placeCadDrawingFiles(editor, [fixtureFile(bytes)], 500, 360)
    if (!id) throw new Error('DXF fixture was not placed')
    const source = cadDrawingSource(editor.graph.getNode(id))

    expect(editor.state.selectedIds).toEqual(new Set([id]))
    expect(source?.metadata).toMatchObject({
      fileName: 'basic-drawing.dxf',
      format: 'dxf',
      mimeType: 'image/vnd.dxf'
    })
    expect(source ? editor.graph.images.get(source.assetHash) : null).toEqual(bytes)

    editor.undo.undo()
    expect(editor.graph.getNode(id)).toBeUndefined()
    expect(editor.state.selectedIds).toEqual(new Set([previous.id]))
    expect(source ? editor.graph.images.has(source.assetHash) : false).toBe(false)
    editor.undo.redo()
    expect(cadDrawingSource(editor.graph.getNode(id))).not.toBeNull()
    expect(source ? editor.graph.images.get(source.assetHash) : null).toEqual(bytes)

    const reopened = await parseFigFile((await exportFigFile(editor.graph)).buffer as ArrayBuffer)
    const reopenedNode = [...reopened.getAllNodes()].find(
      (node) => cadDrawingSource(node)?.fileName === 'basic-drawing.dxf'
    )
    const reopenedSource = cadDrawingSource(reopenedNode)
    expect(reopenedSource ? reopened.images.get(reopenedSource.assetHash) : null).toEqual(bytes)
  })
})
