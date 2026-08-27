export const TODO_CODE_OBJECT_PRESET_ID = 'todo-document' as const

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function syncTodoCodeObjectTitle(html: string, title: string): string {
  const canonicalTitle = title.trim().slice(0, 240)
  if (!canonicalTitle) return html
  const escaped = escapeHtml(canonicalTitle)
  let next = html
  if (/<title(?:\s[^>]*)?>[\s\S]*?<\/title>/i.test(next)) {
    next = next.replace(/<title(?:\s[^>]*)?>[\s\S]*?<\/title>/i, `<title>${escaped}</title>`)
  } else if (/<head(?:\s[^>]*)?>/i.test(next)) {
    next = next.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n  <title>${escaped}</title>`)
  }

  const markedHeading =
    /<([a-z][\w:-]*)([^>]*\bdata-todo-title(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*)>[\s\S]*?<\/\1>/i
  if (markedHeading.test(next)) {
    next = next.replace(markedHeading, `<$1$2>${escaped}</$1>`)
  } else if (/<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>/i.test(next)) {
    next = next.replace(/<h1(\s[^>]*)?>[\s\S]*?<\/h1>/i, `<h1$1 data-todo-title>${escaped}</h1>`)
  } else if (/<main(?:\s[^>]*)?>/i.test(next)) {
    next = next.replace(
      /<main(?:\s[^>]*)?>/i,
      (main) => `${main}\n    <h1 data-todo-title>${escaped}</h1>`
    )
  }

  if (/<html\b[^>]*\bdata-openpencil-code-object=/i.test(next)) return next
  return next.replace(
    /<html\b([^>]*)>/i,
    `<html$1 data-openpencil-code-object="${TODO_CODE_OBJECT_PRESET_ID}">`
  )
}
