const activeHorizontalResizeLocks = new Set<symbol>()

function syncHorizontalResizeLock() {
  if (typeof document === 'undefined') return
  document.documentElement.toggleAttribute(
    'data-horizontal-resizing',
    activeHorizontalResizeLocks.size > 0
  )
}

export function lockHorizontalResizeCursor(): () => void {
  const token = Symbol('horizontal-resize')
  let released = false
  activeHorizontalResizeLocks.add(token)
  syncHorizontalResizeLock()

  return () => {
    if (released) return
    released = true
    activeHorizontalResizeLocks.delete(token)
    syncHorizontalResizeLock()
  }
}
