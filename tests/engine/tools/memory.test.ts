import { describe, expect, test } from 'bun:test'

import {
  canonicalMemoryDerivedFromId,
  canonicalMemoryObjectId,
  canonicalMemorySourceNodeId,
  forkCanonicalObject,
  materializeCanonicalObject,
  searchBoardMemory
} from '@open-pencil/core/tools'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type MemoryToolResult = {
  boards: Array<{ board_id: string; relevance: number; title: string }>
  index: { board_count: number; canonical_object_count: number; placement_count: number }
  objects: Array<{
    canonical_object_id: string
    placements: Array<{ board_id: string; node_id: string }>
    title: string
  }>
}

function canonicalPluginData(id: string) {
  return [{ key: 'canonical-object-id', pluginId: 'openpencil.memory', value: id }]
}

describe('search_board_memory', () => {
  test('ranks Board capsules and groups reused placements by canonical object identity', () => {
    const { figma, graph } = setupToolTest()
    const research = graph.getPages()[0]
    research.name = 'Research Board'
    const researchCard = graph.createNode('FRAME', research.id, {
      height: 240,
      name: 'Pricing comparison',
      pluginData: canonicalPluginData('object:pricing-comparison'),
      width: 360,
      x: 80,
      y: 120
    })
    graph.createNode('TEXT', researchCard.id, {
      name: 'Pricing evidence',
      text: 'Compare pricing tiers and annual cost.',
      x: 24,
      y: 32
    })

    const decision = graph.addPage('Decision Board')
    const decisionCard = graph.createNode('FRAME', decision.id, {
      height: 180,
      name: 'Pricing comparison',
      pluginData: canonicalPluginData('object:pricing-comparison'),
      width: 320,
      x: 40,
      y: 60
    })
    graph.createNode('TEXT', decisionCard.id, {
      name: 'Recommendation',
      text: 'Pricing comparison recommends the annual plan.',
      x: 20,
      y: 24
    })

    const result = getTool('search_board_memory').execute(figma, {
      limit: 10,
      query: 'pricing comparison'
    }) as MemoryToolResult

    expect(result.index).toEqual({
      board_count: 2,
      canonical_object_count: 3,
      placement_count: 4
    })
    expect(new Set(result.boards.map((board) => board.board_id))).toEqual(
      new Set([research.id, decision.id])
    )
    expect(result.objects[0]).toMatchObject({
      canonical_object_id: 'object:pricing-comparison',
      title: 'Pricing comparison'
    })
    expect(
      new Set(result.objects[0].placements.map(({ board_id, node_id }) => `${board_id}/${node_id}`))
    ).toEqual(new Set([`${research.id}/${researchCard.id}`, `${decision.id}/${decisionCard.id}`]))
  })

  test('returns the exact Board for a remembered Board title', () => {
    const { figma, graph } = setupToolTest()
    const first = graph.getPages()[0]
    first.name = 'Scratch'
    const second = graph.addPage('Dental Treatment Planning')
    graph.createNode('TEXT', second.id, {
      name: 'Treatment note',
      text: 'Treatment planning evidence'
    })

    const result = getTool('search_board_memory').execute(figma, {
      query: 'Dental Treatment Planning'
    }) as MemoryToolResult

    expect(result.boards[0]).toMatchObject({ board_id: second.id, title: second.name })
    expect(result.boards[0].relevance).toBe(1)
  })
})

describe('canonical object identity', () => {
  test('materializes an exact subtree and forks it with explicit lineage', () => {
    const { graph } = setupToolTest()
    const sourceBoard = graph.getPages()[0]
    const source = graph.createNode('FRAME', sourceBoard.id, {
      height: 240,
      name: 'Pricing comparison',
      pluginData: [{ key: 'request:source', pluginId: 'openpencil.agent-tools', value: 'receipt' }],
      width: 360
    })
    const sourceText = graph.createNode('TEXT', source.id, {
      name: 'Price',
      text: '$20 per month'
    })
    const targetBoard = graph.addPage('Decision Board')
    const placed = materializeCanonicalObject(graph, targetBoard.id, {
      sourceObjectId: source.id,
      x: 500,
      y: 300
    })

    const placement = graph.getNode(placed.placement_id)
    const placementText = placement ? graph.getNode(placement.childIds[0] ?? '') : undefined
    expect(placement).toMatchObject({
      height: source.height,
      name: source.name,
      width: source.width,
      x: 500,
      y: 300
    })
    expect(placementText).toMatchObject({ name: sourceText.name, text: sourceText.text })
    expect(placement ? canonicalMemoryObjectId(placement) : null).toBe(source.id)
    expect(placement ? canonicalMemorySourceNodeId(placement) : null).toBe(source.id)
    expect(
      placement?.pluginData.some(({ pluginId }) => pluginId === 'openpencil.agent-tools')
    ).toBe(false)
    expect(placementText ? canonicalMemoryObjectId(placementText) : null).toBe(sourceText.id)

    const forked = forkCanonicalObject(graph, targetBoard.id, placed.placement_id)
    const variant = graph.getNode(forked.placement_id)
    expect(forked).toMatchObject({
      canonical_object_id: placed.placement_id,
      derived_from_canonical_object_id: source.id,
      placement_id: placed.placement_id
    })
    expect(variant ? canonicalMemorySourceNodeId(variant) : null).toBeUndefined()
    expect(variant ? canonicalMemoryDerivedFromId(variant) : null).toBe(source.id)
    expect(
      searchBoardMemory(graph, 'Pricing comparison').objects.find(
        ({ canonical_object_id }) => canonical_object_id === forked.canonical_object_id
      )
    ).toMatchObject({
      derived_from_canonical_object_id: source.id,
      is_variant: true
    })
  })

  test('refuses to fork a canonical source in place', () => {
    const { graph } = setupToolTest()
    const board = graph.getPages()[0]
    const source = graph.createNode('FRAME', board.id, { name: 'Source' })

    expect(() => forkCanonicalObject(graph, board.id, source.id)).toThrow(
      'already an independent object'
    )
  })
})
