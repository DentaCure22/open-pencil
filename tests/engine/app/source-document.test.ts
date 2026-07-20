import { describe, expect, test } from 'bun:test'

import { readContentSource } from '@open-pencil/core/io'

import { createEditorStore } from '@/app/editor/session'
import {
  createSourceDocument,
  selectedSourceDocument,
  sourceDocumentForNode,
  updateSourceDocument,
  type SourceDocumentFormat
} from '@/app/source-document/workspace'

const CASES = [
  { format: 'html', mimeType: 'text/html', source: '<main>Hello</main>' },
  { format: 'jsx', mimeType: 'text/jsx', source: 'export const App = () => <main>Hello</main>' },
  {
    format: 'tsx',
    mimeType: 'text/tsx',
    source: 'export const App = ({ title }: { title: string }) => <main>{title}</main>'
  }
] satisfies Array<{ format: SourceDocumentFormat; mimeType: string; source: string }>

describe('Source documents', () => {
  test.each(CASES)('stores exact $format source through the shared contract', (fixture) => {
    const store = createEditorStore()
    const node = createSourceDocument(store, fixture.source, {
      fileName: `phase-1.${fixture.format}`,
      format: fixture.format
    })

    expect(readContentSource(node)).toEqual({
      fileName: `phase-1.${fixture.format}`,
      format: fixture.format,
      mimeType: fixture.mimeType,
      revision: 1,
      source: fixture.source
    })
    expect(selectedSourceDocument(store)?.node.id).toBe(node.id)
    const preview = store.graph
      .flattenTree(node.id)
      .map(({ node: child }) => child)
      .find((child) => child.name === 'Source preview text')
    expect(preview?.text).toBe(fixture.source)
  })

  test('updates source and preview as one undoable revision', () => {
    const store = createEditorStore()
    const node = createSourceDocument(store, '<main>Before</main>', {
      fileName: 'editable.html',
      format: 'html'
    })
    const child = store.graph
      .flattenTree(node.id)
      .map(({ node: nested }) => nested)
      .find((nested) => nested.name === 'Source preview text')
    if (!child) throw new Error('Source preview missing')

    expect(updateSourceDocument(store, node.id, '<main>After</main>')).toBe(true)
    expect(readContentSource(node)).toMatchObject({ revision: 2, source: '<main>After</main>' })
    expect(child.text).toContain('After')

    store.undo.undo()
    expect(readContentSource(node)).toMatchObject({ revision: 1, source: '<main>Before</main>' })
    expect(child.text).toContain('Before')

    store.undo.redo()
    expect(readContentSource(node)).toMatchObject({ revision: 2, source: '<main>After</main>' })
    expect(child.text).toContain('After')
  })

  test('restores the complete source document through creation undo and redo', () => {
    const store = createEditorStore()
    const source = 'export const App = () => <main>Restored</main>'
    const documentNode = createSourceDocument(store, source, {
      fileName: 'restored.jsx',
      format: 'jsx'
    })

    store.undo.undo()
    expect(store.graph.getNode(documentNode.id)).toBeUndefined()

    store.undo.redo()
    const restored = store.graph.getNode(documentNode.id)
    expect(readContentSource(restored)).toMatchObject({ revision: 1, source })
    expect(store.graph.flattenTree(documentNode.id)).toHaveLength(6)
  })

  test('resolves the source owner from a selected preview descendant', () => {
    const store = createEditorStore()
    const source = 'export function Card() { return <article /> }'
    const documentNode = createSourceDocument(store, source, {
      fileName: 'Card.tsx',
      format: 'tsx'
    })
    const preview = store.graph
      .flattenTree(documentNode.id)
      .map(({ node }) => node)
      .find((node) => node.name === 'Source preview text')
    if (!preview) throw new Error('Source preview missing')

    expect(sourceDocumentForNode(store.graph, preview.id)).toMatchObject({
      node: { id: documentNode.id },
      source: { format: 'tsx', source }
    })
  })
})
