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
const OBJ_BYTES = new TextEncoder().encode(`o Triangle
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`)
const STL_BYTES = new TextEncoder().encode(`solid triangle
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid triangle
`)

function binaryStlFixture(): Uint8Array {
  const bytes = new Uint8Array(84 + 50)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, 1, true)
  view.setFloat32(84 + 8, 1, true)
  view.setFloat32(84 + 24, 1, true)
  view.setFloat32(84 + 40, 1, true)
  return bytes
}

function externalGltfFixture(): { buffer: Uint8Array; source: Uint8Array } {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const buffer = new Uint8Array(positions.buffer.slice(0))
  const source = new TextEncoder().encode(
    JSON.stringify({
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          max: [1, 1, 0],
          min: [0, 0, 0],
          type: 'VEC3'
        }
      ],
      asset: { version: '2.0' },
      bufferViews: [{ buffer: 0, byteLength: buffer.byteLength }],
      buffers: [{ byteLength: buffer.byteLength, uri: 'triangle.bin' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      scene: 0,
      scenes: [{ nodes: [0] }]
    })
  )
  return { buffer, source }
}

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
  })

  test('keeps mesh viewers, authored Three.js, and CAD sources distinct', () => {
    expect(classifySpatialFile(new File([], 'model.glb')).disposition).toBe('spatial-viewer')
    expect(classifySpatialFile(new File([], 'scene.gltf')).disposition).toBe('spatial-viewer')
    expect(classifySpatialFile(new File([], 'hero.three.js')).disposition).toBe(
      'three-experience-adapter'
    )
    const cad = classifySpatialFile(new File([], 'assembly.step'))
    expect(cad).toMatchObject({
      disposition: 'generic-source',
      fidelity: { editable: false, topology: 'unverified', units: 'unverified' },
      kind: 'engineering-cad'
    })
    expect(classifySpatialFile(new File([], 'mesh.obj'))).toMatchObject({
      disposition: 'spatial-viewer',
      format: 'obj'
    })
    expect(classifySpatialFile(new File([], 'scan.stl'))).toMatchObject({
      disposition: 'spatial-viewer',
      format: 'stl'
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

    const loaded = await loadSpatialAsset(await fixtureBytes(), 'gltf')
    expect(loaded.stats).toEqual({ animations: 1, geometries: 1, materials: 1, triangles: 1 })
    expect(loaded.root.children).toHaveLength(1)
  })

  test('loads geometry-only OBJ and ASCII or binary STL through the bounded local runtime', async () => {
    const obj = await loadSpatialAsset(OBJ_BYTES, 'obj')
    const stl = await loadSpatialAsset(STL_BYTES, 'stl')
    const binaryStl = await loadSpatialAsset(binaryStlFixture(), 'stl')
    expect(obj.stats).toEqual({ animations: 0, geometries: 1, materials: 1, triangles: 1 })
    expect(stl.stats).toEqual({ animations: 0, geometries: 1, materials: 1, triangles: 1 })
    expect(binaryStl.stats).toEqual({
      animations: 0,
      geometries: 1,
      materials: 1,
      triangles: 1
    })
    expect(() =>
      validateSpatialSource(
        new TextEncoder().encode('mtllib unsafe.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'),
        'obj'
      )
    ).toThrow('OBJ material-library files are not supported')
  })

  test('resolves a local glTF buffer without network access or trusted stored MIME', async () => {
    const { buffer, source } = externalGltfFixture()
    const loaded = await loadSpatialAsset(source, 'gltf', [
      {
        assetHash: 'triangle-buffer',
        bytes: buffer,
        fileName: 'triangle.bin',
        mimeType: 'image/svg+xml',
        uri: 'triangle.bin'
      }
    ])
    expect(loaded.stats).toEqual({ animations: 0, geometries: 1, materials: 1, triangles: 1 })

    const remote = new TextEncoder().encode(
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ byteLength: 4, uri: 'https://example.com/mesh.bin' }]
      })
    )
    expect(() => validateSpatialSource(remote, 'gltf', ['mesh.bin'])).toThrow(
      'not a safe local relative path'
    )
    const traversal = new TextEncoder().encode(
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ byteLength: 4, uri: '../mesh.bin' }]
      })
    )
    expect(() => validateSpatialSource(traversal, 'gltf', ['mesh.bin'])).toThrow(
      'escapes the local model bundle'
    )
    const embeddedSvg = new TextEncoder().encode(
      JSON.stringify({
        asset: { version: '2.0' },
        images: [{ bufferView: 0, mimeType: 'image/svg+xml' }]
      })
    )
    expect(() => validateSpatialSource(embeddedSvg, 'gltf')).toThrow(
      'glTF images must use PNG, JPEG, WebP, or AVIF'
    )
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

  test('retains local glTF companion bytes and provenance through undo and .fig reopen', async () => {
    const editor = createEditor()
    const { buffer, source } = externalGltfFixture()
    const result = await placeSpatialMediaFiles(
      editor,
      [
        new File([source.slice().buffer], 'external-triangle.gltf', {
          type: 'model/gltf+json'
        }),
        new File([buffer.slice().buffer], 'triangle.bin', {
          type: 'application/octet-stream'
        })
      ],
      700,
      500
    )
    const [id] = result.placedIds
    if (!id) throw new Error('External glTF fixture was not placed')
    expect(result.fallbacks).toEqual([])
    const placed = spatialMediaSource(editor.graph.getNode(id) ?? { pluginData: [] })
    expect(placed?.resources).toHaveLength(1)
    expect(placed?.resources[0]).toMatchObject({
      fileName: 'triangle.bin',
      mimeType: 'application/octet-stream',
      uri: 'triangle.bin'
    })
    expect(placed ? editor.graph.images.get(placed.resources[0]?.assetHash ?? '') : null).toEqual(
      buffer
    )

    const exported = await exportFigFile(editor.graph)
    const reopened = await parseFigFile(exported.buffer as ArrayBuffer)
    const reopenedNode = [...reopened.getAllNodes()].find(
      (candidate) => spatialMediaSource(candidate)?.metadata.fileName === 'external-triangle.gltf'
    )
    const reopenedSource = reopenedNode ? spatialMediaSource(reopenedNode) : null
    expect(reopenedSource?.resources).toHaveLength(1)
    expect(
      reopenedSource?.resources[0]
        ? reopened.images.get(reopenedSource.resources[0].assetHash)
        : null
    ).toEqual(buffer)

    editor.undo.undo()
    expect(
      placed?.resources[0] ? editor.graph.images.has(placed.resources[0].assetHash) : true
    ).toBe(false)
    editor.undo.redo()
    expect(
      placed?.resources[0] ? editor.graph.images.get(placed.resources[0].assetHash) : null
    ).toEqual(buffer)
  })
})
