import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { SceneGraph, VariableValue } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import { stringToGuid } from '#core/kiwi/fig/node-change/convert'
import { fractionalPosition, safeColor } from '#core/kiwi/fig/node-change/serialize'

type KiwiNodeChange = NodeChange & Record<string, unknown>

export interface FigVariableExportPlan {
  varIdToGuid: Map<string, GUID>
  modeIdToGuid: Map<string, GUID>
  appendNodeChanges(nodeChanges: KiwiNodeChange[], internalCanvasGuid: GUID): void
}

function variableValueToKiwi(
  value: VariableValue,
  type: string,
  varIdToGuid: Map<string, GUID>
): { value: Record<string, unknown>; dataType: string; resolvedDataType: string } {
  if (value && typeof value === 'object' && 'aliasId' in value) {
    const aliasGuid = varIdToGuid.get(value.aliasId) ?? stringToGuid(value.aliasId)
    return {
      value: { alias: { guid: aliasGuid } },
      dataType: 'ALIAS',
      resolvedDataType: { COLOR: 'COLOR', BOOLEAN: 'BOOLEAN', STRING: 'STRING' }[type] ?? 'FLOAT'
    }
  }
  if (type === 'COLOR' && typeof value === 'object' && 'r' in value) {
    return {
      value: { colorValue: safeColor(value) },
      dataType: 'COLOR',
      resolvedDataType: 'COLOR'
    }
  }
  if (type === 'BOOLEAN') {
    return { value: { boolValue: !!value }, dataType: 'BOOLEAN', resolvedDataType: 'BOOLEAN' }
  }
  if (type === 'STRING') {
    return {
      value: { textValue: typeof value === 'string' ? value : JSON.stringify(value) },
      dataType: 'STRING',
      resolvedDataType: 'STRING'
    }
  }
  return { value: { floatValue: Number(value) }, dataType: 'FLOAT', resolvedDataType: 'FLOAT' }
}

function appendVariablesForCollection(
  graph: SceneGraph,
  nodeChanges: KiwiNodeChange[],
  colGuid: GUID,
  parentGuid: GUID,
  variableIds: string[],
  varIdToGuid: Map<string, GUID>,
  modeIdToGuid: Map<string, GUID>
): void {
  let varIdx = 0
  for (const varId of variableIds) {
    const variable = graph.variables.get(varId)
    if (!variable) continue

    const varGuid = varIdToGuid.get(varId) ?? stringToGuid(varId)
    const typeMap: Record<string, string> = {
      COLOR: 'COLOR',
      BOOLEAN: 'BOOLEAN',
      STRING: 'STRING'
    }
    const resolvedType = typeMap[variable.type] ?? 'FLOAT'

    const entries = Object.entries(variable.valuesByMode).map(([modeId, value]) => ({
      modeID: modeIdToGuid.get(modeId) ?? stringToGuid(modeId),
      variableData: variableValueToKiwi(value, variable.type, varIdToGuid)
    }))

    const nc: KiwiNodeChange = {
      guid: varGuid,
      parentIndex: { guid: parentGuid, position: fractionalPosition(varIdx++) },
      type: 'VARIABLE',
      name: variable.name,
      phase: 'CREATED',
      strokeAlign: 'CENTER',
      strokeJoin: 'BEVEL',
      variableSetID: { guid: colGuid },
      variableResolvedType: resolvedType,
      variableDataValues: { entries },
      variableScopes: ['ALL_SCOPES']
    }
    if (variable.key) nc.key = variable.key
    if (variable.version) nc.version = variable.version
    nodeChanges.push(nc)
  }
}

function appendVariableNodeChanges(
  graph: SceneGraph,
  nodeChanges: KiwiNodeChange[],
  internalCanvasGuid: GUID,
  varIdToGuid: Map<string, GUID>,
  modeIdToGuid: Map<string, GUID>
): void {
  let collIdx = 0
  for (const [colId, col] of graph.variableCollections) {
    const colGuid = varIdToGuid.get(colId) ?? stringToGuid(colId)
    nodeChanges.push({
      guid: colGuid,
      parentIndex: { guid: internalCanvasGuid, position: fractionalPosition(collIdx++) },
      type: 'VARIABLE_SET',
      name: col.name,
      phase: 'CREATED',
      strokeAlign: 'CENTER',
      strokeJoin: 'BEVEL',
      variableSetModes: col.modes.map((mode, index) => ({
        id: modeIdToGuid.get(mode.modeId) ?? stringToGuid(mode.modeId),
        name: mode.name,
        sortPosition: fractionalPosition(index)
      }))
    })

    appendVariablesForCollection(
      graph,
      nodeChanges,
      colGuid,
      internalCanvasGuid,
      col.variableIds,
      varIdToGuid,
      modeIdToGuid
    )
  }
}

export function planFigVariableExport(
  graph: SceneGraph,
  localIdCounter: { value: number },
  assignedGuidValues: Set<string>
): FigVariableExportPlan {
  const varIdToGuid = new Map<string, GUID>()
  const modeIdToGuid = new Map<string, GUID>()

  for (const [colId, col] of graph.variableCollections) {
    const colGuid = { sessionID: 0, localID: localIdCounter.value++ }
    varIdToGuid.set(colId, colGuid)
    assignedGuidValues.add(`${colGuid.sessionID}:${colGuid.localID}`)
    for (const mode of col.modes) {
      const modeGuid = { sessionID: 0, localID: localIdCounter.value++ }
      modeIdToGuid.set(mode.modeId, modeGuid)
      assignedGuidValues.add(`${modeGuid.sessionID}:${modeGuid.localID}`)
    }
    for (const varId of col.variableIds) {
      const varGuid = { sessionID: 0, localID: localIdCounter.value++ }
      varIdToGuid.set(varId, varGuid)
      assignedGuidValues.add(`${varGuid.sessionID}:${varGuid.localID}`)
    }
  }

  return {
    varIdToGuid,
    modeIdToGuid,
    appendNodeChanges(nodeChanges, internalCanvasGuid) {
      appendVariableNodeChanges(graph, nodeChanges, internalCanvasGuid, varIdToGuid, modeIdToGuid)
    }
  }
}
