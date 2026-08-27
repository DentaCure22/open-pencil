import { describe, expect, test } from 'bun:test'

import type { AgentTodoDraft } from '#mcp/agent-router/contracts'
import { todoDraftActivationPrompt } from '#mcp/pi/router'

describe('prepared Todo activation', () => {
  test('gives the active agent the living HTML document and its planning contract', () => {
    const draft: AgentTodoDraft = {
      brief: {
        documentHtml:
          '<!doctype html><html><body><main><h1>Patient history quick panel</h1></main></body></html>',
        goal: 'Shape the patient-history quick panel'
      },
      kind: 'todo',
      projectId: 'project:dental',
      todoId: 'todo:patient-history'
    }

    const prompt = todoDraftActivationPrompt(draft, 'Continue into the plan.')

    expect(prompt).toContain('one responsive Code Object using the todo-document preset')
    expect(prompt).toContain('<h1>Patient history quick panel</h1>')
    expect(prompt).toContain('workmap_update_todo_object')
    expect(prompt).toContain('reflow at narrow and wide panel sizes')
    expect(prompt).toContain('Use it to shape the stable Plan Code Object')
    expect(prompt).toContain("The user's visible first message follows:\nContinue into the plan.")
  })
})
