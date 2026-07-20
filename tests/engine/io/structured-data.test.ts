import { beforeAll, describe, expect, test } from 'bun:test'

import { initCodec } from '@open-pencil/core'
import { readContentSource, readSourceReconciliation } from '@open-pencil/core/io'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'

import {
  createCSVFormat,
  csvToSceneGraph,
  applyStructuredDataReconciliation,
  jsonFormat,
  jsonToSceneGraph,
  reconcileStructuredDataSource,
  readStructuredDataNode,
  type CSVRowsParser
} from '#core/io/formats/structured-data'
import { IORegistry } from '#core/io/registry'

function documentNode(graph: ReturnType<typeof jsonToSceneGraph>) {
  return graph.getChildren(graph.getPages()[0].id)[0]
}

function nodeAtPath(graph: ReturnType<typeof jsonToSceneGraph>, path: string) {
  return [...graph.getAllNodes()].find((node) => readStructuredDataNode(node)?.path === path)
}

function textNodeAtPath(
  graph: ReturnType<typeof jsonToSceneGraph>,
  path: string,
  field: 'header' | 'label' | 'type' | 'value'
) {
  return [...graph.getAllNodes()].find((node) => {
    const metadata = readStructuredDataNode(node)
    return node.type === 'TEXT' && metadata?.path === path && metadata.field === field
  })
}

describe('structured data document import', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('keeps JSON matching filename-first so .pen files are not claimed by MIME alone', () => {
    const registry = new IORegistry([jsonFormat])

    expect(registry.findReader('records.json', 'application/json')?.id).toBe('json')
    expect(registry.findReader('record.schema.json', 'application/schema+json')?.id).toBe('json')
    expect(jsonFormat.matchesFile?.('design.pen', 'application/json')).toBe(false)
  })

  test('projects nested JSON into editable native tree rows with deterministic JSON Pointers', () => {
    const source = JSON.stringify({
      'profile/name': {
        '~status': 'ready',
        attempts: 2,
        approved: true
      },
      tags: ['source-backed', null]
    })
    const graph = jsonToSceneGraph(source, {
      fileName: 'record.json',
      mimeType: 'application/json'
    })
    const document = documentNode(graph)
    const status = nodeAtPath(graph, '/profile~1name/~0status')
    const tags = nodeAtPath(graph, '/tags')

    expect(document.type).toBe('FRAME')
    expect(readContentSource(document)).toEqual({
      format: 'json',
      mimeType: 'application/json',
      fileName: 'record.json',
      revision: 1,
      source
    })
    expect(readStructuredDataNode(document)).toMatchObject({ kind: 'document', path: '' })
    expect(readStructuredDataNode(status ?? { pluginData: [] })).toMatchObject({
      kind: 'tree-row',
      path: '/profile~1name/~0status',
      valueType: 'string'
    })
    expect(readStructuredDataNode(tags ?? { pluginData: [] })).toMatchObject({
      kind: 'tree-row',
      path: '/tags',
      valueType: 'array'
    })
    expect(
      [...graph.getAllNodes()].every((node) =>
        ['DOCUMENT', 'CANVAS', 'FRAME', 'TEXT'].includes(node.type)
      )
    ).toBe(true)
    expect(
      [...graph.getAllNodes()].some((node) => node.type === 'TEXT' && node.text === 'ready')
    ).toBe(false)
    expect(
      [...graph.getAllNodes()].some((node) => node.type === 'TEXT' && node.text === '"ready"')
    ).toBe(true)
  })

  test('classifies JSON Schema without creating a separate board or scene-node type', () => {
    const source = JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } }
    })
    const graph = jsonToSceneGraph(source, { fileName: 'person.schema.json' })
    const document = documentNode(graph)

    expect(document.name).toBe('person')
    expect(readContentSource(document)).toMatchObject({
      format: 'json-schema',
      mimeType: 'application/schema+json',
      fileName: 'person.schema.json',
      source
    })
    expect(
      [...graph.getAllNodes()].some(
        (node) => node.type === 'TEXT' && node.text.trim() === 'properties'
      )
    ).toBe(true)
  })

  test('reports invalid JSON instead of opening a misleading partial document', () => {
    expect(() => jsonToSceneGraph('{"ready": }', { fileName: 'broken.json' })).toThrow(
      'Invalid JSON source:'
    )
  })

  test('parses a JSON byte-order mark while preserving it in source metadata', async () => {
    const source = '\uFEFF{"ready":true}'
    const registry = new IORegistry([jsonFormat])
    const result = await registry.readDocument({
      name: 'bom.json',
      mimeType: 'application/json',
      data: new TextEncoder().encode(source)
    })

    expect(readContentSource(documentNode(result.graph))?.source).toBe(source)
    expect(
      readStructuredDataNode(nodeAtPath(result.graph, '/ready') ?? { pluginData: [] })
    ).toMatchObject({
      valueType: 'boolean'
    })
  })

  test('projects CSV parser output into native cells while retaining the exact intake source', async () => {
    const source = '\uFEFFname,notes\nAda,"Line one\nLine two"\nOmar,Ready'
    let parserInput = ''
    const parseRows: CSVRowsParser = (input) => {
      parserInput = input
      return [
        ['name', 'notes'],
        ['Ada', 'Line one\nLine two'],
        ['Omar', 'Ready']
      ]
    }
    const registry = new IORegistry([createCSVFormat(parseRows)])
    const result = await registry.readDocument({
      name: 'people.csv',
      mimeType: 'text/csv',
      data: new TextEncoder().encode(source)
    })
    const document = documentNode(result.graph)
    const cell = nodeAtPath(result.graph, '/rows/0/1')

    expect(parserInput).toBe(source.slice(1))
    expect(result.sourceFormat).toBe('csv')
    expect(readContentSource(document)).toEqual({
      format: 'csv',
      mimeType: 'text/csv',
      fileName: 'people.csv',
      revision: 1,
      source
    })
    expect(readStructuredDataNode(cell ?? { pluginData: [] })).toEqual({
      kind: 'table-cell',
      path: '/rows/0/1',
      valueType: null,
      rowIndex: 0,
      columnIndex: 1,
      columnName: 'notes',
      field: 'value'
    })
    expect(cell?.type).toBe('TEXT')
    expect(cell?.text).toBe('Line one\nLine two')
  })

  test('bounds wide CSV projection and preserves the omitted columns in source metadata', () => {
    const headers = Array.from({ length: 12 }, (_, index) => `field-${index}`)
    const values = Array.from({ length: 12 }, (_, index) => `value-${index}`)
    const source = `${headers.join(',')}\n${values.join(',')}`
    const graph = csvToSceneGraph(source, () => [headers, values], { fileName: 'wide.csv' })
    const structuredNodes = [...graph.getAllNodes()]
      .map((node) => readStructuredDataNode(node))
      .filter((metadata) => metadata !== null)

    expect(structuredNodes.filter((metadata) => metadata.kind === 'table-cell')).toHaveLength(20)
    expect(structuredNodes.some((metadata) => metadata.kind === 'truncation')).toBe(true)
    expect(readContentSource(documentNode(graph))?.source).toBe(source)
  })

  test('retains source and stable locators after saving and reopening as .fig', async () => {
    const source = '{"items":[{"id":"a-1","state":"ready"}]}'
    const graph = jsonToSceneGraph(source, { fileName: 'items.json' })
    const reopened = await parseFigFile((await exportFigFile(graph)).buffer as ArrayBuffer)
    const document = documentNode(reopened)

    expect(readContentSource(document)).toMatchObject({
      format: 'json',
      fileName: 'items.json',
      source
    })
    expect(nodeAtPath(reopened, '/items/0/id')).toBeDefined()
  })

  test('regenerates deterministic JSON source from native scalar edits', () => {
    const source = '\uFEFF{\r\n  "name": "Ada",\r\n  "count": 2\r\n}\r\n'
    const graph = jsonToSceneGraph(source, { fileName: 'profile.json' })
    const document = documentNode(graph)
    const name = textNodeAtPath(graph, '/name', 'value')
    const count = textNodeAtPath(graph, '/count', 'value')
    if (!name || !count) throw new Error('Expected editable JSON values')

    graph.updateNode(name.id, { text: '"Omar"' })
    graph.updateNode(count.id, { text: '3' })
    const result = reconcileStructuredDataSource(graph, document)
    applyStructuredDataReconciliation(graph, document, result)

    expect(result).toMatchObject({ status: 'regenerated', revision: 2 })
    expect(result.source).toBe('\uFEFF{\r\n  "name": "Omar",\r\n  "count": 3\r\n}\r\n')
    expect(readContentSource(document)).toMatchObject({ revision: 2, source: result.source })
    expect(readSourceReconciliation(document)).toMatchObject({
      status: 'regenerated',
      revision: 2
    })
    const reopened = jsonToSceneGraph(result.source, { fileName: 'profile.json' })
    expect(textNodeAtPath(reopened, '/name', 'value')?.text).toBe('"Omar"')
  })

  test('preserves exact JSON bytes and surfaces invalid native edits as a conflict', () => {
    const source = '{ "count" : 2 }'
    const graph = jsonToSceneGraph(source, { fileName: 'count.json' })
    const document = documentNode(graph)
    const count = textNodeAtPath(graph, '/count', 'value')
    if (!count) throw new Error('Expected editable JSON value')

    expect(reconcileStructuredDataSource(graph, document)).toMatchObject({
      status: 'current',
      source
    })
    graph.updateNode(count.id, { text: 'not-a-number' })
    const conflict = reconcileStructuredDataSource(graph, document)
    applyStructuredDataReconciliation(graph, document, conflict)

    expect(conflict).toMatchObject({ status: 'conflict', source, revision: 1 })
    expect(readContentSource(document)?.source).toBe(source)
    expect(
      [...graph.getAllNodes()].find(
        (node) => readStructuredDataNode(node)?.kind === 'source-status'
      )?.text
    ).toContain('CONFLICT · REVISION 1 · ORIGINAL PRESERVED')
  })

  test('regenerates CSV quoting while retaining untouched ragged cells', () => {
    const source = '\uFEFFname,notes,optional\r\nAda,"Line one\nLine two"\r\nOmar,Ready,yes'
    const graph = csvToSceneGraph(
      source,
      () => [
        ['name', 'notes', 'optional'],
        ['Ada', 'Line one\nLine two'],
        ['Omar', 'Ready', 'yes']
      ],
      { fileName: 'people.csv' }
    )
    const document = documentNode(graph)
    const cell = textNodeAtPath(graph, '/rows/0/1', 'value')
    if (!cell) throw new Error('Expected editable CSV cell')

    expect(reconcileStructuredDataSource(graph, document)).toMatchObject({
      status: 'current',
      source,
      revision: 1
    })
    graph.updateNode(cell.id, { text: 'Line one, revised' })
    const result = reconcileStructuredDataSource(graph, document)
    applyStructuredDataReconciliation(graph, document, result)

    expect(result).toMatchObject({ status: 'regenerated', revision: 2 })
    expect(result.source).toBe(
      '\uFEFFname,notes,optional\r\nAda,"Line one, revised"\r\nOmar,Ready,yes'
    )
    const reopened = csvToSceneGraph(result.source, () => [
      ['name', 'notes', 'optional'],
      ['Ada', 'Line one, revised'],
      ['Omar', 'Ready', 'yes']
    ])
    expect(textNodeAtPath(reopened, '/rows/0/1', 'value')?.text).toBe('Line one, revised')
  })
})
