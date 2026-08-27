import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { assistantMarkdownNodes, isSafeMarkdownUrl, type AssistantMarkdownNode } from './markdown'
import {
  nextStreamedLength,
  prefersStreamedTextMotion,
  sliceStreamedText,
  splitStreamedTextTail
} from './streamed-text'
import type { T3TimelineNarrativeEntry } from './t3-messages-timeline.logic'

const INITIAL_ANIMATED_TAIL_LENGTH = 18
const IDEAL_FRAME_MS = 1_000 / 60

function initialStreamedText(value: string): string {
  return sliceStreamedText(value, Math.max(0, value.length - INITIAL_ANIMATED_TAIL_LENGTH))
}

function useSmoothedText(text: string, streaming: boolean): string {
  const [displayed, setDisplayed] = useState(() =>
    streaming && prefersStreamedTextMotion() ? initialStreamedText(text) : text
  )
  const displayedRef = useRef(displayed)
  const incomingRef = useRef(text)
  const frameRef = useRef(0)
  const previousFrameAtRef = useRef(0)
  const streamingRef = useRef(streaming)

  useEffect(() => {
    displayedRef.current = displayed
  }, [displayed])

  useEffect(() => {
    streamingRef.current = streaming
    if (!prefersStreamedTextMotion()) {
      displayedRef.current = text
      incomingRef.current = text
      setDisplayed(text)
      return
    }
    if (!text.startsWith(displayedRef.current)) {
      // Provider rewrites are authoritative. Snapping the rewritten tail is
      // less disruptive than deleting already painted words frame by frame.
      displayedRef.current = text
      incomingRef.current = text
      previousFrameAtRef.current = 0
      setDisplayed(text)
      return
    }
    incomingRef.current = text

    const paint = (now: number) => {
      frameRef.current = 0
      const current = displayedRef.current
      const incoming = incomingRef.current
      if (current.length >= incoming.length) {
        if (current !== incoming) {
          displayedRef.current = incoming
          setDisplayed(incoming)
        }
        previousFrameAtRef.current = 0
        return
      }
      const elapsedMs = previousFrameAtRef.current
        ? now - previousFrameAtRef.current
        : IDEAL_FRAME_MS
      previousFrameAtRef.current = now
      const length = nextStreamedLength({
        displayed: current.length,
        elapsedMs,
        finishing: !streamingRef.current,
        incoming: incoming.length
      })
      const next = sliceStreamedText(incoming, length)
      displayedRef.current = next
      setDisplayed(next)
      if (next.length < incomingRef.current.length) frameRef.current = requestAnimationFrame(paint)
      else previousFrameAtRef.current = 0
    }

    if (displayedRef.current.length < incomingRef.current.length && !frameRef.current) {
      frameRef.current = requestAnimationFrame(paint)
    }
  }, [streaming, text])

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    },
    []
  )

  return displayed
}

function StreamingText({ active, text }: { active: boolean; text: string }) {
  if (!active) return text
  const split = splitStreamedTextTail(text)
  return (
    <>
      {split.stable}
      {split.tail.map((segment) =>
        segment.value !== undefined ? (
          segment.value
        ) : (
          <span className="t3-stream-word" key={segment.key}>
            {segment.glyphs?.map((glyph) => (
              <span className="t3-stream-glyph" key={glyph.key}>
                {glyph.value}
              </span>
            ))}
          </span>
        )
      )}
    </>
  )
}

function InlineMarkdownNode({
  active,
  children,
  node,
  nodeKey
}: {
  active: boolean
  children: ReactNode
  node: AssistantMarkdownNode
  nodeKey: string
}): ReactNode {
  switch (node.type) {
    case 'strong':
      return <strong key={nodeKey}>{children}</strong>
    case 'emphasis':
      return <em key={nodeKey}>{children}</em>
    case 'delete':
      return <del key={nodeKey}>{children}</del>
    case 'link':
      if (!isSafeMarkdownUrl(node.url)) return <span key={nodeKey}>{children}</span>
      return (
        <a href={node.url} key={nodeKey} rel="noreferrer" target="_blank">
          {children}
        </a>
      )
    case 'inlineCode':
      return <code key={nodeKey}>{node.value}</code>
    case 'code':
      return (
        <pre key={nodeKey}>
          <code>{node.value}</code>
        </pre>
      )
    case 'break':
      return <br key={nodeKey} />
    case 'thematicBreak':
      return <hr key={nodeKey} />
    case 'text':
      return <StreamingText active={active} key={nodeKey} text={node.value ?? ''} />
    default:
      if (children) return <span key={nodeKey}>{children}</span>
      return node.value ? <span key={nodeKey}>{node.value}</span> : null
  }
}

function MarkdownNodes({
  nodes,
  streamingTail = false
}: {
  nodes: AssistantMarkdownNode[]
  streamingTail?: boolean
}): ReactNode {
  return nodes.map((node, index) => {
    const active = streamingTail && index === nodes.length - 1
    const children = node.children?.length ? (
      <MarkdownNodes nodes={node.children} streamingTail={active} />
    ) : null
    const nodeKey = `${node.type}-${String(index)}`
    if (node.type === 'paragraph') return <p key={nodeKey}>{children}</p>
    if (node.type === 'heading') {
      const depth = Math.min(4, Math.max(1, node.depth ?? 2))
      if (depth === 1) return <h1 key={nodeKey}>{children}</h1>
      if (depth === 2) return <h2 key={nodeKey}>{children}</h2>
      if (depth === 3) return <h3 key={nodeKey}>{children}</h3>
      return <h4 key={nodeKey}>{children}</h4>
    }
    if (node.type === 'list') {
      if (node.ordered) return <ol key={nodeKey}>{children}</ol>
      return <ul key={nodeKey}>{children}</ul>
    }
    if (node.type === 'listItem') return <li key={nodeKey}>{children}</li>
    if (node.type === 'blockquote') return <blockquote key={nodeKey}>{children}</blockquote>
    return (
      <InlineMarkdownNode
        active={active}
        children={children}
        key={nodeKey}
        node={node}
        nodeKey={nodeKey}
      />
    )
  })
}

export const T3NarrativeRow = memo(function T3NarrativeRow({
  message
}: {
  message: T3TimelineNarrativeEntry
}) {
  const streaming = message.state === 'streaming'
  const displayed = useSmoothedText(message.text.trim(), streaming)
  const nodes = useMemo(() => assistantMarkdownNodes(displayed), [displayed])
  return (
    <div
      aria-live={streaming ? 'polite' : undefined}
      className="t3-activity-markdown min-w-0 px-1 py-0.5 font-sans text-[13px] leading-5 font-normal text-surface"
      data-state={message.state}
      data-test-id={message.narrativeKind === 'commentary' ? 'ai-commentary' : 'ai-reasoning'}
    >
      {nodes.length ? (
        <MarkdownNodes nodes={nodes} streamingTail={streaming} />
      ) : (
        <p>{displayed}</p>
      )}
    </div>
  )
})
