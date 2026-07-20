import type {
  SceneGraph,
  Variable,
  VariableCollection,
  VariableValue
} from '@open-pencil/scene-graph'

import type { TokenReview, TokenReviewCount, TokenSnapshot } from './types'

function emptyCount(): TokenReviewCount {
  return { added: 0, updated: 0, unchanged: 0, removed: 0 }
}

function collectionKey(collection: VariableCollection): string {
  return collection.name.trim().toLowerCase()
}

function variableKey(variable: Variable, collectionName: string): string {
  return `${collectionName.trim().toLowerCase()}/${variable.name.trim().toLowerCase()}`
}

function modeValueByName(
  variable: Variable,
  collection: VariableCollection
): Record<string, VariableValue> {
  return Object.fromEntries(
    collection.modes.map((mode) => [mode.name, variable.valuesByMode[mode.modeId]])
  )
}

function sameCollection(left: VariableCollection, right: VariableCollection): boolean {
  return (
    left.name === right.name &&
    JSON.stringify(left.modes.map((mode) => mode.name)) ===
      JSON.stringify(right.modes.map((mode) => mode.name)) &&
    left.modes.find((mode) => mode.modeId === left.defaultModeId)?.name ===
      right.modes.find((mode) => mode.modeId === right.defaultModeId)?.name
  )
}

function sameVariable(
  left: Variable,
  leftCollection: VariableCollection,
  right: Variable,
  rightCollection: VariableCollection
): boolean {
  return (
    left.type === right.type &&
    left.description === right.description &&
    left.hiddenFromPublishing === right.hiddenFromPublishing &&
    JSON.stringify(modeValueByName(left, leftCollection)) ===
      JSON.stringify(modeValueByName(right, rightCollection))
  )
}

export function reviewTokenSnapshot(graph: SceneGraph, snapshot: TokenSnapshot): TokenReview {
  const collections = emptyCount()
  const variables = emptyCount()
  const currentCollections = new Map(
    [...graph.variableCollections.values()].map((collection) => [
      collectionKey(collection),
      collection
    ])
  )
  const incomingCollections = new Map(
    snapshot.collections.map((collection) => [collectionKey(collection), collection])
  )

  for (const [key, incoming] of incomingCollections) {
    const current = currentCollections.get(key)
    if (!current) collections.added++
    else if (sameCollection(current, incoming)) collections.unchanged++
    else collections.updated++
  }
  for (const key of currentCollections.keys()) {
    if (!incomingCollections.has(key)) collections.removed++
  }

  const currentVariables = new Map<string, { variable: Variable; collection: VariableCollection }>()
  for (const variable of graph.variables.values()) {
    const collection = graph.variableCollections.get(variable.collectionId)
    if (collection)
      currentVariables.set(variableKey(variable, collection.name), { variable, collection })
  }
  const incomingVariables = new Map<
    string,
    { variable: Variable; collection: VariableCollection }
  >()
  const incomingCollectionById = new Map(
    snapshot.collections.map((collection) => [collection.id, collection])
  )
  for (const variable of snapshot.variables) {
    const collection = incomingCollectionById.get(variable.collectionId)
    if (collection)
      incomingVariables.set(variableKey(variable, collection.name), { variable, collection })
  }
  for (const [key, incoming] of incomingVariables) {
    const current = currentVariables.get(key)
    if (!current) variables.added++
    else if (
      sameVariable(current.variable, current.collection, incoming.variable, incoming.collection)
    ) {
      variables.unchanged++
    } else variables.updated++
  }
  for (const key of currentVariables.keys()) {
    if (!incomingVariables.has(key)) variables.removed++
  }
  return { collections, variables }
}

function uniqueId(preferred: string, used: Set<string>, prefix: string): string {
  let candidate = preferred
  let suffix = 2
  while (used.has(candidate)) candidate = `${prefix}:${preferred}:${suffix++}`
  used.add(candidate)
  return candidate
}

function modeKey(collectionId: string, modeId: string): string {
  return collectionId + ':' + modeId
}

function applyVariableValues(
  variables: Variable[],
  nextVariables: Map<string, Variable>,
  variableIdMap: Map<string, string>,
  modeIdMap: Map<string, string>
) {
  for (const incoming of variables) {
    const targetId = variableIdMap.get(incoming.id)
    const target = targetId ? nextVariables.get(targetId) : undefined
    if (!target) continue
    for (const [modeId, value] of Object.entries(incoming.valuesByMode)) {
      const localModeId = modeIdMap.get(modeKey(incoming.collectionId, modeId))
      if (!localModeId) continue
      const cloned = structuredClone(value)
      target.valuesByMode[localModeId] =
        typeof cloned === 'object' && 'aliasId' in cloned
          ? { aliasId: variableIdMap.get(cloned.aliasId) ?? cloned.aliasId }
          : cloned
    }
  }
}

function activeModesForSnapshot(
  snapshot: TokenSnapshot,
  collectionIdMap: Map<string, string>,
  modeIdMap: Map<string, string>,
  collections: Map<string, VariableCollection>
): Map<string, string> {
  return new Map(
    snapshot.collections.map((collection) => {
      const collectionId = collectionIdMap.get(collection.id) ?? collection.id
      const incomingActive = snapshot.activeMode.find(([id]) => id === collection.id)?.[1]
      const modeId =
        modeIdMap.get(modeKey(collection.id, incomingActive ?? collection.defaultModeId)) ??
        collections.get(collectionId)?.defaultModeId ??
        ''
      return [collectionId, modeId]
    })
  )
}

function pruneVariableBindings(graph: SceneGraph, variables: Map<string, Variable>) {
  for (const node of graph.nodes.values()) {
    const boundVariables = Object.fromEntries(
      Object.entries(node.boundVariables).filter(([, variableId]) => variables.has(variableId))
    )
    if (Object.keys(boundVariables).length !== Object.keys(node.boundVariables).length) {
      graph.updateNode(node.id, { boundVariables })
    }
  }
}

export function applyTokenSnapshot(graph: SceneGraph, snapshot: TokenSnapshot): void {
  const currentCollections = new Map(
    [...graph.variableCollections.values()].map((collection) => [
      collectionKey(collection),
      collection
    ])
  )
  const currentVariables = new Map<string, Variable>()
  for (const variable of graph.variables.values()) {
    const collection = graph.variableCollections.get(variable.collectionId)
    if (collection) currentVariables.set(variableKey(variable, collection.name), variable)
  }

  const usedCollectionIds = new Set<string>()
  const usedVariableIds = new Set<string>()
  const collectionIdMap = new Map<string, string>()
  const modeIdMap = new Map<string, string>()
  const variableIdMap = new Map<string, string>()
  const nextCollections = new Map<string, VariableCollection>()
  const nextVariables = new Map<string, Variable>()

  for (const incoming of snapshot.collections) {
    const current = currentCollections.get(collectionKey(incoming))
    const id = uniqueId(current?.id ?? incoming.id, usedCollectionIds, 'collection')
    collectionIdMap.set(incoming.id, id)
    const currentModes = new Map(current?.modes.map((mode) => [mode.name, mode]))
    const usedModeIds = new Set<string>()
    const modes = incoming.modes.map((mode) => {
      const modeId = uniqueId(
        currentModes.get(mode.name)?.modeId ?? mode.modeId,
        usedModeIds,
        'mode'
      )
      modeIdMap.set(modeKey(incoming.id, mode.modeId), modeId)
      return { modeId, name: mode.name }
    })
    const defaultModeId = modeIdMap.get(modeKey(incoming.id, incoming.defaultModeId)) ?? ''
    nextCollections.set(id, { id, name: incoming.name, modes, defaultModeId, variableIds: [] })
  }

  const incomingCollectionById = new Map(
    snapshot.collections.map((collection) => [collection.id, collection])
  )
  for (const incoming of snapshot.variables) {
    const incomingCollection = incomingCollectionById.get(incoming.collectionId)
    const collectionId = collectionIdMap.get(incoming.collectionId)
    if (!incomingCollection || !collectionId) continue
    const current = currentVariables.get(variableKey(incoming, incomingCollection.name))
    const id = uniqueId(current?.id ?? incoming.id, usedVariableIds, 'variable')
    variableIdMap.set(incoming.id, id)
    nextCollections.get(collectionId)?.variableIds.push(id)
    nextVariables.set(id, {
      ...structuredClone(incoming),
      id,
      collectionId,
      valuesByMode: {}
    })
  }

  applyVariableValues(snapshot.variables, nextVariables, variableIdMap, modeIdMap)

  graph.variableCollections = nextCollections
  graph.variables = nextVariables
  graph.activeMode = activeModesForSnapshot(snapshot, collectionIdMap, modeIdMap, nextCollections)
  pruneVariableBindings(graph, nextVariables)
}
