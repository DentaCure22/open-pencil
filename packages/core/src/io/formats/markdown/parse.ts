import { marked, type Token, type Tokens, type TokensList } from 'marked'

import type {
  MarkdownInlineContent,
  MarkdownInlineLink,
  MarkdownInlineRun,
  MarkdownInlineStyle,
  MarkdownSourceMode
} from './types'

interface InlineBuilder {
  text: string
  runs: MarkdownInlineRun[]
  links: MarkdownInlineLink[]
}

function stylesEqual(left: MarkdownInlineStyle, right: MarkdownInlineStyle): boolean {
  return (
    left.code === right.code &&
    left.emphasis === right.emphasis &&
    left.link === right.link &&
    left.strike === right.strike &&
    left.strong === right.strong
  )
}

function appendText(builder: InlineBuilder, text: string, style: MarkdownInlineStyle): void {
  if (!text) return
  const start = builder.text.length
  builder.text += text
  if (!Object.values(style).some(Boolean)) return

  const previous = builder.runs.at(-1)
  if (
    previous &&
    previous.start + previous.length === start &&
    stylesEqual(previous.style, style)
  ) {
    previous.length += text.length
    return
  }
  builder.runs.push({ start, length: text.length, style: { ...style } })
}

function nestedTextToken(
  builder: InlineBuilder,
  tokens: Token[] | undefined,
  fallback: string,
  style: MarkdownInlineStyle
): void {
  if (tokens) appendTokens(builder, tokens, style)
  else appendText(builder, fallback, style)
}

function appendToken(builder: InlineBuilder, token: Token, style: MarkdownInlineStyle): void {
  switch (token.type) {
    case 'br':
      appendText(builder, '\n', style)
      return
    case 'checkbox':
      appendText(builder, (token as Tokens.Checkbox).checked ? '[x] ' : '[ ] ', style)
      return
    case 'codespan':
      appendText(builder, (token as Tokens.Codespan).text, { ...style, code: true })
      return
    case 'del': {
      const value = token as Tokens.Del
      nestedTextToken(builder, value.tokens, value.text, { ...style, strike: true })
      return
    }
    case 'em': {
      const value = token as Tokens.Em
      nestedTextToken(builder, value.tokens, value.text, { ...style, emphasis: true })
      return
    }
    case 'escape':
      appendText(builder, (token as Tokens.Escape).text, style)
      return
    case 'html':
      appendText(builder, (token as Tokens.HTML).text, style)
      return
    case 'image': {
      const value = token as Tokens.Image
      appendText(builder, value.text || value.title || value.href, style)
      return
    }
    case 'link': {
      const value = token as Tokens.Link
      const start = builder.text.length
      nestedTextToken(builder, value.tokens, value.text, { ...style, link: true })
      const length = builder.text.length - start
      if (length > 0) {
        builder.links.push({
          start,
          length,
          href: value.href,
          ...(value.title ? { title: value.title } : {})
        })
      }
      return
    }
    case 'strong': {
      const value = token as Tokens.Strong
      nestedTextToken(builder, value.tokens, value.text, { ...style, strong: true })
      return
    }
    case 'text': {
      const value = token as Tokens.Text
      nestedTextToken(builder, value.tokens, value.text, style)
      return
    }
    default:
      appendText(builder, token.raw, style)
  }
}

function appendTokens(
  builder: InlineBuilder,
  tokens: Token[],
  style: MarkdownInlineStyle = {}
): void {
  for (const token of tokens) appendToken(builder, token, style)
}

function concatenateInlineContent(parts: MarkdownInlineContent[]): MarkdownInlineContent {
  const result: MarkdownInlineContent = { text: '', runs: [], links: [] }
  for (const [index, part] of parts.entries()) {
    if (index > 0) result.text += '\n'
    const offset = result.text.length
    result.text += part.text
    result.runs.push(
      ...part.runs.map((run) => ({ ...run, start: run.start + offset, style: { ...run.style } }))
    )
    result.links.push(...part.links.map((link) => ({ ...link, start: link.start + offset })))
  }
  return result
}

function plainTextTokens(source: string): TokensList {
  const paragraph: Tokens.Paragraph = {
    type: 'paragraph',
    raw: source,
    text: source,
    tokens: [{ type: 'text', raw: source, text: source }]
  }
  return Object.assign<Token[], { links: TokensList['links'] }>([paragraph], { links: {} })
}

export function markdownInlineContent(tokens: Token[]): MarkdownInlineContent {
  const builder: InlineBuilder = { text: '', runs: [], links: [] }
  appendTokens(builder, tokens)
  return builder
}

export function markdownInlineText(tokens: Token[]): string {
  return markdownInlineContent(tokens).text
}

export function markdownTokens(
  source: string,
  sourceMode: MarkdownSourceMode = 'markdown'
): TokensList {
  if (sourceMode === 'plain-text') return plainTextTokens(source)
  return marked.lexer(source, { gfm: true })
}

export function paragraphImage(token: Tokens.Paragraph): Tokens.Image | null {
  const meaningful = token.tokens.filter((item) => item.type !== 'space')
  if (meaningful.length !== 1 || meaningful[0]?.type !== 'image') return null
  return meaningful[0] as Tokens.Image
}

export function listItemText(item: Tokens.ListItem): string {
  return listItemInlineContent(item).text
}

export function listItemInlineContent(item: Tokens.ListItem): MarkdownInlineContent {
  const parts = item.tokens
    .filter((token) => token.type !== 'list')
    .map((token) => {
      if (token.type === 'paragraph') {
        const paragraph = token as Tokens.Paragraph
        return markdownInlineContent(paragraph.tokens)
      }
      if (token.type === 'text') {
        const text = token as Tokens.Text
        return text.tokens
          ? markdownInlineContent(text.tokens)
          : { text: text.text, runs: [], links: [] }
      }
      return { text: token.raw.trim(), runs: [], links: [] }
    })
    .filter((part) => part.text)
  const content = concatenateInlineContent(parts)
  if (!item.task) return content

  const marker = /^\[[ xX]\]\s*/.exec(content.text)?.[0]
  if (!marker) return content
  const offset = marker.length
  return {
    text: content.text.slice(offset),
    runs: content.runs
      .map((run) => ({ ...run, start: run.start - offset }))
      .filter((run) => run.start >= 0 && run.length > 0),
    links: content.links
      .map((link) => ({ ...link, start: link.start - offset }))
      .filter((link) => link.start >= 0 && link.length > 0)
  }
}
