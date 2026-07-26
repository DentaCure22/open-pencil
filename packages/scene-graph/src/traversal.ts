import type { SceneNode } from './types'

export function* getDescendants(
  nodes: ReadonlyMap<string, SceneNode>,
  nodeId: string
): IterableIterator<SceneNode> {
  const node = nodes.get(nodeId)
  if (!node) return
  const stack: string[] = []
  for (let index = node.childIds.length - 1; index >= 0; index--) {
    stack.push(node.childIds[index])
  }
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined) return
    const child = nodes.get(id)
    if (!child) continue
    yield child
    for (let index = child.childIds.length - 1; index >= 0; index--) {
      stack.push(child.childIds[index])
    }
  }
}

export function countDescendants(nodes: ReadonlyMap<string, SceneNode>, nodeId: string): number {
  const node = nodes.get(nodeId)
  if (!node) return 0
  let count = 0
  const stack = [...node.childIds]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined) break
    count++
    const child = nodes.get(id)
    if (!child) continue
    for (const childId of child.childIds) stack.push(childId)
  }
  return count
}
