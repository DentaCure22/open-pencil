import { MarkdownParser } from 'vue-stream-markdown'

export type AssistantMarkdownNode = {
  align?: Array<'left' | 'right' | 'center' | null> | null
  alt?: string | null
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

const staticParser = new MarkdownParser({ mode: 'static' })

function flattenParsedNodes(content: string, parser: MarkdownParser): AssistantMarkdownNode[] {
  const text = content.trim()
  if (!text) return []
  return parser.parseMarkdown(text).asts.flatMap((ast) => {
    const children = 'children' in ast ? ast.children : []
    return (children ?? []) as AssistantMarkdownNode[]
  })
}

export function createAssistantMarkdownParser(mode: 'static' | 'streaming' = 'static') {
  const parser = new MarkdownParser({ mode })
  return {
    nodes(content: string): AssistantMarkdownNode[] {
      return flattenParsedNodes(content, parser)
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
