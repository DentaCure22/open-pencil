import { describe, expect, test } from 'bun:test'

import {
  createHeadlessCSSRuntime,
  reactSourceToDesignDocument,
  reactSourceToSceneGraph,
  reconcileDesignDocumentToSceneGraph
} from '../src/index'

function pluginValue(
  node: { pluginData: Array<{ pluginId: string; key: string; value: string }> } | null | undefined,
  key: string
): string | undefined {
  return node?.pluginData.find(
    (item) => item.pluginId === 'open-pencil-dom-css' && item.key === key
  )?.value
}

describe('@open-pencil/dom-css React source', () => {
  test('turns React state and events into native editable metadata', async () => {
    const source = `
      import React, { useState } from 'react'
      export default function Globe() {
        const [longitude] = useState(-97)
        const rotate = () => undefined
        return (
          <main data-open-pencil-source-id="globe" className="dashboard">
            <button
              data-open-pencil-source-id="globe-control"
              data-open-pencil-bind-state="0:rotation"
              onClick={rotate}
            >Rotate {longitude}°</button>
          </main>
        )
      }
    `
    const graph = await reactSourceToSceneGraph(source, {
      runtime: createHeadlessCSSRuntime(),
      cssText: '.dashboard { display: flex; width: 720px; height: 480px; padding: 32px; }'
    })
    const page = graph.getPages()[0]
    const globe = page ? graph.getChildren(page.id)[0] : undefined
    const control = globe ? graph.getChildren(globe.id)[0] : undefined

    expect(globe?.type).toBe('FRAME')
    expect(globe?.width).toBe(720)
    expect(pluginValue(globe, 'source-id')).toBe('globe')
    expect(pluginValue(control, 'source-id')).toBe('globe-control')
    expect(JSON.parse(pluginValue(control, 'source-interactions') ?? '[]')).toEqual([
      { event: 'click', handler: 'rotate' }
    ])
    expect(graph.variableCollections.size).toBe(1)
    expect([...graph.variables.values()][0]?.valuesByMode).toContainValue(-97)
    expect(control?.boundVariables.rotation).toBe([...graph.variables.keys()][0])
  })

  test('keeps stable node IDs and preserves manual canvas overrides during re-import', async () => {
    const initialSource = `
      export default function Card() {
        return <article data-open-pencil-source-id="card" style={{ width: 240, height: 120, borderRadius: 12 }}>First</article>
      }
    `
    const graph = await reactSourceToSceneGraph(initialSource)
    const page = graph.getPages()[0]
    const card = page ? graph.getChildren(page.id)[0] : undefined
    expect(card).toBeDefined()
    if (!card) return

    const stableId = card.id
    graph.updateNode(card.id, { cornerRadius: 99 })

    const nextDocument = await reactSourceToDesignDocument(`
      export default function Card() {
        return <article data-open-pencil-source-id="card" style={{ width: 320, height: 120, borderRadius: 24 }}>Second</article>
      }
    `)
    const result = reconcileDesignDocumentToSceneGraph(graph, nextDocument, {
      parentId: page?.id
    })
    const reconciled = graph.getNode(stableId)

    expect(reconciled?.id).toBe(stableId)
    expect(reconciled?.width).toBe(320)
    expect(reconciled?.cornerRadius).toBe(99)
    expect(pluginValue(reconciled, 'source-status')).toBe('conflict')
    expect(result.created).toBe(0)
    expect(result.preservedOverrides).toBeGreaterThan(0)
  })

  test('keeps text styling and identity without duplicate wrapper layers', async () => {
    const source = `
      import React, { useState } from 'react'
      export default function Label() {
        const [count] = useState(4)
        return <main data-open-pencil-source-id="root"><strong data-open-pencil-source-id="label">Count {count}</strong></main>
      }
    `
    const cssText = '.root {} strong { width: 180px; font-size: 32px; color: #112233; }'
    const runtime = createHeadlessCSSRuntime()
    const graph = await reactSourceToSceneGraph(source, { cssText, runtime })
    const page = graph.getPages()[0]
    const before = [...graph.getAllNodes()]
    const label = before.find((node) => pluginValue(node, 'source-id') === 'label')

    expect(label).toMatchObject({ type: 'TEXT', text: 'Count 4', width: 180, fontSize: 32 })
    if (!label) return

    const nextDocument = await reactSourceToDesignDocument(source, { cssText, runtime })
    reconcileDesignDocumentToSceneGraph(graph, nextDocument, { parentId: page?.id })

    expect([...graph.getAllNodes()]).toHaveLength(before.length)
    expect(graph.getNode(label.id)?.text).toBe('Count 4')
  })

  test('stores post-layout baselines so nested source changes still re-import', async () => {
    const initialSource = `
      export default function Row() {
        return <main data-open-pencil-source-id="row" className="row"><div data-open-pencil-source-id="chip" style={{ width: 80, height: 40 }}>Chip</div></main>
      }
    `
    const cssText = '.row { display: flex; width: 320px; height: 96px; padding: 20px; gap: 12px; }'
    const graph = await reactSourceToSceneGraph(initialSource, { cssText })
    const page = graph.getPages()[0]
    const chip = [...graph.getAllNodes()].find((node) => pluginValue(node, 'source-id') === 'chip')
    expect(chip).toBeDefined()
    if (!chip) return

    const baseline = JSON.parse(pluginValue(chip, 'source-baseline') ?? '{}') as {
      width?: number
      x?: number
    }
    expect(baseline).toMatchObject({ width: chip.width, x: chip.x })
    graph.updateNode(chip.id, { cornerRadius: 19 })

    const nextDocument = await reactSourceToDesignDocument(
      initialSource.replace('width: 80', 'width: 112'),
      { cssText }
    )
    reconcileDesignDocumentToSceneGraph(graph, nextDocument, { parentId: page?.id })

    expect(graph.getNode(chip.id)).toMatchObject({ width: 112, cornerRadius: 19 })
  })

  test('deletes unchanged removed source layers but detaches edited ones', async () => {
    const initial = await reactSourceToSceneGraph(`
      export default function List() {
        return <main data-open-pencil-source-id="list">
          <div data-open-pencil-source-id="remove-me" style={{ width: 80 }}>Remove</div>
          <div data-open-pencil-source-id="keep-me" style={{ width: 80 }}>Keep</div>
        </main>
      }
    `)
    const page = initial.getPages()[0]
    const root = page ? initial.getChildren(page.id)[0] : undefined
    const [removeMe, keepMe] = root ? initial.getChildren(root.id) : []
    expect(removeMe).toBeDefined()
    expect(keepMe).toBeDefined()
    if (!removeMe || !keepMe) return
    initial.updateNode(keepMe.id, { width: 96 })

    const next = await reactSourceToDesignDocument(`
      export default function List() {
        return <main data-open-pencil-source-id="list" />
      }
    `)
    const result = reconcileDesignDocumentToSceneGraph(initial, next, { parentId: page?.id })

    expect(initial.getNode(removeMe.id)).toBeUndefined()
    expect(initial.getNode(keepMe.id)?.width).toBe(96)
    expect(pluginValue(initial.getNode(keepMe.id), 'source-status')).toBe('detached')
    expect(result.deleted).toBe(1)
    expect(result.detached).toBe(1)
  })
})
