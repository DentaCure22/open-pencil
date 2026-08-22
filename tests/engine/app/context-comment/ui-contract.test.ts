import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../..')

function source(path: string) {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('context comment UI contract', () => {
  test('offers one shared comment flow from the toolbar and selected live container', () => {
    const toolbar = source('src/components/Toolbar/DesktopToolbar.vue')
    const liveContainer = source('src/components/SmylrLiveContainerOverlay.vue')
    const lifecycle = source('src/app/context-comment/live-inspector-lifecycle.ts')

    expect(toolbar).toContain('<ContextCommentToolbarControl />')
    expect(liveContainer).toContain('liveInspectorSelectionEpoch')
    expect(liveContainer).toContain('openContextCommentForLiveInspector(store)')
    expect(lifecycle).toContain("current?.target.kind === 'live-container'")
    expect(lifecycle).toContain('closeContextComment()')
  })

  test('uses the shared composer and routes a bounded crop directly to a worker', () => {
    const composer = source('src/components/context-comment/ContextCommentComposer.vue')
    const dispatch = source('src/app/context-comment/dispatch.ts')

    expect(composer).toContain('data-test-id="context-comment-dictation"')
    expect(composer).toContain('data-test-id="context-comment-capture"')
    expect(composer).toContain('data-test-id="context-comment-send"')
    expect(composer).toContain('<AiModelAndEffortSelect :scope="CONTEXT_COMMENT_MODEL_SCOPE" />')
    expect(composer).toContain('placeholder="Add a comment…"')
    expect(composer).toContain('@keydown="inputKeydown"')
    expect(composer).not.toContain('⌘↵')
    expect(composer).toContain('rounded-full')
    expect(composer).toContain('0_24px_70px_rgba(0,0,0,0.34)')
    expect(dispatch).toContain("'/agent-router/v1/pi/dispatch'")
    expect(dispatch).toContain('contextCommentPrompt(draft)')
    expect(dispatch).toContain('evidenceId: draft.capture.evidenceId')
  })
})
