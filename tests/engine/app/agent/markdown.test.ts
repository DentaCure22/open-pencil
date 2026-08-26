import { describe, expect, test } from 'bun:test'

import { MarkdownParser } from 'vue-stream-markdown'

import {
  assistantMarkdownNodes,
  createAssistantMarkdownParser,
  isSafeMarkdownImageUrl,
  type AssistantMarkdownBlock,
  type AssistantMarkdownNode
} from '@/components/ai-elements/markdown'

function walkNodes(nodes: AssistantMarkdownNode[]): AssistantMarkdownNode[] {
  return nodes.flatMap((node) => [node, ...walkNodes(node.children ?? [])])
}

function changedBlockCount(
  previous: readonly AssistantMarkdownBlock[],
  next: readonly AssistantMarkdownBlock[]
): number {
  return next.reduce(
    (count, block, index) => count + Number(block.root !== previous[index]?.root),
    0
  )
}

function completedBlocksStayedStable(
  previous: readonly AssistantMarkdownBlock[],
  next: readonly AssistantMarkdownBlock[]
): boolean {
  return next.slice(0, -1).every((block, index) => block.root === previous[index]?.root)
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
    // oxlint-disable-next-line eslint/no-script-url -- This is the unsafe input under test.
    expect(isSafeMarkdownImageUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeMarkdownImageUrl('data:text/html;base64,abc')).toBe(false)
    expect(isSafeMarkdownImageUrl('data:image/svg+xml;base64,abc')).toBe(false)
  })

  test('keeps completed streaming blocks while the live bubble grows', () => {
    const parser = createAssistantMarkdownParser('streaming')
    const first = parser.blocks('# Title\n\nA completed paragraph.\n\nHello')
    const second = parser.blocks('# Title\n\nA completed paragraph.\n\nHello world')
    expect(first[0]?.nodes[0]).toMatchObject({ type: 'heading' })
    expect(second[0]?.root).toBe(first[0]?.root)
    expect(second[0]?.nodes).toBe(first[0]?.nodes)
    expect(second[1]?.root).toBe(first[1]?.root)
    expect(second.at(-1)?.root).not.toBe(first.at(-1)?.root)
    expect(second.flatMap((block) => block.nodes).some((node) => node.type === 'paragraph')).toBe(
      true
    )
  })

  test('memoizes completed Markdown blocks in the chat renderer', async () => {
    const component = await Bun.file('src/components/ai-elements/AiMarkdown.vue').text()
    expect(component).toContain('parser.value.blocks')
    expect(component).toContain('v-memo="[block.root, streaming && index === blocks.length - 1]"')
    expect(component).toContain(':nodes="block.nodes"')
  })

  test('changes only the live tail across a long streamed answer', () => {
    const parser = createAssistantMarkdownParser('streaming')
    const completed = Array.from(
      { length: 60 },
      (_, index) => `## Section ${String(index + 1)}\n\nCompleted paragraph ${String(index + 1)}.`
    ).join('\n\n')
    let content = `${completed}\n\nLive tail`
    let previous = parser.blocks(content)

    for (const token of [
      ' keeps',
      ' growing',
      ' without',
      ' revisiting',
      ' completed',
      ' sections.'
    ]) {
      content += token
      const next = parser.blocks(content)
      expect(changedBlockCount(previous, next)).toBe(1)
      expect(completedBlocksStayedStable(previous, next)).toBe(true)
      previous = next
    }
  })

  test('parses task-list checked flags', () => {
    const items = walkNodes(assistantMarkdownNodes('- [x] done\n- [ ] todo')).filter(
      (node) => node.type === 'listItem'
    )
    expect(items[0]?.checked).toBe(true)
    expect(items[1]?.checked).toBe(false)
  })
})
