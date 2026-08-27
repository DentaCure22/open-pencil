import { describe, expect, test } from 'bun:test'

import { WORK_PLAN_CODE_OBJECT_SOURCE } from '@open-pencil/core/code-object'

import { clearCompiledCodeObjectCache, compileCodeObjectSource } from '@/app/code-object/compiler'

describe('authored Code Object compiler', () => {
  test('resolves the bundled D3 runtime for chart source', () => {
    clearCompiledCodeObjectCache()
    const compiled = compileCodeObjectSource(`
      import { max, scaleLinear } from 'd3'
      const highest = max([12, 42, 27])
      const scale = scaleLinear([0, highest ?? 0], [0, 100])
      export default function Chart() {
        return <svg><rect data-highest={highest} width={scale(highest ?? 0)} /></svg>
      }
    `)

    expect(compiled.error).toBeNull()
    expect(typeof compiled.component).toBe('function')
  })

  test('keeps unsupported packages outside the authored runtime', () => {
    const compiled = compileCodeObjectSource(`
      import widget from 'unknown-widget'
      export default function Example() { return <div>{widget}</div> }
    `)

    expect(compiled.component).toBeNull()
    expect(compiled.error).toContain('can only import')
  })

  test('resolves the rich work-plan renderer from the bundled UI runtime', () => {
    clearCompiledCodeObjectCache()
    const compiled = compileCodeObjectSource(WORK_PLAN_CODE_OBJECT_SOURCE)

    expect(compiled.error).toBeNull()
    expect(typeof compiled.component).toBe('function')
  })
})
