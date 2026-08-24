import { describe, expect, test } from 'bun:test'

import { MarkdownParser } from 'vue-stream-markdown'

import {
  assistantMarkdownNodes,
  createAssistantMarkdownParser,
  isSafeMarkdownImageUrl,
  type AssistantMarkdownNode
} from '@/components/ai-elements/markdown'

function walkNodes(nodes: AssistantMarkdownNode[]): AssistantMarkdownNode[] {
  return nodes.flatMap((node) => [node, ...walkNodes(node.children ?? [])])
}

describe('assistant markdown', () => {
  test('parses bold, lists, and inline code', () => {
    const parser = new MarkdownParser({ mode: 'static' })
    const result = parser.parseMarkdown('**What changed**\n\n- New-task empty state uses `pt-10`')
    expect(result.asts.length).toBeGreaterThan(0)
    const types = result.asts.flatMap((ast) => ast.children?.map((node) => node.type) ?? [])
    expect(types).toContain('paragraph')
    expect(types).toContain('list')
  })

  test('flattens parsed nodes for the chat renderer', () => {
    const nodes = assistantMarkdownNodes('**What changed**\n\n- uses `h-7`')
    expect(nodes.some((node) => node.type === 'paragraph')).toBe(true)
    expect(nodes.some((node) => node.type === 'list')).toBe(true)
  })

  test('parses table node types', () => {
    const nodes = walkNodes(assistantMarkdownNodes('| A | B |\n| --- | --- |\n| 1 | 2 |'))
    const types = nodes.map((node) => node.type)
    expect(types).toContain('table')
    expect(types).toContain('tableRow')
    expect(types).toContain('tableCell')
  })

  test('parses a safe image node', () => {
    const image = walkNodes(assistantMarkdownNodes('![alt](https://example.com/x.png)')).find(
      (node) => node.type === 'image'
    )
    expect(image?.url).toBe('https://example.com/x.png')
  })

  test('rejects unsafe image urls', () => {
    expect(isSafeMarkdownImageUrl('https://example.com/x.png')).toBe(true)
    expect(isSafeMarkdownImageUrl('http://example.com/x.png')).toBe(true)
    expect(isSafeMarkdownImageUrl('data:image/png;base64,abc')).toBe(true)
    expect(isSafeMarkdownImageUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeMarkdownImageUrl('data:text/html;base64,abc')).toBe(false)
    expect(isSafeMarkdownImageUrl('data:image/svg+xml;base64,abc')).toBe(false)
  })

  test('keeps completed streaming blocks while the live bubble grows', () => {
    const parser = createAssistantMarkdownParser('streaming')
    const first = parser.nodes('# Title\n\nHello')
    const second = parser.nodes('# Title\n\nHello world')
    expect(first[0]).toMatchObject({ type: 'heading' })
    expect(second[0]).toMatchObject({ type: 'heading' })
    expect(second.some((node) => node.type === 'paragraph')).toBe(true)
  })

  test('parses task-list checked flags', () => {
    const items = walkNodes(assistantMarkdownNodes('- [x] done\n- [ ] todo')).filter(
      (node) => node.type === 'listItem'
    )
    expect(items[0]?.checked).toBe(true)
    expect(items[1]?.checked).toBe(false)
  })
})
