import { describe, expect, test } from 'bun:test'

import {
  activateBoardExperience,
  boardExperienceDocument,
  boardExperienceSnapshot,
  deactivateBoardExperience,
  disposeBoardExperience,
  tickBoardExperience
} from '@/app/board-experience'
import { codeObjectDocument, updateCodeObjectState } from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'

const EXPERIENCE_PLUGIN_ID = 'openpencil-board-experience'

function experienceComponents(store: ReturnType<typeof createEditorStore>) {
  return store.graph
    .getChildren(store.state.currentPageId)
    .filter((node) =>
      node.pluginData.some(
        (entry) =>
          entry.pluginId === EXPERIENCE_PLUGIN_ID &&
          entry.key === 'owner' &&
          entry.value.includes('tower-defense')
      )
    )
}

function componentWithDefinition(
  store: ReturnType<typeof createEditorStore>,
  definitionId: string
) {
  return (
    experienceComponents(store).find(
      (node) => codeObjectDocument(node)?.definitionId === definitionId
    ) ?? null
  )
}

describe('Board Experiences', () => {
  test('coordinates selectable Code Object instances without a visual overlay layer', () => {
    const store = createEditorStore()
    const page = store.graph.getNode(store.state.currentPageId)
    expect(boardExperienceDocument(page ?? null)).toBeNull()

    const session = activateBoardExperience(store, 'tower-defense')
    if (!session) throw new Error('Tower defense did not activate')
    expect(boardExperienceDocument(store.graph.getNode(store.state.currentPageId) ?? null)).toEqual(
      {
        definitionId: 'tower-defense',
        schemaVersion: 1,
        settings: expect.objectContaining({
          originX: expect.any(Number),
          originY: expect.any(Number)
        })
      }
    )

    const initial = boardExperienceSnapshot(store)
    expect(initial).toMatchObject({
      definitionId: 'tower-defense',
      running: false,
      title: 'Tower defense'
    })
    expect(initial?.componentIds).toHaveLength(4)

    const lane = componentWithDefinition(store, 'openpencil.tower-defense.lane')
    const controls = componentWithDefinition(store, 'openpencil.tower-defense.controls')
    const initialTowers = experienceComponents(store).filter(
      (node) => codeObjectDocument(node)?.definitionId === 'openpencil.tower-defense.tower'
    )
    expect(lane).toMatchObject({ name: 'Defense lane', type: 'FRAME' })
    expect(controls).toMatchObject({ name: 'Tower defense controls', type: 'FRAME' })
    expect(initialTowers).toHaveLength(2)
    expect(experienceComponents(store).every((node) => codeObjectDocument(node))).toBe(true)

    if (!lane || !controls) throw new Error('Tower defense components were not created')
    store.select([lane.id])
    expect(store.state.selectedIds.has(lane.id)).toBe(true)
    const laneX = lane.x
    store.updateNodeWithUndo(lane.id, { x: laneX + 48 }, 'Move defense lane')
    store.undo.undo()
    expect(store.graph.getNode(lane.id)?.x).toBe(laneX)
    store.undo.redo()
    expect(store.graph.getNode(lane.id)?.x).toBe(laneX + 48)

    const controlsDocument = codeObjectDocument(controls)
    if (!controlsDocument) throw new Error('Tower defense controls were unavailable')
    updateCodeObjectState(store, controls.id, {
      ...controlsDocument.state,
      pulseRequests: 1
    })
    tickBoardExperience(store, 16)
    const towersAfterCreate = experienceComponents(store).filter(
      (node) => codeObjectDocument(node)?.definitionId === 'openpencil.tower-defense.tower'
    )
    expect(towersAfterCreate).toHaveLength(3)
    const createdTower = towersAfterCreate.find(
      (tower) => !initialTowers.some((initialTower) => initialTower.id === tower.id)
    )
    if (!createdTower) throw new Error('The controls did not create a tower component')
    store.undo.undo()
    expect(store.graph.getNode(createdTower.id)).toBeUndefined()
    store.undo.redo()
    expect(store.graph.getNode(createdTower.id)).toBeDefined()

    const currentControls = codeObjectDocument(store.graph.getNode(controls.id))
    if (!currentControls) throw new Error('Tower defense controls were unavailable after creation')
    updateCodeObjectState(store, controls.id, {
      ...currentControls.state,
      running: true
    })
    for (let index = 0; index < 12; index += 1) tickBoardExperience(store, 60)
    const enemy = componentWithDefinition(store, 'openpencil.tower-defense.enemy')
    expect(enemy).toMatchObject({ name: 'Enemy', type: 'FRAME' })
    expect(codeObjectDocument(enemy)?.definitionId).toBe('openpencil.tower-defense.enemy')
    if (!enemy) throw new Error('The wave did not create an enemy component')

    store.select([enemy.id])
    const selectedPosition = { x: enemy.x, y: enemy.y }
    tickBoardExperience(store, 60)
    expect(store.graph.getNode(enemy.id)).toMatchObject(selectedPosition)
    store.select([])
    tickBoardExperience(store, 60)
    expect(store.graph.getNode(enemy.id)?.x).not.toBe(selectedPosition.x)

    expect(deactivateBoardExperience(store)).toBe(true)
    expect(
      boardExperienceDocument(store.graph.getNode(store.state.currentPageId) ?? null)
    ).toBeNull()
    expect(store.graph.getNode(lane.id)).toBeDefined()
    expect(store.graph.getNode(controls.id)).toBeDefined()
    expect(store.graph.getNode(enemy.id)).toBeUndefined()
    disposeBoardExperience(store)

    const orphan = store.graph.createNode('FRAME', store.state.currentPageId, {
      height: enemy.height,
      name: 'Orphaned enemy',
      pluginData: structuredClone(enemy.pluginData),
      width: enemy.width,
      x: enemy.x,
      y: enemy.y
    })
    expect(componentWithDefinition(store, 'openpencil.tower-defense.enemy')?.id).toBe(orphan.id)
    expect(boardExperienceSnapshot(store)).toBeNull()
    expect(store.graph.getNode(orphan.id)).toBeUndefined()
    expect(store.graph.getNode(lane.id)).toBeDefined()
  })
})
