import { describe, expect, test } from 'bun:test'

import { createMermaidSvgSpec } from '@open-pencil/core/diagram'
import {
  BUILTIN_IO_FORMATS,
  IORegistry,
  markdownToSceneGraph,
  mergeContentSourcePluginData,
  readContentSource
} from '@open-pencil/core/io'
import {
  markdownFromSceneGraph,
  writeMarkdownDocument
} from '@open-pencil/core/io/formats/markdown'
import type { MarkdownImportOptions } from '@open-pencil/core/io/formats/markdown'
import type { SceneNode } from '@open-pencil/scene-graph'

function nativeMarkdown(source: string, options: MarkdownImportOptions = {}) {
  return markdownToSceneGraph(source, { ...options, representation: 'native' })
}

function markdownKind(node: SceneNode): string | null {
  return (
    node.pluginData.find(
      (entry) => entry.pluginId === 'open-pencil' && entry.key === 'markdown/block-kind'
    )?.value ?? null
  )
}

function pluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

describe('Markdown document import', () => {
  test('registers Markdown as a readable source document', () => {
    const registry = new IORegistry(BUILTIN_IO_FORMATS)

    expect(registry.findReader('notes.md')?.id).toBe('markdown')
    expect(registry.findReader('notes.markdown')?.id).toBe('markdown')
    expect(registry.findReader('notes.mdx')?.id).toBe('markdown')
    expect(registry.findReader('notes.txt')?.id).toBe('markdown')
  })

  test('creates one source-authoritative frame by default and exports the exact source', async () => {
    const source = '# Notes\n\nA **normal** Markdown document.\n'
    const graph = await markdownToSceneGraph(source, { fileName: 'notes.md' })
    const page = graph.getPages()[0]
    const document = graph.getChildren(page.id)[0]

    expect(page.name).toBe('notes')
    expect(document).toMatchObject({
      childIds: [],
      clipsContent: true,
      fills: [
        {
          color: { a: 1, b: 1, g: 1, r: 1 },
          opacity: 1,
          type: 'SOLID',
          visible: true
        }
      ],
      height: 720,
      layoutMode: 'NONE',
      name: 'notes',
      type: 'FRAME',
      width: 820
    })
    expect(readContentSource(document)).toMatchObject({
      fileName: 'notes.md',
      format: 'markdown',
      revision: 1,
      source
    })
    expect(markdownFromSceneGraph(graph)).toBe(source)
    expect(writeMarkdownDocument(graph)).toMatchObject({
      changed: false,
      revision: 1,
      source
    })
  })

  test('creates editable native blocks only when explicitly converted', async () => {
    const source = `# Release notes

This is a paragraph with [a source](https://example.com).

- First item
- [x] Finished task
- [ ] Open task

> A quoted decision.

| Owner | State |
| --- | --- |
| Omar | Ready |

![Reference](./reference.png)

---

\`\`\`ts
const ready = true
\`\`\`
`
    const graph = await nativeMarkdown(source, {
      fileName: 'release-notes.md',
      mimeType: 'text/markdown'
    })
    const page = graph.getPages()[0]
    const document = graph.getChildren(page.id)[0]
    const nodes = [...graph.getAllNodes()]
    const kinds = new Set(nodes.map(markdownKind).filter((kind) => kind !== null))

    expect(page.name).toBe('release-notes')
    expect(document.name).toBe('release-notes')
    expect(document.layoutMode).toBe('VERTICAL')
    expect(document.childIds.length).toBeGreaterThan(6)
    expect(readContentSource(document)).toEqual({
      format: 'markdown',
      mimeType: 'text/markdown',
      fileName: 'release-notes.md',
      revision: 1,
      source
    })
    expect([...kinds]).toEqual(
      expect.arrayContaining([
        'heading-1',
        'paragraph',
        'list',
        'task-item',
        'blockquote',
        'table',
        'image',
        'divider',
        'code'
      ])
    )
    expect(nodes.some((node) => node.type === 'TEXT' && node.text === 'Release notes')).toBe(true)
    expect(nodes.some((node) => node.name === 'Completed task')).toBe(true)
    expect(nodes.some((node) => node.name === 'Open task')).toBe(true)
    expect(nodes.some((node) => node.type === 'TEXT' && node.text === 'Finished task')).toBe(true)
    expect(nodes.some((node) => node.type === 'TEXT' && node.text === 'Open task')).toBe(true)
    expect(nodes.some((node) => node.type === 'TEXT' && /^\[[ xX]\]/.test(node.text))).toBe(false)
    expect(nodes.some((node) => node.name === 'Table header')).toBe(true)
  })

  test('turns Mermaid fences into one SVG-backed frame through the host renderer', async () => {
    const source = '```mermaid\nflowchart LR\n A[Start] --> B[Finish]\n```'
    const graph = await nativeMarkdown(source, {
      fileName: 'flow.md',
      createMermaidScene: async (definition) =>
        createMermaidSvgSpec(definition, { width: 240, height: 80 })
    })
    const nodes = [...graph.getAllNodes()]
    const diagram = nodes.find((node) => markdownKind(node) === 'mermaid')
    const diagramId = diagram?.pluginData.find((entry) => entry.key === 'mermaid/diagram-id')?.value

    expect(diagram?.type).toBe('FRAME')
    expect(diagramId).toBeTruthy()
    expect(nodes.filter((node) => node.parentId === diagram?.id)).toHaveLength(0)
    expect(pluginValue(diagram as SceneNode, 'mermaid/role')).toBe('diagram')
    expect(markdownFromSceneGraph(graph)).toContain(
      '```mermaid\nflowchart LR\n A[Start] --> B[Finish]\n```'
    )
  })

  test('maps inline Markdown styles to editable text runs and retains link targets', async () => {
    const graph = await nativeMarkdown(
      'Plain **bold and *italic*** plus `code`, ~~removed~~, and [source](https://example.com "Docs").'
    )
    const paragraph = [...graph.getAllNodes()].find(
      (node) => node.type === 'TEXT' && markdownKind(node) === 'paragraph'
    )

    expect(paragraph?.text).toBe('Plain bold and italic plus code, removed, and source.')
    expect(
      paragraph?.styleRuns.some((run) => run.style.fontWeight === 700 && run.style.italic === true)
    ).toBe(true)
    expect(paragraph?.styleRuns.some((run) => run.style.fontFamily === 'Roboto Mono')).toBe(true)
    expect(paragraph?.styleRuns.some((run) => run.style.textDecoration === 'STRIKETHROUGH')).toBe(
      true
    )
    expect(paragraph?.styleRuns.some((run) => run.style.textDecoration === 'UNDERLINE')).toBe(true)
    expect(
      JSON.parse(pluginValue(paragraph as SceneNode, 'markdown/inline-links') ?? '[]')
    ).toEqual([
      {
        start: 46,
        length: 6,
        href: 'https://example.com',
        title: 'Docs'
      }
    ])
    expect(markdownFromSceneGraph(graph)).toContain('[source](https://example.com "Docs")')
  })

  test('stores resolved data images as source-backed image fills', async () => {
    const source = '![Embedded](data:image/png;base64,AQIDBA==)'
    const graph = await nativeMarkdown(source)
    const imageFrame = [...graph.getAllNodes()].find((node) => markdownKind(node) === 'image')
    const imageNode = imageFrame
      ? graph
          .getChildren(imageFrame.id)
          .find((node) => node.fills.some((fill) => fill.type === 'IMAGE'))
      : null
    const imageFill = imageNode?.fills.find((fill) => fill.type === 'IMAGE')

    expect(imageFill?.type).toBe('IMAGE')
    expect(imageFill?.imageHash).toBeTruthy()
    expect(graph.images.get(imageFill?.imageHash ?? '')).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(pluginValue(imageFrame as SceneNode, 'markdown/href')).toBe(
      'data:image/png;base64,AQIDBA=='
    )
    expect(markdownFromSceneGraph(graph)).toBe(`${source}\n`)
  })

  test('fetches remote image bytes without credentials while retaining the source URL', async () => {
    const originalFetch = globalThis.fetch
    let request: RequestInit | undefined
    globalThis.fetch = async (_input, init) => {
      request = init
      return new Response(new Uint8Array([9, 8, 7]), {
        headers: { 'content-type': 'image/png' },
        status: 200
      })
    }
    try {
      const graph = await nativeMarkdown('![Remote](https://example.com/image.png)')
      const imageNode = [...graph.getAllNodes()].find((node) =>
        node.fills.some((fill) => fill.type === 'IMAGE')
      )
      const imageHash = imageNode?.fills.find((fill) => fill.type === 'IMAGE')?.imageHash

      expect(request).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
      expect(graph.images.get(imageHash ?? '')).toEqual(new Uint8Array([9, 8, 7]))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('keeps an explicit placeholder when an image resolver fails', async () => {
    const graph = await nativeMarkdown('![Remote](https://example.com/image.png)', {
      resolveImage: async () => {
        throw new Error('Offline')
      }
    })
    const imageFrame = [...graph.getAllNodes()].find((node) => markdownKind(node) === 'image')
    const children = imageFrame ? graph.getChildren(imageFrame.id) : []

    expect(pluginValue(imageFrame as SceneNode, 'markdown/error')).toBe('Offline')
    expect(children.some((node) => node.name === 'Image status' && node.text === 'Offline')).toBe(
      true
    )
    expect(children.some((node) => node.fills.some((fill) => fill.type === 'IMAGE'))).toBe(false)
  })

  test('supports inert MDX and literal plain-text fallback modes', async () => {
    const mdx = await nativeMarkdown('# Notes\n\n<Card title="Safe" />', {
      fileName: 'notes.mdx',
      sourceMode: 'mdx'
    })
    const plainText = await nativeMarkdown('# Literal heading\n- Literal list', {
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      sourceMode: 'plain-text'
    })
    const plainNodes = [...plainText.getAllNodes()]

    expect(mdx.getPages()[0]?.name).toBe('notes')
    expect([...mdx.getAllNodes()].some((node) => markdownKind(node) === 'code')).toBe(true)
    expect(plainText.getPages()[0]?.name).toBe('notes')
    expect(plainNodes.some((node) => markdownKind(node) === 'heading-1')).toBe(false)
    expect(
      plainNodes.some(
        (node) => node.type === 'TEXT' && node.text === '# Literal heading\n- Literal list'
      )
    ).toBe(true)
  })

  test('regenerates edited Markdown and increments revisions only when source changes', async () => {
    const graph = await nativeMarkdown('# Notes\n\nOriginal\n', { fileName: 'notes.md' })
    const paragraph = [...graph.getAllNodes()].find(
      (node) => node.type === 'TEXT' && markdownKind(node) === 'paragraph'
    )
    const document = graph.getChildren(graph.getPages()[0].id)[0]
    if (!paragraph) throw new Error('Paragraph not found')

    expect(writeMarkdownDocument(graph)).toMatchObject({ changed: false, revision: 1 })
    graph.updateNode(paragraph.id, {
      text: 'Updated strongly',
      styleRuns: [{ start: 8, length: 8, style: { fontWeight: 700 } }]
    })

    const result = writeMarkdownDocument(graph)
    expect(result).toMatchObject({ changed: true, revision: 2 })
    expect(result.source).toBe('# Notes\n\nUpdated **strongly**\n')
    expect(readContentSource(document)).toEqual({
      format: 'markdown',
      mimeType: 'text/markdown',
      fileName: 'notes.md',
      revision: 2,
      source: '# Notes\n\nUpdated **strongly**\n'
    })
    expect(writeMarkdownDocument(graph)).toMatchObject({ changed: false, revision: 2 })
  })

  test('regenerates lists, tasks, quotes, tables, dividers, and fenced code', async () => {
    const graph = await nativeMarkdown(`# Structured

- [x] Done
- Open

> Quoted

| Owner | State |
| --- | --- |
| Omar | Ready |

---

\`\`\`ts
const ready = true
\`\`\`
`)
    const source = markdownFromSceneGraph(graph)

    expect(source).toContain('- [x] Done\n- Open')
    expect(source).toContain('> Quoted')
    expect(source).toContain('| Owner | State |\n| --- | --- |\n| Omar | Ready |')
    expect(source).toContain('\n---\n')
    expect(source).toContain('```ts\nconst ready = true\n```')
  })

  test('replaces only the shared content-source metadata namespace', async () => {
    const graph = await markdownToSceneGraph('# Original')
    const document = graph.getChildren(graph.getPages()[0].id)[0]
    const merged = mergeContentSourcePluginData(
      [...document.pluginData, { pluginId: 'another-plugin', key: 'source', value: 'keep me' }],
      {
        format: 'markdown',
        mimeType: 'text/markdown',
        fileName: 'updated.md',
        revision: 2,
        source: '# Updated'
      }
    )

    expect(readContentSource({ pluginData: merged })).toEqual({
      format: 'markdown',
      mimeType: 'text/markdown',
      fileName: 'updated.md',
      revision: 2,
      source: '# Updated'
    })
    expect(merged).toContainEqual({
      pluginId: 'another-plugin',
      key: 'source',
      value: 'keep me'
    })
  })
})
