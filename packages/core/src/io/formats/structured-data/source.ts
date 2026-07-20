export function withoutByteOrderMark(source: string): string {
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
}
