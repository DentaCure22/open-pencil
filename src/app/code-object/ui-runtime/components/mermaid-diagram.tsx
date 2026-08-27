import { useEffect, useState } from 'react'

import type { MermaidAppearance } from '@open-pencil/core/diagram'

import { renderMermaidSvgInBrowser } from '@/app/diagram/mermaid/render'

type MermaidDiagramState =
  | { status: 'loading' }
  | { message: string; status: 'error' }
  | { status: 'ready'; svg: string }

export function MermaidDiagram({
  appearance = 'auto',
  source
}: {
  appearance?: MermaidAppearance
  source: string
}) {
  const [result, setResult] = useState<MermaidDiagramState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    setResult({ status: 'loading' })
    void renderMermaidSvgInBrowser(source, appearance).then(
      (diagram) => {
        if (active) {
          setResult(
            diagram.svg
              ? { status: 'ready', svg: diagram.svg }
              : { message: 'The diagram renderer returned no SVG.', status: 'error' }
          )
        }
        return undefined
      },
      (error: unknown) => {
        if (active) {
          setResult({
            message: error instanceof Error ? error.message : 'The diagram could not be rendered.',
            status: 'error'
          })
        }
        return undefined
      }
    )
    return () => {
      active = false
    }
  }, [appearance, source])

  if (result.status === 'loading') {
    return (
      <div
        style={{
          padding: 18,
          border: '1px solid var(--code-border)',
          borderRadius: 12,
          color: 'var(--code-text-muted)',
          fontSize: 12
        }}
      >
        Rendering diagram…
      </div>
    )
  }

  if (result.status === 'error') {
    return (
      <div
        role="alert"
        style={{
          padding: 18,
          border: '1px solid var(--code-danger)',
          borderRadius: 12,
          color: 'var(--code-danger)',
          fontSize: 12
        }}
      >
        {result.message}
      </div>
    )
  }

  return (
    <div
      aria-label="Mermaid diagram"
      dangerouslySetInnerHTML={{ __html: result.svg }}
      role="img"
      style={{
        boxSizing: 'border-box',
        minHeight: 180,
        padding: 14,
        overflow: 'hidden',
        border: '1px solid var(--code-border)',
        borderRadius: 12,
        background: 'var(--code-surface)'
      }}
    />
  )
}
