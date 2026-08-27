import { describe, expect, test } from 'bun:test'

import {
  createTodoDocumentHtml,
  normalizeTodoCodeObjectBrief,
  TODO_CODE_OBJECT_PRESET_ID
} from '#mcp/agent-router/todo-document'

describe('Todo Code Object document', () => {
  test('creates a responsive editable preset document', () => {
    const html = createTodoDocumentHtml({
      goal: 'Keep the chart visible while planning',
      title: 'Patient history shortcuts'
    })

    expect(html).toContain(`data-openpencil-code-object="${TODO_CODE_OBJECT_PRESET_ID}"`)
    expect(html).toContain('<h1 data-todo-title>Patient history shortcuts</h1>')
    expect(html).toContain('container-type: inline-size')
    expect(html).toContain('max-width: 100%')
    expect(html).toContain('@container (max-width: 360px)')
  })

  test('keeps one canonical title in custom HTML', () => {
    const brief = normalizeTodoCodeObjectBrief(
      {
        documentHtml:
          '<!doctype html><html><head><title>Old</title></head><body><main><h1>Old</h1><p>Keep me.</p></main></body></html>',
        goal: 'A longer source goal'
      },
      'Canonical Todo title'
    )

    expect(brief.title).toBe('Canonical Todo title')
    expect(brief.documentHtml).toContain('<title>Canonical Todo title</title>')
    expect(brief.documentHtml).toContain('<h1 data-todo-title>Canonical Todo title</h1>')
    expect(brief.documentHtml).toContain('<p>Keep me.</p>')
    expect(brief.documentHtml).toContain(
      `data-openpencil-code-object="${TODO_CODE_OBJECT_PRESET_ID}"`
    )
  })
})
