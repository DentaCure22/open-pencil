import { describe, expect, test } from 'bun:test'

import { evaluateReactSource, type ReactSourceElement } from '@open-pencil/core/design-jsx'

function elementAt(value: unknown): ReactSourceElement {
  expect(value).toBeObject()
  const element = value as ReactSourceElement
  expect(element.type).toBe('element')
  return element
}

describe('React source evaluation', () => {
  test('evaluates self-contained TSX components and deterministic hook state', () => {
    const result = evaluateReactSource(
      `
        import React, { useMemo, useState } from 'react'

        function Metric({ label, value }: { label: string; value: string }) {
          return <article data-open-pencil-source-id={label}><span>{label}</span><strong>{value}</strong></article>
        }

        export default function GlobeDashboard() {
          const [longitude] = useState(-97)
          const label = useMemo(() => longitude + '°', [longitude])
          return <main id="globe-dashboard"><Metric label="Longitude" value={label} /></main>
        }
      `,
      { stateValues: [24] }
    )

    expect(result.componentName).toBe('GlobeDashboard')
    expect(result.states).toEqual([{ index: 0, initialValue: -97, value: 24 }])
    expect(result.warnings).toEqual([])

    const root = elementAt(result.children[0])
    const metric = elementAt(root.children[0])
    const value = elementAt(metric.children[1])
    expect(root.tagName).toBe('main')
    expect(metric.props['data-open-pencil-source-id']).toBe('Longitude')
    expect(value.children).toEqual(['24°'])
  })

  test('retains unsupported imported components as labelled editable fallbacks', () => {
    const result = evaluateReactSource(`
      import React from 'react'
      import { OrbitGlobe } from '@example/maps'
      export default function App() {
        return <OrbitGlobe id="world" />
      }
    `)

    const fallback = elementAt(result.children[0])
    expect(fallback.tagName).toBe('div')
    expect(fallback.props['data-open-pencil-unsupported-component']).toBe(
      '@example/maps:OrbitGlobe'
    )
    expect(result.warnings[0]).toContain('editable fallback frame')
  })
})
