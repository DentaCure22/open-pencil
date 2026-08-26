import { describe, expect, test } from 'bun:test'

async function source(path: string): Promise<string> {
  return Bun.file(path).text()
}

describe('agent chat application modules', () => {
  test('keeps remote concerns out of the conversation interface', async () => {
    expect(await Bun.file('src/app/agent-chat/client.ts').exists()).toBe(false)

    const conversations = await source('src/app/agent-chat/conversations.ts')
    expect(conversations).not.toContain('/work-map')
    expect(conversations).not.toContain('/workspace-file')
    expect(conversations).not.toContain('/terminal-sessions')
    expect(conversations).not.toContain('/v1/attachments')
    expect(conversations).not.toContain('/respond')
  })

  test('places each local-authority route with its owning app concern', async () => {
    const [approvals, attachments, workMap, workspace] = await Promise.all([
      source('src/app/agent-chat/approval.ts'),
      source('src/app/agent-chat/attachment-transfer.ts'),
      source('src/app/agent-chat/work-map.ts'),
      source('src/app/agent-chat/workspace.ts')
    ])

    expect(approvals).toContain('/respond')
    expect(attachments).toContain('/agent-router/v1/attachments')
    expect(workMap).toContain('/agent-router/v1/pi/work-map')
    expect(workspace).toContain('/agent-router/v1/pi/workspace-files')
    expect(workspace).toContain('/agent-router/v1/pi/terminal-sessions')
  })
})
