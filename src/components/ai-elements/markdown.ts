import { MarkdownParser } from 'vue-stream-markdown'

export type AssistantMarkdownNode = {
  align?: Array<'left' | 'right' | 'center' | null> | null
  alt?: string | null
  boardObjectId?: string
  checked?: boolean | null
  children?: AssistantMarkdownNode[]
  depth?: number
  lang?: string
  ordered?: boolean
  title?: string | null
  type: string
  url?: string
  value?: string
}

export type AssistantMarkdownBlock = {
  nodes: AssistantMarkdownNode[]
  root: object
  source: string
}

const staticParser = new MarkdownParser({ mode: 'static' })

function parsedBlocks(content: string, parser: MarkdownParser): AssistantMarkdownBlock[] {
  const text = content.trim()
  if (!text) return []
  const parsed = parser.parseMarkdown(text)
  return parsed.asts.map((ast, index) => ({
    nodes: ast.children as AssistantMarkdownNode[],
    root: ast,
    source: parsed.contents[index] ?? ''
  }))
}

function flattenParsedNodes(content: string, parser: MarkdownParser): AssistantMarkdownNode[] {
  return parsedBlocks(content, parser).flatMap((block) => block.nodes)
}

export function createAssistantMarkdownParser(mode: 'static' | 'streaming' = 'static') {
  const parser = new MarkdownParser({ mode })
  let retainedBlocks: AssistantMarkdownBlock[] = []

  function blocks(content: string): AssistantMarkdownBlock[] {
    const parsed = parsedBlocks(content, parser).map((block, index) => {
      const retained = index < retainedBlocks.length ? retainedBlocks[index] : undefined
      return retained && retained.source === block.source ? retained : block
    })
    retainedBlocks = parsed
    return parsed
  }

  return {
    blocks,
    nodes(content: string): AssistantMarkdownNode[] {
      return blocks(content).flatMap((block) => block.nodes)
    }
  }
}

export function assistantMarkdownNodes(
  content: string,
  mode: 'static' | 'streaming' = 'static'
): AssistantMarkdownNode[] {
  if (mode === 'static') return flattenParsedNodes(content, staticParser)
  return createAssistantMarkdownParser(mode).nodes(content)
}

export function isSafeMarkdownUrl(url: string | undefined): url is string {
  if (!url) return false
  return /^(https?:|mailto:|#)/i.test(url)
}

export function isSafeMarkdownImageUrl(url: string | undefined): url is string {
  if (!url) return false
  return /^(https?:\/\/|data:image\/(?:gif|jpeg|png|webp);base64,)/i.test(url)
}
