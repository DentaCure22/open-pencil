import { describe, expect, test } from 'bun:test'

import { createCodeObject, createUserCodeObjectDocument } from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'

describe('container navigation', () => {
  test('enters explicitly and traverses direct child containers spatially', () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const parent = store.graph.createNode('FRAME', pageId, {
      height: 800,
      name: 'Parent',
      width: 1000,
      x: 100,
      y: 100
    })
    const topLeft = store.graph.createNode('FRAME', parent.id, {
      height: 120,
      name: 'Top left',
      width: 160,
      x: 40,
      y: 40
    })
    const topRight = store.graph.createNode('GROUP', parent.id, {
      height: 120,
      name: 'Top right',
      width: 160,
      x: 440,
      y: 40
    })
    const bottomRight = store.graph.createNode('SECTION', parent.id, {
      height: 120,
      name: 'Bottom right',
      width: 160,
      x: 440,
      y: 420
    })
    store.graph.createNode('RECTANGLE', parent.id, {
      height: 40,
      name: 'Ignored leaf',
      width: 40,
      x: 240,
      y: 40
    })
    const nested = store.graph.createNode('FRAME', topRight.id, {
      height: 60,
      name: 'Nested',
      width: 80,
      x: 20,
      y: 20
    })

    store.select([parent.id])
    expect(store.containerNavigation.enterSelectedContainer()).toBe(true)
    expect(store.state.enteredContainerId).toBe(parent.id)
    expect([...store.state.selectedIds]).toEqual([topLeft.id])

    expect(store.containerNavigation.navigateInDirection('right')).toBe(true)
    expect([...store.state.selectedIds]).toEqual([topRight.id])
    expect(store.containerNavigation.navigateInDirection('down')).toBe(true)
    expect([...store.state.selectedIds]).toEqual([bottomRight.id])
    expect(store.containerNavigation.navigateInDirection('up')).toBe(true)
    expect([...store.state.selectedIds]).toEqual([topRight.id])

    expect(store.containerNavigation.enterSelectedContainer()).toBe(true)
    expect(store.state.enteredContainerId).toBe(topRight.id)
    expect([...store.state.selectedIds]).toEqual([nested.id])
    expect(store.containerNavigation.getState()).toMatchObject({
      activeContainerId: topRight.id,
      depth: 2
    })

    expect(store.containerNavigation.exit()).toBe(true)
    expect(store.state.enteredContainerId).toBe(parent.id)
    expect([...store.state.selectedIds]).toEqual([topRight.id])
    expect(store.containerNavigation.exit()).toBe(true)
    expect(store.state.enteredContainerId).toBeNull()
    expect([...store.state.selectedIds]).toEqual([parent.id])
  })

  test('does not intercept Enter for Code Objects', () => {
    const store = createEditorStore()
    const codeObject = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Interactive app' }),
      height: 300,
      name: 'Interactive app',
      width: 400,
      x: 200,
      y: 200
    })
    store.select([codeObject.id])

    expect(store.containerNavigation.enterSelectedContainer()).toBe(false)
    expect(store.containerNavigation.getState()).toBeNull()
    expect(store.state.enteredContainerId).toBeNull()
  })
})
