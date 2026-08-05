import { describe, expect, test } from 'bun:test'

import {
  assertAllowedCodeObjectImports,
  preflightCodeObjectSource
} from '@open-pencil/core/code-object'

describe('Code Object static source preflight', () => {
  test('transpiles trusted TSX without evaluating authored source', async () => {
    const source = `
      import { useMemo } from 'react'
      const boot = (() => { throw new Error('authored source executed') })()
      export default function Metric({ state }: { state: { count?: number } }) {
        const value = useMemo(() => Number(state.count ?? 0), [state.count])
        return <strong>{value}{String(boot)}</strong>
      }
    `

    const proof = await preflightCodeObjectSource(source)

    expect(proof).toMatchObject({
      contract: 'code-object-static-preflight/v1',
      execution: 'not_attempted',
      sourceHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      sourceLength: source.length,
      syntax: 'passed',
      transformedHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      transformedLength: expect.any(Number),
      transforms: ['typescript', 'jsx', 'imports'],
      transpiler: 'sucrase'
    })
    expect(proof).not.toHaveProperty('source')
    expect(proof).not.toHaveProperty('transformed')
  })

  test('allows the guarded React and D3 module imports', async () => {
    expect(() => assertAllowedCodeObjectImports("import { extent } from 'd3'")).not.toThrow()
    expect(() => assertAllowedCodeObjectImports("import React from 'react'")).not.toThrow()
    expect(() =>
      assertAllowedCodeObjectImports("import { jsx } from 'react/jsx-runtime'")
    ).not.toThrow()
    expect(() =>
      assertAllowedCodeObjectImports("import type { Widget } from 'widget-sdk'")
    ).toThrow('unsupported module "widget-sdk"')
    await expect(
      preflightCodeObjectSource(`
        import { scaleLinear } from 'd3'
        export default function Chart() {
          const scale = scaleLinear([0, 10], [0, 100])
          return <svg><line x1={scale(2)} x2={scale(8)} /></svg>
        }
      `)
    ).resolves.toMatchObject({ syntax: 'passed' })
    await expect(
      preflightCodeObjectSource(`
        import Widget from 'widget-sdk'
        export default function Example() { return <Widget /> }
      `)
    ).rejects.toThrow('unsupported module "widget-sdk"')
  })

  test('rejects malformed, capability-bearing, dynamic, and non-default source', async () => {
    await expect(
      preflightCodeObjectSource('export default function Broken( { return <div /> }')
    ).rejects.toThrow('failed static TSX preflight')
    await expect(
      preflightCodeObjectSource(
        'fetch("/private"); export default function Blocked() { return <div /> }'
      )
    ).rejects.toThrow('blocked ambient capability "fetch"')
    await expect(
      preflightCodeObjectSource(
        'import("./remote"); export default function Blocked() { return <div /> }'
      )
    ).rejects.toThrow('blocked ambient capability "dynamic import"')
    await expect(
      preflightCodeObjectSource('export function NamedOnly() { return <div /> }')
    ).rejects.toThrow('directly default-export')
    for (const source of [
      'export default 1',
      'export default { view: "card" }',
      'export default class PlainClass {}',
      'const Card = () => <div />; export default Card'
    ]) {
      await expect(preflightCodeObjectSource(source)).rejects.toThrow('directly default-export')
    }
  })

  test('accepts direct function, class, and arrow component syntax', async () => {
    for (const source of [
      'export default function FunctionCard() { return <div /> }',
      'import React from "react"; export default class ClassCard extends React.Component { render() { return <div /> } }',
      'export default (props: { label: string }) => <div>{props.label}</div>',
      'export default props => <div>{props.label}</div>'
    ]) {
      await expect(preflightCodeObjectSource(source)).resolves.toMatchObject({ syntax: 'passed' })
    }
  })
})
