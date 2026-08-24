export function isEditing(e: Event) {
  return e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
}

export function hasNativeTextSelection(selection: Selection | null = window.getSelection()) {
  return Boolean(selection && !selection.isCollapsed && selection.toString())
}

export function isInputElement(el: EventTarget | null | undefined): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
}
