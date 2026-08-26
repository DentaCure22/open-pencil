import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { WorkspaceTerminalSessions } from '#mcp/agent-router/terminal-sessions'

test('workspace terminal keeps shell state between commands', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-terminal-'))
  const terminals = new WorkspaceTerminalSessions()
  const session = terminals.create(root)
  try {
    terminals.write(session.id, 'cd /\n')
    terminals.write(session.id, 'printf \'openpencil-terminal-ready:%s\\n\' "$PWD"\n')
    const deadline = Date.now() + 3_000
    let output = ''
    while (!output.includes('openpencil-terminal-ready') && Date.now() < deadline) {
      await Bun.sleep(20)
      output += terminals
        .read(session.id)
        .chunks.map((chunk) => chunk.text)
        .join('')
    }
    expect(output).toContain('openpencil-terminal-ready:/')
    expect(terminals.close(session.id)).toBe(true)
    expect(() => terminals.read(session.id)).toThrow('Terminal session not found')
  } finally {
    terminals.close(session.id)
    await rm(root, { force: true, recursive: true })
  }
})
