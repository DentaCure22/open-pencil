import type { Vector } from '@open-pencil/scene-graph'

export type ObjectGraphPortPresentation = Readonly<Record<string, Vector>>

type ObjectGraphPortPresentationCallback = (nodeId: string) => void

const presentations = new Map<string, ObjectGraphPortPresentation>()
const changeCallbacks = new Set<ObjectGraphPortPresentationCallback>()
const invalidationCallbacks = new Set<ObjectGraphPortPresentationCallback>()

function samePresentation(
  current: ObjectGraphPortPresentation | undefined,
  next: ObjectGraphPortPresentation
): boolean {
  if (!current) return false
  const currentIds = Object.keys(current)
  const nextIds = Object.keys(next)
  return (
    currentIds.length === nextIds.length &&
    nextIds.every((id) => current[id]?.x === next[id]?.x && current[id]?.y === next[id]?.y)
  )
}

function notify(callbacks: ReadonlySet<ObjectGraphPortPresentationCallback>, nodeId: string): void {
  for (const callback of callbacks) callback(nodeId)
}

export function readObjectGraphPortPresentation(
  nodeId: string
): ObjectGraphPortPresentation | undefined {
  return presentations.get(nodeId)
}

export function publishObjectGraphPortPresentation(
  nodeId: string,
  next: ObjectGraphPortPresentation
): boolean {
  if (samePresentation(presentations.get(nodeId), next)) return false
  presentations.set(nodeId, Object.freeze(structuredClone(next)))
  notify(changeCallbacks, nodeId)
  return true
}

export function clearObjectGraphPortPresentation(nodeId: string): boolean {
  if (!presentations.delete(nodeId)) return false
  notify(changeCallbacks, nodeId)
  return true
}

export function invalidateObjectGraphPortPresentation(nodeId: string): void {
  notify(invalidationCallbacks, nodeId)
}

export function subscribeObjectGraphPortPresentation(
  callback: ObjectGraphPortPresentationCallback
): () => void {
  changeCallbacks.add(callback)
  return () => changeCallbacks.delete(callback)
}

export function subscribeObjectGraphPortInvalidation(
  callback: ObjectGraphPortPresentationCallback
): () => void {
  invalidationCallbacks.add(callback)
  return () => invalidationCallbacks.delete(callback)
}
