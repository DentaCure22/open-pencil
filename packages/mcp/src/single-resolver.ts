export function singleResolver<T>(resolveValue: (value: T) => void): (value: T) => void {
  let settled = false
  return (value) => {
    if (settled) return
    settled = true
    resolveValue(value)
  }
}
