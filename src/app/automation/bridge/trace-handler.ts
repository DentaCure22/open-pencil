import { computeAbsoluteBounds } from '@open-pencil/scene-graph/geometry'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { AutomationTarget } from '@/app/automation/bridge/target'
import { narratedTraceScopeForStore, queryNarratedTraceHistory } from '@/app/narrated-trace'
import { IS_BROWSER } from '@/constants'

type UnknownRecord = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readRect(value: unknown): Rect | undefined {
  if (!isRecord(value)) return undefined
  const { height, width, x, y } = value
  if (
    typeof height !== 'number' ||
    typeof width !== 'number' ||
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    ![height, width, x, y].every(Number.isFinite) ||
    height < 0 ||
    width < 0
  ) {
    return undefined
  }
  return { height, width, x, y }
}

function selectedContext(target: AutomationTarget): {
  bounds?: Rect
  ids?: string[]
} {
  const store = target.store
  if (store.state.currentPageId !== target.pageId || store.state.selectedIds.size === 0) return {}
  const nodes = [...store.state.selectedIds]
    .map((id) => store.graph.getNode(id))
    .filter((node) => node !== undefined)
  if (nodes.length === 0) return {}
  return {
    bounds: computeAbsoluteBounds(nodes, (id) => store.graph.getAbsolutePosition(id)),
    ids: nodes.map((node) => node.id)
  }
}

function viewportBounds(target: AutomationTarget): Rect | undefined {
  if (target.store.state.currentPageId !== target.pageId || !IS_BROWSER) {
    return undefined
  }
  const topLeft = target.store.screenToCanvas(0, 0)
  const bottomRight = target.store.screenToCanvas(window.innerWidth, window.innerHeight)
  return {
    height: Math.abs(bottomRight.y - topLeft.y),
    width: Math.abs(bottomRight.x - topLeft.x),
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y)
  }
}

export async function handleTraceQuery(
  target: AutomationTarget,
  args: unknown,
  queryTrace: typeof queryNarratedTraceHistory = queryNarratedTraceHistory
): Promise<unknown> {
  const input = isRecord(args) ? args : {}
  const includeCurrentContext = input.include_current_context !== false
  const selection = includeCurrentContext ? selectedContext(target) : {}
  const explicitRegion = readRect(input.traced_region)
  const limit =
    typeof input.limit === 'number' && Number.isInteger(input.limit) ? input.limit : undefined

  return {
    ok: true,
    result: await queryTrace({
      cursor: readString(input.task_cursor),
      limit,
      query: readString(input.query),
      scope: narratedTraceScopeForStore(target.store, target.pageId),
      selectionIds: selection.ids,
      since: readString(input.since),
      tracedRegion: explicitRegion ?? selection.bounds,
      until: readString(input.until),
      viewportBounds: includeCurrentContext ? viewportBounds(target) : undefined
    })
  }
}
