import { describe, expect, test } from 'bun:test'

import { parseOpenPencilClipboard } from '@open-pencil/core/clipboard'
import { readContentSource } from '@open-pencil/core/io'
import { markdownToSceneGraph } from '@open-pencil/core/io/formats/markdown'

import {
  hasOpenPencilOrFigmaClipboardHTML,
  isMarkdownIntakeFile,
  markdownClipboardPayload,
  markdownFileToSceneGraph,
  markdownSourceModeForFile,
  markdownTextFromClipboard,
  persistMarkdownSource
} from '@/app/shell/markdown'

describe('Markdown shell helpers', () => {
  test('recognizes bounded Markdown, MDX, and plain-text file intake', async () => {
    expect(isMarkdownIntakeFile({ name: 'notes.md' })).toBe(true)
    expect(isMarkdownIntakeFile({ name: 'notes.markdown' })).toBe(true)
    expect(isMarkdownIntakeFile({ name: 'notes.mdx' })).toBe(true)
    expect(isMarkdownIntakeFile({ name: 'notes.txt' })).toBe(true)
    expect(isMarkdownIntakeFile({ name: 'notes.ts' })).toBe(false)
    expect(markdownSourceModeForFile('notes.mdx')).toBe('mdx')
    expect(markdownSourceModeForFile('notes.txt')).toBe('plain-text')

    const graph = await markdownFileToSceneGraph(
      new File(['# Literal'], 'notes.txt', { type: 'text/plain' })
    )
    const document = graph.getChildren(graph.getPages()[0].id)[0]
    expect(document.childIds).toEqual([])
    expect(readContentSource(document)).toMatchObject({
      mimeType: 'text/plain;charset=utf-8',
      source: '# Literal'
    })
  })

  test('prefers explicit Markdown clipboard data and identifies native design payloads', () => {
    const values = new Map([
      ['text/markdown', '# Explicit'],
      ['text/plain', 'Fallback']
    ])
    const clipboard = { getData: (type: string) => values.get(type) ?? '' }

    expect(markdownTextFromClipboard(clipboard)).toBe('# Explicit')
    expect(hasOpenPencilOrFigmaClipboardHTML('<!--(openpencil)payload')).toBe(true)
    expect(hasOpenPencilOrFigmaClipboardHTML('<!--(figmeta)payload')).toBe(true)
    expect(hasOpenPencilOrFigmaClipboardHTML('<strong>web content</strong>')).toBe(false)
  })

  test('builds a single source-backed OpenPencil clipboard object from Markdown', async () => {
    const source = '# Pasted\n\nA **normal** Markdown document.'
    const payload = await markdownClipboardPayload(source)
    const parsed = parseOpenPencilClipboard(payload.html)
    const pasted = parsed?.nodes[0]
    if (!pasted) throw new Error('Pasted Markdown frame not found')

    expect(payload.text).toContain('# Pasted')
    expect(parsed?.nodes).toHaveLength(1)
    expect(pasted.name).toBe('Pasted Markdown')
    expect(pasted.children).toBeUndefined()
    expect(readContentSource(pasted)).toMatchObject({ source })
  })

  test('persists regenerated Markdown and rolls metadata back when the writer fails', async () => {
    const graph = await markdownToSceneGraph('# Notes\n\nOriginal\n', {
      fileName: 'notes.md',
      representation: 'native'
    })
    const document = graph.getChildren(graph.getPages()[0].id)[0]
    const paragraph = [...graph.getAllNodes()].find(
      (node) => node.type === 'TEXT' && node.text === 'Original'
    )
    if (!paragraph) throw new Error('Paragraph not found')
    graph.updateNode(paragraph.id, { text: 'Saved' })

    let saved = ''
    const result = await persistMarkdownSource(graph, async (data) => {
      saved = new TextDecoder().decode(data)
    })
    expect(result).toMatchObject({ changed: true, revision: 2 })
    expect(saved).toBe('# Notes\n\nSaved\n')
    expect(readContentSource(document)?.revision).toBe(2)

    graph.updateNode(paragraph.id, { text: 'Unsaved' })
    await expect(
      persistMarkdownSource(graph, async () => {
        throw new Error('Disk full')
      })
    ).rejects.toThrow('Disk full')
    expect(readContentSource(document)).toMatchObject({ revision: 2, source: saved })
  })
})
