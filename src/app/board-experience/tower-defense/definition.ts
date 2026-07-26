import type { BoardComponentClient, BoardComponentSnapshot } from '@/app/board-authority'

import type {
  BoardExperienceDefinition,
  BoardExperiencePoint,
  BoardExperienceRuntime,
  BoardExperienceRuntimeContext,
  BoardExperienceSnapshot
} from '../contracts'
import {
  TOWER_DEFENSE_CONTROLS_SOURCE,
  TOWER_DEFENSE_ENEMY_SOURCE,
  TOWER_DEFENSE_LANE_SOURCE,
  TOWER_DEFENSE_TOWER_SOURCE
} from './sources'

type TowerKind = 'pulse' | 'range'

type ControlsState = {
  enemyCount: number
  exitRequests: number
  gold: number
  lives: number
  pulseRequests: number
  rangeRequests: number
  resetRequests: number
  running: boolean
  score: number
}

type Enemy = {
  componentId: string
  health: number
  progress: number
  speed: number
}

const LANE_DEFINITION_ID = 'openpencil.tower-defense.lane'
const CONTROLS_DEFINITION_ID = 'openpencil.tower-defense.controls'
const TOWER_DEFINITION_ID = 'openpencil.tower-defense.tower'
const ENEMY_DEFINITION_ID = 'openpencil.tower-defense.enemy'
const STARTING_GOLD = 140
const STARTING_LIVES = 12
const MAX_ENEMIES = 18
const SPAWN_INTERVAL_MS = 650
const TOWER_COST: Record<TowerKind, number> = {
  pulse: 45,
  range: 70
}
const TOWER_RANGE: Record<TowerKind, number> = {
  pulse: 175,
  range: 240
}
const TOWER_DAMAGE: Record<TowerKind, number> = {
  pulse: 2,
  range: 3
}
const TOWER_COOLDOWN: Record<TowerKind, number> = {
  pulse: 420,
  range: 680
}

function numericSetting(settings: Record<string, unknown>, key: 'originX' | 'originY'): number {
  const value = settings[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function recordNumber(record: Record<string, unknown>, key: string, fallback = 0): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function recordBoolean(record: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = record[key]
  return typeof value === 'boolean' ? value : fallback
}

function pathPoints(origin: BoardExperiencePoint): BoardExperiencePoint[] {
  return [
    { x: origin.x - 520, y: origin.y - 145 },
    { x: origin.x - 245, y: origin.y - 145 },
    { x: origin.x - 245, y: origin.y + 110 },
    { x: origin.x + 90, y: origin.y + 110 },
    { x: origin.x + 90, y: origin.y - 95 },
    { x: origin.x + 500, y: origin.y - 95 }
  ]
}

function segmentLength(start: BoardExperiencePoint, end: BoardExperiencePoint): number {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

function pointOnPath(points: BoardExperiencePoint[], progress: number): BoardExperiencePoint {
  const lengths = points.slice(1).map((point, index) => segmentLength(points[index], point))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let remaining = Math.min(1, Math.max(0, progress)) * total
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0
    const start = points[index]
    const end = points[index + 1]
    if (!start || !end) continue
    if (remaining <= length) {
      const ratio = length <= 0 ? 0 : remaining / length
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio
      }
    }
    remaining -= length
  }
  return points.at(-1) ?? { x: 0, y: 0 }
}

function distance(left: BoardExperiencePoint, right: BoardExperiencePoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

function componentByDefinition(
  board: BoardComponentClient,
  definitionId: string
): BoardComponentSnapshot | null {
  return board.components.find((component) => component.definitionId === definitionId) ?? null
}

function componentsByDefinition(
  board: BoardComponentClient,
  definitionId: string
): BoardComponentSnapshot[] {
  return board.components.filter((component) => component.definitionId === definitionId)
}

function controlsState(component: BoardComponentSnapshot | null): ControlsState {
  const state = component?.state ?? {}
  return {
    enemyCount: recordNumber(state, 'enemyCount'),
    exitRequests: recordNumber(state, 'exitRequests'),
    gold: recordNumber(state, 'gold', STARTING_GOLD),
    lives: recordNumber(state, 'lives', STARTING_LIVES),
    pulseRequests: recordNumber(state, 'pulseRequests'),
    rangeRequests: recordNumber(state, 'rangeRequests'),
    resetRequests: recordNumber(state, 'resetRequests'),
    running: recordBoolean(state, 'running'),
    score: recordNumber(state, 'score')
  }
}

function towerKind(component: BoardComponentSnapshot): TowerKind {
  return component.state.kind === 'range' ? 'range' : 'pulse'
}

function towerCenter(component: BoardComponentSnapshot): BoardExperiencePoint {
  return {
    x: component.x + component.width / 2,
    y: component.y + component.height / 2
  }
}

function createTowerDefenseRuntime(context: BoardExperienceRuntimeContext): BoardExperienceRuntime {
  const points = pathPoints(context.origin)
  const pathLength = points
    .slice(1)
    .reduce((total, point, index) => total + segmentLength(points[index], point), 0)
  const towerCooldowns = new Map<string, number>()
  const towerSignals = new Map<string, number>()
  let controlsId: string | null = null
  let enemies: Enemy[] = []
  let spawnElapsedMs = 0
  let gold = STARTING_GOLD
  let lives = STARTING_LIVES
  let score = 0
  let observedPulseRequests = 0
  let observedRangeRequests = 0
  let observedResetRequests = 0
  let observedExitRequests = 0

  function board() {
    return context.board()
  }

  function createBaseComponent(
    definitionId: string,
    input: Omit<Parameters<BoardComponentClient['createComponent']>[0], 'definitionId'>
  ): BoardComponentSnapshot | null {
    const current = componentByDefinition(board(), definitionId)
    if (current) return current
    return (
      board().createComponent({
        ...input,
        definitionId,
        lifecycle: 'durable'
      }).component ?? null
    )
  }

  function initializeComponents() {
    const currentBoard = board()
    for (const component of currentBoard.components) {
      if (component.lifecycle === 'transient') {
        currentBoard.deleteComponent(component.id, { history: 'transient' })
      }
    }
    createBaseComponent(LANE_DEFINITION_ID, {
      cornerRadius: 28,
      height: 500,
      name: 'Defense lane',
      props: { title: 'Defense lane' },
      source: TOWER_DEFENSE_LANE_SOURCE,
      state: {},
      width: 1120,
      x: context.origin.x - 560,
      y: context.origin.y - 250
    })
    const controls = createBaseComponent(CONTROLS_DEFINITION_ID, {
      cornerRadius: 18,
      height: 132,
      name: 'Tower defense controls',
      props: {},
      source: TOWER_DEFENSE_CONTROLS_SOURCE,
      state: {
        enemyCount: 0,
        exitRequests: 0,
        gold: STARTING_GOLD,
        lives: STARTING_LIVES,
        pulseRequests: 0,
        rangeRequests: 0,
        resetRequests: 0,
        running: false,
        score: 0
      },
      width: 840,
      x: context.origin.x - 420,
      y: context.origin.y - 420
    })
    controlsId = controls?.id ?? null
    const initial = controlsState(controls)
    gold = initial.gold
    lives = initial.lives
    score = initial.score
    observedPulseRequests = initial.pulseRequests
    observedRangeRequests = initial.rangeRequests
    observedResetRequests = initial.resetRequests
    observedExitRequests = initial.exitRequests
    if (componentsByDefinition(board(), TOWER_DEFINITION_ID).length === 0) {
      createTower('pulse', false)
      createTower('range', false)
    }
  }

  function updateControls(
    patch: Partial<ControlsState>,
    history: 'transient' | 'undoable' = 'transient'
  ) {
    if (!controlsId) return
    const controls = board().components.find((component) => component.id === controlsId)
    if (!controls) return
    const current = controlsState(controls)
    board().updateComponent(
      controls.id,
      {
        state: {
          ...current,
          ...patch
        }
      },
      { history }
    )
  }

  function createTower(kind: TowerKind, charge = true) {
    if (charge && gold < TOWER_COST[kind]) return
    const currentBoard = board()
    const towerCount = componentsByDefinition(currentBoard, TOWER_DEFINITION_ID).length
    const column = towerCount % 5
    const row = Math.floor(towerCount / 5)
    const receipt = currentBoard.createComponent({
      cornerRadius: kind === 'range' ? 45 : 18,
      definitionId: TOWER_DEFINITION_ID,
      height: 84,
      lifecycle: 'durable',
      name: kind === 'range' ? 'Range tower' : 'Pulse tower',
      props: {},
      source: TOWER_DEFENSE_TOWER_SOURCE,
      state: { firing: false, kind },
      width: 84,
      x: context.origin.x - 180 + column * 116,
      y: context.origin.y + 190 + row * 116
    })
    if (receipt.status !== 'applied' || !charge) return
    gold -= TOWER_COST[kind]
    updateControls({ gold })
  }

  function deleteEnemy(componentId: string) {
    board().deleteComponent(componentId, { history: 'transient' })
    enemies = enemies.filter((enemy) => enemy.componentId !== componentId)
  }

  function clearEnemies() {
    for (const enemy of enemies.slice()) deleteEnemy(enemy.componentId)
    enemies = []
  }

  function resetGame() {
    clearEnemies()
    towerCooldowns.clear()
    towerSignals.clear()
    spawnElapsedMs = 0
    gold = STARTING_GOLD
    lives = STARTING_LIVES
    score = 0
    updateControls({
      enemyCount: 0,
      gold,
      lives,
      running: false,
      score
    })
    context.invalidate()
  }

  function spawnEnemy() {
    if (enemies.length >= MAX_ENEMIES) return
    const start = points[0] ?? context.origin
    const receipt = board().createComponent(
      {
        cornerRadius: 18,
        definitionId: ENEMY_DEFINITION_ID,
        height: 36,
        lifecycle: 'transient',
        name: 'Enemy',
        props: {},
        source: TOWER_DEFENSE_ENEMY_SOURCE,
        state: { health: 8, maxHealth: 8 },
        width: 36,
        x: start.x - 18,
        y: start.y - 18
      },
      { history: 'transient' }
    )
    if (!receipt.component) return
    enemies.push({
      componentId: receipt.component.id,
      health: 8,
      progress: 0,
      speed: 62 + Math.min(score, 90) * 0.12
    })
  }

  function syncControlRequests(): boolean {
    const controls = controlsId
      ? board().components.find((component) => component.id === controlsId)
      : null
    const state = controlsState(controls ?? null)
    gold = state.gold
    lives = state.lives
    score = state.score
    if (state.exitRequests > observedExitRequests) {
      observedExitRequests = state.exitRequests
      context.deactivate()
      return false
    }
    if (state.resetRequests > observedResetRequests) {
      observedResetRequests = state.resetRequests
      resetGame()
      return false
    }
    const pulseRequests = Math.min(3, state.pulseRequests - observedPulseRequests)
    const rangeRequests = Math.min(3, state.rangeRequests - observedRangeRequests)
    observedPulseRequests = state.pulseRequests
    observedRangeRequests = state.rangeRequests
    for (let index = 0; index < pulseRequests; index += 1) createTower('pulse')
    for (let index = 0; index < rangeRequests; index += 1) createTower('range')
    return state.running
  }

  function updateEnemyComponents(elapsedMs: number) {
    const components = new Map(board().components.map((component) => [component.id, component]))
    for (const enemy of enemies.slice()) {
      const component = components.get(enemy.componentId)
      if (!component) {
        enemies = enemies.filter((candidate) => candidate.componentId !== enemy.componentId)
        continue
      }
      enemy.health = recordNumber(component.state, 'health', enemy.health)
      if (enemy.health <= 0) {
        deleteEnemy(enemy.componentId)
        gold += 12
        score += 1
        continue
      }
      if (!component.selected) {
        enemy.progress += (enemy.speed * elapsedMs) / 1000 / Math.max(pathLength, 1)
        const point = pointOnPath(points, enemy.progress)
        board().updateComponent(
          component.id,
          {
            state: { health: enemy.health, maxHealth: 8 },
            x: point.x - component.width / 2,
            y: point.y - component.height / 2
          },
          { history: 'transient' }
        )
      }
      if (enemy.progress >= 1) {
        deleteEnemy(enemy.componentId)
        lives = Math.max(0, lives - 1)
      }
    }
  }

  function updateTowerComponents(elapsedMs: number) {
    const currentBoard = board()
    const towers = componentsByDefinition(currentBoard, TOWER_DEFINITION_ID)
    for (const tower of towers) {
      const signal = Math.max(0, (towerSignals.get(tower.id) ?? 0) - elapsedMs)
      towerSignals.set(tower.id, signal)
      if (recordBoolean(tower.state, 'firing') !== signal > 0) {
        currentBoard.updateComponent(
          tower.id,
          { state: { ...tower.state, firing: signal > 0 } },
          { history: 'transient' }
        )
      }
      const cooldown = Math.max(0, (towerCooldowns.get(tower.id) ?? 0) - elapsedMs)
      towerCooldowns.set(tower.id, cooldown)
      if (cooldown > 0) continue
      const center = towerCenter(tower)
      const target = enemies
        .map((enemy) => ({
          enemy,
          point: pointOnPath(points, enemy.progress)
        }))
        .filter(({ point }) => distance(center, point) <= TOWER_RANGE[towerKind(tower)])
        .toSorted((left, right) => right.enemy.progress - left.enemy.progress)[0]
      if (!target) continue
      const kind = towerKind(tower)
      target.enemy.health -= TOWER_DAMAGE[kind]
      towerCooldowns.set(tower.id, TOWER_COOLDOWN[kind])
      towerSignals.set(tower.id, 130)
      currentBoard.updateComponent(
        target.enemy.componentId,
        { state: { health: target.enemy.health, maxHealth: 8 } },
        { history: 'transient' }
      )
      currentBoard.updateComponent(
        tower.id,
        { state: { ...tower.state, firing: true } },
        { history: 'transient' }
      )
    }
  }

  function tick(elapsedMs: number) {
    const delta = Math.min(60, Math.max(0, elapsedMs))
    const running = syncControlRequests()
    if (!running || delta === 0) return
    spawnElapsedMs += delta
    while (spawnElapsedMs >= SPAWN_INTERVAL_MS) {
      spawnElapsedMs -= SPAWN_INTERVAL_MS
      spawnEnemy()
    }
    updateEnemyComponents(delta)
    updateTowerComponents(delta)
    if (lives === 0) updateControls({ running: false })
    updateControls({
      enemyCount: enemies.length,
      gold,
      lives,
      score
    })
    context.invalidate()
  }

  function getSnapshot(): BoardExperienceSnapshot {
    const currentBoard = board()
    const controls = controlsId
      ? currentBoard.components.find((component) => component.id === controlsId)
      : null
    return {
      bounds: {
        height: 760,
        width: 1180,
        x: context.origin.x - 590,
        y: context.origin.y - 450
      },
      componentIds: currentBoard.components.map((component) => component.id),
      definitionId: 'tower-defense',
      description: 'Every visible game piece is an ordinary selectable Code Object.',
      running: controlsState(controls ?? null).running,
      title: 'Tower defense'
    }
  }

  initializeComponents()

  return {
    dispose: () => {
      updateControls({ running: false })
      clearEnemies()
    },
    getSnapshot,
    tick
  }
}

export const TOWER_DEFENSE_EXPERIENCE: BoardExperienceDefinition = {
  createRuntime: createTowerDefenseRuntime,
  createSettings: (center) => ({
    originX: center.x,
    originY: center.y
  }),
  description: 'A board-level composition of selectable Code Object instances.',
  id: 'tower-defense',
  label: 'Tower defense',
  resolveOrigin: towerDefenseOrigin
}

export function towerDefenseOrigin(settings: Record<string, unknown>): BoardExperiencePoint {
  return {
    x: numericSetting(settings, 'originX'),
    y: numericSetting(settings, 'originY')
  }
}
