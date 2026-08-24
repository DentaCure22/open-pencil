import { describe, expect, test } from 'bun:test'

describe('agent annotation design contract', () => {
  test('uses a flat theme-aware composer chip', async () => {
    const [tokens, prompt] = await Promise.all([
      Bun.file('src/app.css').text(),
      Bun.file('src/components/ai-elements/AiPromptInput.vue').text()
    ])

    expect(tokens).toContain('--color-agent-annotation-chip: #303030')
    expect(tokens).toContain('--color-agent-annotation-chip: #ffffff')
    expect(prompt).toContain('border-agent-border bg-agent-annotation-chip')
    expect(prompt).toContain('rounded-[9px] border text-[12px] font-medium text-surface"')
  })

  test('shows draft and transcript image snapshots that open annotation', async () => {
    const [prompt, attachments, agentImage] = await Promise.all([
      Bun.file('src/components/ai-elements/AiPromptInput.vue').text(),
      Bun.file('src/components/ai-elements/AiAttachments.vue').text(),
      Bun.file('src/app/context-comment/agent-image.ts').text()
    ])

    expect(prompt).toContain('data-test-id="ai-prompt-image"')
    expect(prompt).toContain('data-test-id="ai-prompt-browser-capture-image"')
    expect(prompt).toContain('browserCaptureAttachmentPreview')
    expect(prompt).toContain('readImagePreviewSize')
    expect(attachments).toContain('data-test-id="ai-chat-image"')
    expect(attachments).toContain('readImagePreviewSize')
    expect(agentImage).toContain('export async function readImagePreviewSize')
  })

  test('attaches files, folders, and capture sessions from one composer menu', async () => {
    const prompt = await Bun.file('src/components/ai-elements/AiPromptInput.vue').text()

    expect(prompt).toContain('data-test-id="ai-prompt-attach-menu"')
    expect(prompt).toContain('data-test-id="ai-prompt-attach-files"')
    expect(prompt).toContain('data-test-id="ai-prompt-attach-folders"')
    expect(prompt).toContain('data-test-id="ai-prompt-attach-sessions"')
    expect(prompt).toContain('data-test-id="ai-prompt-attach-sessions-menu"')
    expect(prompt).toContain('data-test-id="ai-prompt-attach-session"')
    expect(prompt).toContain('attachSessionsOpen')
    expect(prompt).not.toContain('DropdownMenuSub')
    expect(prompt).not.toContain("attachMenuView === 'root'")
    expect(prompt).not.toContain('data-test-id="ai-prompt-attach-session-back"')
    expect(prompt).not.toContain('backdrop-blur-xl')
    expect(prompt).toContain('createBrowserCaptureAttachment')
    expect(prompt).toContain('webkitdirectory')
    expect(prompt).toContain('data-test-id="ai-prompt-stop"')
    expect(prompt).toContain('block size-3 rounded-[3px] bg-current')
  })
})
