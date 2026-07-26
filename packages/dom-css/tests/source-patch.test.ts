import { describe, expect, test } from 'bun:test'

import { patchReactInlineStyle } from '../src/index'

describe('React source patches', () => {
  test('updates one literal inline style without regenerating the module', () => {
    const source = `
      export default function Card() {
        return <article data-open-pencil-source-id="card" style={{ width: 240, borderRadius: 12 }}>Card</article>
      }
    `
    const result = patchReactInlineStyle(source, {
      sourceId: 'card',
      property: 'borderRadius',
      value: 24
    })

    expect(result.code).toContain('style={{width: 240, borderRadius: 24}}')
    expect(result.code).toContain('export default function Card()')
    expect(result.message).toBe('Updated borderRadius on card')
  })

  test('adds a literal style to an explicitly identified JSX node', () => {
    const source = `export default () => <button id='rotate' onClick={() => 1}>Rotate</button>`
    const result = patchReactInlineStyle(source, {
      sourceId: 'rotate',
      property: 'opacity',
      value: 0.8
    })

    expect(result.code).toContain(`id='rotate' onClick={() => 1} style={{ opacity: 0.8 }}`)
  })

  test('rejects dynamic style objects instead of risking a broad rewrite', () => {
    const source = `export default () => <main id="app" style={{ ...theme, width }}>App</main>`
    expect(() =>
      patchReactInlineStyle(source, { sourceId: 'app', property: 'width', value: 320 })
    ).toThrow('only supports flat inline style objects')
  })
})
