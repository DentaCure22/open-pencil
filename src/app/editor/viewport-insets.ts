export function visibleElementRect(selector: string): DOMRect | null {
  if (typeof document === 'undefined') return null
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? rect : null
}
