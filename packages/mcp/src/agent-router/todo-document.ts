import type { AgentTodoBrief, AgentTodoBriefReference } from './contracts'

export const TODO_CODE_OBJECT_PRESET_ID = 'todo-document' as const

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function paragraphs(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replaceAll('\n', '<br>')}</p>`)
    .join('\n')
}

function listSection(title: string, values: string[] | undefined, kind = ''): string {
  if (!values?.length) return ''
  return `<section${kind ? ` data-kind="${kind}"` : ''}>
  <h2>${escapeHtml(title)}</h2>
  <ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>
</section>`
}

function referenceMarkup(reference: AgentTodoBriefReference): string {
  return `<article data-todo-reference="${escapeHtml(reference.id)}" contenteditable="false">
  <span aria-hidden="true">${reference.kind === 'image' ? 'Image' : 'File'}</span>
  <strong>${escapeHtml(reference.label)}</strong>${reference.note ? `<small>${escapeHtml(reference.note)}</small>` : ''}
</article>`
}

function replaceDocumentTitle(html: string, title: string): string {
  const escaped = escapeHtml(title)
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

export function normalizeTodoCodeObjectBrief(
  brief: AgentTodoBrief,
  title = brief.title?.trim() || brief.goal.trim()
): AgentTodoBrief {
  const canonicalTitle = title.trim().slice(0, 240) || brief.goal.trim().slice(0, 240)
  const source = brief.documentHtml || createTodoDocumentHtml({ ...brief, title: canonicalTitle })
  return {
    ...brief,
    documentHtml: replaceDocumentTitle(source, canonicalTitle),
    title: canonicalTitle
  }
}

export function createTodoDocumentHtml(brief: AgentTodoBrief): string {
  const title = brief.title?.trim() || brief.goal.trim()
  const context = brief.context
    ? `<section data-kind="notes"><h2>Notes</h2>${paragraphs(brief.context)}</section>`
    : ''
  const outcome = brief.desiredOutcome
    ? `<section data-kind="outcome"><h2>Outcome</h2>${paragraphs(brief.desiredOutcome)}</section>`
    : ''
  const nextStep = brief.suggestedNextStep
    ? `<section data-kind="next-step"><h2>Next step</h2>${paragraphs(brief.suggestedNextStep)}</section>`
    : ''
  const references = brief.references?.length
    ? `<section data-todo-references><h2>References</h2><div class="references">${brief.references.map(referenceMarkup).join('')}</div></section>`
    : ''
  const empty =
    context || outcome || nextStep || brief.knownFacts?.length || brief.constraints?.length
      ? ''
      : '<p data-todo-placeholder>Start shaping this Todo here. Add notes, a rough plan, or the decision you need to make.</p>'

  return `<!doctype html>
<html lang="en" data-openpencil-code-object="${TODO_CODE_OBJECT_PRESET_ID}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; container-type: inline-size; }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-width: 0; min-height: 100%; overflow-x: hidden; }
    body { margin: 0; padding: clamp(16px, 5cqw, 28px) clamp(14px, 5cqw, 24px) 80px; background: transparent; color: #202127; font-size: clamp(13px, 3.6cqw, 14px); line-height: 1.62; }
    main { width: 100%; max-width: 720px; min-width: 0; margin: 0 auto; }
    h1 { margin: 0 0 clamp(18px, 5cqw, 24px); overflow-wrap: anywhere; font-size: clamp(24px, 8cqw, 38px); line-height: 1.08; letter-spacing: -0.035em; }
    h2 { margin: 0 0 8px; font-size: 11px; line-height: 1.4; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: #6f7480; }
    section { padding: 18px 0; border-top: 1px solid #7f7f7f38; }
    p { margin: 0 0 10px; }
    ul { margin: 0; padding-left: 20px; }
    li + li { margin-top: 7px; }
    [data-kind="outcome"] p { font-size: 16px; line-height: 1.5; }
    [data-todo-placeholder] { color: #858a96; }
    .references { display: grid; gap: 8px; }
    [data-todo-reference] { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 2px 10px; padding: 10px 0; }
    [data-todo-reference] > span { grid-row: 1 / span 2; font-size: 10px; color: #727782; }
    [data-todo-reference] strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    [data-todo-reference] small { color: #727782; }
    img, picture, video, canvas, svg, iframe { display: block; max-width: 100%; height: auto; }
    pre, table { display: block; max-width: 100%; overflow-x: auto; }
    @container (max-width: 360px) {
      [data-todo-reference] { grid-template-columns: 1fr; gap: 4px; }
      [data-todo-reference] > span { grid-row: auto; }
      [data-todo-reference] strong { white-space: normal; overflow-wrap: anywhere; }
    }
    @media (prefers-color-scheme: dark) {
      body { color: #f2f3f5; }
      h2, [data-todo-reference] > span, [data-todo-reference] small { color: #979ca8; }
      [data-todo-placeholder] { color: #858a96; }
    }
  </style>
</head>
<body>
  <main data-todo-document>
    <h1 data-todo-title>${escapeHtml(title)}</h1>
    ${empty}
    ${context}
    ${outcome}
    ${listSection('What we know', brief.knownFacts, 'known-facts')}
    ${listSection('Constraints', brief.constraints, 'constraints')}
    ${listSection('Open questions', brief.openQuestions, 'open-questions')}
    ${nextStep}
    ${listSection('Done when', brief.acceptance, 'acceptance')}
    ${references}
  </main>
</body>
</html>`
}
