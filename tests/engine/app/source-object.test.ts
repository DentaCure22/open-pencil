import { beforeAll, describe, expect, test } from 'bun:test'

import { initCodec } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'
import { readContentSource } from '@open-pencil/core/io'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'

import { classifyBoardFile } from '@/app/file-intake/classify'
import { placeFileIntakeFiles } from '@/app/file-intake/intake'
import { BoardFileIntakeRegistry, boardFileIntakeRegistry } from '@/app/file-intake/registry'
import { placeSourceObjectFiles } from '@/app/source-object/intake'
import { sourceObjectMimeType, sourceObjectSource } from '@/app/source-object/source'

describe('downloadable source object intake', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('infers rich-document MIME types without claiming an importer', () => {
    expect(sourceObjectMimeType(new File([], 'forecast.xlsx'))).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    expect(sourceObjectMimeType(new File([], 'brief.docx'))).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(sourceObjectMimeType(new File([], 'review.pptx'))).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
    expect(sourceObjectMimeType(new File([], 'declared.bin', { type: 'model/gltf-binary' }))).toBe(
      'model/gltf-binary'
    )
  })

  test('keeps office, 3D, and CAD files on the generic boundary when no adapter is registered', () => {
    const names = [
      'forecast.xlsx',
      'brief.docx',
      'review.pptx',
      'mesh.obj',
      'mesh.stl',
      'assembly.step',
      'assembly.stp',
      'surface.iges',
      'surface.igs',
      'solid.brep',
      'drawing.dxf',
      'drawing.dwg'
    ]

    for (const name of names) {
      expect(classifyBoardFile(new File([], name))).toEqual({
        kind: 'source-object',
        reason: 'no-board-adapter'
      })
    }
    for (const name of ['scene.gltf', 'scene.glb']) {
      expect(classifyBoardFile(new File([], name))).toEqual({
        adapterId: 'spatial-media',
        kind: 'specialized'
      })
    }
    expect(classifyBoardFile(new File([], 'photo.png', { type: 'image/png' }))).toEqual({
      kind: 'media',
      mediaKind: 'raster'
    })
  })

  test('lets a specialized adapter claim a format ahead of the generic fallback', () => {
    const registry = new BoardFileIntakeRegistry()
    registry.register({
      id: 'three-dimensional',
      matches: (file) => file.name.toLowerCase().endsWith('.glb'),
      placeFiles: async () => []
    })

    expect(classifyBoardFile(new File([], 'scene.glb'), registry)).toEqual({
      adapterId: 'three-dimensional',
      kind: 'specialized'
    })
    expect(classifyBoardFile(new File([], 'forecast.xlsx'), registry)).toEqual({
      kind: 'source-object',
      reason: 'no-board-adapter'
    })
  })

  test('routes registered formats without creating a generic source object', async () => {
    const editor = createEditor()
    const unregister = boardFileIntakeRegistry.register({
      id: 'test-cad',
      matches: (file) => file.name.toLowerCase().endsWith('.step'),
      placeFiles: async (target, files, x, y) =>
        files.map(
          (file) =>
            target.graph.createNode('RECTANGLE', target.state.currentPageId, {
              height: 40,
              name: file.name,
              width: 40,
              x,
              y
            }).id
        )
    })

    try {
      const result = await placeFileIntakeFiles(
        editor,
        [new File([new Uint8Array([1, 2])], 'part.step')],
        80,
        90
      )
      expect(result.specializedIds).toHaveLength(1)
      expect(result.sourceObjectIds).toEqual([])
      expect(sourceObjectSource(editor.graph.getNode(result.specializedIds[0]))).toBeNull()
    } finally {
      unregister()
    }
  })

  test('retains filename, MIME, bytes, selection, and undo/redo', async () => {
    const editor = createEditor()
    const previous = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
      height: 20,
      name: 'Previous selection',
      width: 20
    })
    editor.select([previous.id])
    const bytes = new Uint8Array([80, 75, 3, 4, 10, 20, 30])
    const [id] = await placeSourceObjectFiles(
      editor,
      [new File([bytes], 'forecast.xlsx')],
      400,
      300
    )
    const node = editor.graph.getNode(id)
    const source = sourceObjectSource(node)

    expect(editor.state.selectedIds).toEqual(new Set([id]))
    expect(source?.fileName).toBe('forecast.xlsx')
    expect(source?.metadata).toMatchObject({
      format: 'xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    expect(source ? editor.graph.images.get(source.assetHash) : undefined).toEqual(bytes)

    editor.undo.undo()
    expect(editor.graph.getNode(id)).toBeUndefined()
    expect(editor.state.selectedIds).toEqual(new Set([previous.id]))
    expect(source ? editor.graph.images.has(source.assetHash) : false).toBe(false)

    editor.undo.redo()
    expect(editor.graph.getNode(id)).toBeDefined()
    expect(editor.state.selectedIds).toEqual(new Set([id]))
    expect(source ? editor.graph.images.get(source.assetHash) : undefined).toEqual(bytes)
  })

  test('retains original source bytes and metadata through native .fig save/reopen', async () => {
    const editor = createEditor()
    const bytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4, 5])
    await placeSourceObjectFiles(editor, [new File([bytes], 'brief.docx')], 400, 300)

    const reopened = await parseFigFile((await exportFigFile(editor.graph)).buffer as ArrayBuffer)
    const reopenedNode = [...reopened.getAllNodes()].find(
      (node) => readContentSource(node)?.fileName === 'brief.docx'
    )
    const reopenedSource = sourceObjectSource(reopenedNode)

    expect(reopenedSource?.metadata.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(reopenedSource ? reopened.images.get(reopenedSource.assetHash) : undefined).toEqual(
      bytes
    )
  })
})
