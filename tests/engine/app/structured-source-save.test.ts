import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { readContentSource, readSourceReconciliation, svgToSceneGraph } from '@open-pencil/core/io'

import { createDocumentSourceActions, createDocumentSourceState } from '@/app/document/io/source'

import {
  csvToSceneGraph,
  jsonToSceneGraph,
  readStructuredDataNode
} from '#core/io/formats/structured-data'

function documentNode(graph: ReturnType<typeof jsonToSceneGraph>) {
  return graph.getChildren(graph.getPages()[0].id)[0]
}

function valueNode(graph: ReturnType<typeof jsonToSceneGraph>, path: string) {
  return [...graph.getAllNodes()].find((node) => {
    const metadata = readStructuredDataNode(node)
    return node.type === 'TEXT' && metadata?.path === path && metadata.field === 'value'
  })
}

function browserHandle(
  name: string,
  write: (data: Uint8Array) => Promise<void>
): FileSystemFileHandle {
  const writable: FileSystemWritableFileStream = Object.assign(new WritableStream(), {
    write: async (data: FileSystemWriteChunkType) => {
      if (!(data instanceof Uint8Array)) throw new Error('Expected source bytes')
      await write(data)
    },
    seek: async () => undefined,
    truncate: async () => undefined
  })
  return {
    name,
    kind: 'file',
    createWritable: async () => writable,
    getFile: async () => new File([], name),
    isSameEntry: async (other) => other.name === name
  }
}

function sourceActions(
  graph: ReturnType<typeof jsonToSceneGraph>,
  handle: FileSystemFileHandle,
  format: 'json' | 'csv' | 'svg' = 'json'
) {
  const editor = createEditor({ graph, skipInitialGraphSetup: true })
  const state = Object.assign(editor.state, {
    autosaveEnabled: false,
    documentName: 'state'
  })
  const sourceState = createDocumentSourceState()
  const actions = createDocumentSourceActions({
    editor,
    state,
    stopWatchingFile: () => undefined,
    startWatchingFile: async () => undefined,
    getRenderer: () => editor.renderer,
    ...sourceState
  })
  actions.setDocumentSource(`state.${format}`, format, handle)
  return actions
}

describe('structured source document save', () => {
  test('writes regenerated JSON bytes through the browser file handle', async () => {
    const source = '{\n  "state": "draft"\n}\n'
    const graph = jsonToSceneGraph(source, { fileName: 'state.json' })
    const writes: Uint8Array[] = []
    const handle = browserHandle('state.json', async (data) => {
      writes.push(structuredClone(data))
    })
    const value = valueNode(graph, '/state')
    if (!value) throw new Error('Expected JSON value')

    const actions = sourceActions(graph, handle)
    graph.updateNode(value.id, { text: '"ready"' })
    await actions.saveFigFile()

    expect(writes).toHaveLength(1)
    expect(new TextDecoder().decode(writes[0])).toBe('{\n  "state": "ready"\n}\n')
    expect(readContentSource(documentNode(graph))).toMatchObject({
      revision: 2,
      source: '{\n  "state": "ready"\n}\n'
    })
  })

  test('writes regenerated CSV bytes and reopens the saved source', async () => {
    const source = 'name,state\r\nAda,draft\r\n'
    const graph = csvToSceneGraph(
      source,
      () => [
        ['name', 'state'],
        ['Ada', 'draft']
      ],
      { fileName: 'state.csv' }
    )
    const writes: Uint8Array[] = []
    const handle = browserHandle('state.csv', async (data) => {
      writes.push(structuredClone(data))
    })
    const value = valueNode(graph, '/rows/0/1')
    if (!value) throw new Error('Expected CSV value')

    const actions = sourceActions(graph, handle, 'csv')
    graph.updateNode(value.id, { text: 'ready' })
    await actions.saveFigFile()

    expect(writes).toHaveLength(1)
    const savedSource = new TextDecoder().decode(writes[0])
    expect(savedSource).toBe('name,state\r\nAda,ready\r\n')
    const reopened = csvToSceneGraph(
      savedSource,
      (input) => {
        expect(input).toBe(savedSource)
        return [
          ['name', 'state'],
          ['Ada', 'ready']
        ]
      },
      { fileName: 'state.csv' }
    )
    expect(valueNode(reopened, '/rows/0/1')?.text).toBe('ready')
  })

  test('rolls source metadata back when the browser write fails', async () => {
    const source = '{"state":"draft"}'
    const graph = jsonToSceneGraph(source, { fileName: 'state.json' })
    const handle = browserHandle('state.json', async () => {
      throw new Error('disk unavailable')
    })
    const value = valueNode(graph, '/state')
    if (!value) throw new Error('Expected JSON value')

    const actions = sourceActions(graph, handle)
    graph.updateNode(value.id, { text: '"ready"' })
    await expect(actions.persistWritableDocumentSource()).resolves.toBe(false)

    expect(readContentSource(documentNode(graph))).toMatchObject({ revision: 1, source })
    expect(readSourceReconciliation(documentNode(graph))).toMatchObject({
      status: 'current',
      revision: 1
    })
    const status = [...graph.getAllNodes()].find(
      (node) => readStructuredDataNode(node)?.kind === 'source-status'
    )
    expect(status?.text).toBe('SOURCE · CURRENT · REVISION 1')
    expect(value.text).toBe('"ready"')
  })

  test('blocks edited SVG source before writing any bytes', async () => {
    const source = '<svg viewBox="0 0 20 20"><rect width="20" height="20"/></svg>'
    const graph = await svgToSceneGraph(source, { fileName: 'state.svg' })
    const document = documentNode(graph)
    const child = graph.getChildren(document.id)[0]
    if (!child) throw new Error('Expected SVG child')
    const writes: Uint8Array[] = []
    const handle = browserHandle('state.svg', async (data) => {
      writes.push(structuredClone(data))
    })

    const actions = sourceActions(graph, handle, 'svg')
    graph.updateNode(child.id, { x: child.x + 4 })

    await expect(actions.persistWritableDocumentSource()).resolves.toBe(false)
    expect(writes).toHaveLength(0)
    expect(readContentSource(document)).toMatchObject({ source, revision: 1 })
    expect(readSourceReconciliation(document)).toMatchObject({
      status: 'unsupported',
      revision: 1
    })
  })
})
