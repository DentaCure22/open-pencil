import { beforeAll, describe, expect, test } from 'bun:test'

import { initCodec } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'

import { classifySpatialFile, MAX_SPATIAL_SOURCE_BYTES } from '@/app/spatial-media/classify'
import {
  commitSpatialMediaCamera,
  initializeSpatialMediaCamera,
  placeSpatialMediaFiles,
  storeSpatialMediaPreview
} from '@/app/spatial-media/intake'
import { loadSpatialAsset } from '@/app/spatial-media/runtime/load'
import { SpatialSourceError, validateSpatialSource } from '@/app/spatial-media/runtime/validate'
import { spatialMediaSource } from '@/app/spatial-media/source'
import type { SpatialCameraState } from '@/app/spatial-media/types'

const FIXTURE_PATH = 'tests/fixtures/spatial-media/animated-triangle.gltf'

async function fixtureBytes(): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(FIXTURE_PATH).arrayBuffer())
}

function fixtureFile(bytes: Uint8Array): File {
  return new File([bytes.slice().buffer], 'animated-triangle.gltf', {
    type: 'model/gltf+json'
  })
}

describe('spatial media classification and source persistence', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('keeps viewer, authored Three.js, and deferred meshes distinct', () => {
    expect(classifySpatialFile(new File([], 'model.glb')).disposition).toBe('spatial-viewer')
    expect(classifySpatialFile(new File([], 'scene.gltf')).disposition).toBe('spatial-viewer')
    expect(classifySpatialFile(new File([], 'hero.three.js')).disposition).toBe(
      'three-experience-adapter'
    )
    expect(classifySpatialFile(new File([], 'assembly.step'))).toMatchObject({
      disposition: 'not-spatial',
      kind: 'unknown'
    })
    expect(classifySpatialFile(new File([], 'scan.stl'))).toMatchObject({
      disposition: 'generic-source',
      kind: 'mesh-source'
    })
    expect(
      classifySpatialFile({ name: 'large.glb', size: MAX_SPATIAL_SOURCE_BYTES + 1, type: '' })
    ).toMatchObject({ disposition: 'reject', kind: 'oversize' })
  })

  test('blocks external glTF resources and loads the deterministic embedded fixture', async () => {
    const external = new TextEncoder().encode(
      JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.com/a.bin' }] })
    )
    expect(() => validateSpatialSource(external, 'gltf')).toThrow(SpatialSourceError)

    if (globalThis.ProgressEvent === undefined) {
      class BunProgressEvent extends Event {
        readonly lengthComputable: boolean
        readonly loaded: number
        readonly total: number

        constructor(
          type: string,
          init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}
        ) {
          super(type)
          this.lengthComputable = init.lengthComputable ?? false
          this.loaded = init.loaded ?? 0
          this.total = init.total ?? 0
        }
      }
      Object.defineProperty(globalThis, 'ProgressEvent', {
        configurable: true,
        value: BunProgressEvent
      })
    }

    const loaded = await loadSpatialAsset(await fixtureBytes(), 'gltf')
    expect(loaded.stats).toEqual({ animations: 1, geometries: 1, materials: 1, triangles: 1 })
    expect(loaded.root.children).toHaveLength(1)
  })

  test('places exact bytes, supports camera undo, and restores assets through .fig reopen', async () => {
    const editor = createEditor()
    const bytes = await fixtureBytes()
    const result = await placeSpatialMediaFiles(editor, [fixtureFile(bytes)], 700, 500)
    const [id] = result.placedIds
    expect(result.fallbacks).toEqual([])
    expect(id).toBeDefined()
    if (!id) return

    const node = editor.graph.getNode(id)
    const initialSource = node ? spatialMediaSource(node) : null
    expect(initialSource?.metadata).toMatchObject({
      fileName: 'animated-triangle.gltf',
      mimeType: 'model/gltf+json'
    })
    expect(initialSource ? editor.graph.images.get(initialSource.assetHash) : null).toEqual(bytes)

    const home: SpatialCameraState = { position: [1, 1, 4], target: [0, 0, 0] }
    const changed: SpatialCameraState = { position: [2, 1.5, 5], target: [0.2, 0, 0] }
    initializeSpatialMediaCamera(editor, id, home)
    commitSpatialMediaCamera(editor, id, changed)
    expect(spatialMediaSource(editor.graph.getNode(id) ?? { pluginData: [] })?.camera).toEqual(
      changed
    )
    editor.undo.undo()
    expect(spatialMediaSource(editor.graph.getNode(id) ?? { pluginData: [] })?.camera).toEqual(home)
    editor.undo.redo()

    const preview = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])
    expect(storeSpatialMediaPreview(editor, id, preview)).not.toBeNull()
    const exported = await exportFigFile(editor.graph)
    const reopened = await parseFigFile(exported.buffer as ArrayBuffer)
    const reopenedNode = [...reopened.getAllNodes()].find(
      (candidate) => spatialMediaSource(candidate)?.metadata.fileName === 'animated-triangle.gltf'
    )
    const reopenedSource = reopenedNode ? spatialMediaSource(reopenedNode) : null
    expect(reopenedSource?.camera).toEqual(changed)
    expect(reopenedSource?.homeCamera).toEqual(home)
    expect(reopenedSource ? reopened.images.get(reopenedSource.assetHash) : null).toEqual(bytes)
    expect(reopenedSource?.previewHash).not.toBeNull()
    expect(
      reopenedSource?.previewHash ? reopened.images.get(reopenedSource.previewHash) : null
    ).toEqual(preview)
  })

  test('undo and redo restore both the source frame and retained bytes', async () => {
    const editor = createEditor()
    const bytes = await fixtureBytes()
    const result = await placeSpatialMediaFiles(editor, [fixtureFile(bytes)], 700, 500)
    const [id] = result.placedIds
    if (!id) throw new Error('Spatial fixture was not placed')
    const source = spatialMediaSource(editor.graph.getNode(id) ?? { pluginData: [] })
    if (!source) throw new Error('Spatial source metadata was not created')

    editor.undo.undo()
    expect(editor.graph.getNode(id)).toBeUndefined()
    expect(editor.graph.images.has(source.assetHash)).toBe(false)
    editor.undo.redo()
    expect(editor.graph.getNode(id)).toBeDefined()
    expect(editor.graph.images.get(source.assetHash)).toEqual(bytes)
  })
})
