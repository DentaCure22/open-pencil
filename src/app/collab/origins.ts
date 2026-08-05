export const TRYSTERO_COLLAB_ORIGIN = 'openpencil-trystero'
export const DURABLE_COLLAB_ORIGIN = 'openpencil-durable-store'
export const LOCAL_WORKSPACE_COLLAB_ORIGIN = 'openpencil-local-workspace'
export const YJS_STRUCTURE_REPAIR_ORIGIN = Symbol('open-pencil-yjs-structure-repair')

export function isRemoteCollabOrigin(origin: unknown): boolean {
  return (
    origin === TRYSTERO_COLLAB_ORIGIN ||
    origin === DURABLE_COLLAB_ORIGIN ||
    origin === LOCAL_WORKSPACE_COLLAB_ORIGIN
  )
}
