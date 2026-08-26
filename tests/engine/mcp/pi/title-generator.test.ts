import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  XAI_CONVERSATION_TITLE_EFFORT,
  XAI_CONVERSATION_TITLE_MODEL
} from '#mcp/pi/providers/xai/title'
import {
  conversationTitlePrompt,
  piConversationTitleArguments,
  PiConversationTitleGenerator,
  sanitizeConversationTitle
} from '#mcp/pi/title-generator'

describe('Pi conversation title generation', () => {
  test('uses isolated xAI Composer 2.5 arguments', () => {
    const args = piConversationTitleArguments({
      effort: XAI_CONVERSATION_TITLE_EFFORT,
      extensionPaths: ['/tmp/pi-xai-oauth'],
      model: XAI_CONVERSATION_TITLE_MODEL
    })

    expect(XAI_CONVERSATION_TITLE_MODEL).toBe('xai-auth/grok-composer-2.5-fast')
    expect(XAI_CONVERSATION_TITLE_EFFORT).toBe('medium')
    expect(args).toEqual(
      expect.arrayContaining([
        '--no-context-files',
        '--no-extensions',
        '--no-session',
        '--no-skills',
        '--no-tools'
      ])
    )
    expect(args.slice(args.indexOf('--provider'), args.indexOf('--provider') + 2)).toEqual([
      '--provider',
      'xai-auth'
    ])
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual([
      '--model',
      'grok-composer-2.5-fast'
    ])
    expect(args.slice(-2)).toEqual(['--extension', '/tmp/pi-xai-oauth'])
  })

  test('prompts for the durable goal and normalizes fenced JSON', () => {
    const prompt = conversationTitlePrompt({
      attachmentNames: ['capture.png'],
      message: 'Use two agents and make a report explaining why chat titles stay too long.'
    })

    expect(prompt).toContain("Summarize the user's durable goal")
    expect(prompt).toContain('- capture.png')
    expect(
      sanitizeConversationTitle('```json\n{"title":"  Fix   chat title generation.  "}\n```')
    ).toBe('Fix chat title generation')
    expect(sanitizeConversationTitle('{"title":""}')).toBeNull()
  })

  test('runs one ephemeral tool-free RPC request and returns its generated title', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-title-generator-'))
    const executable = path.join(root, 'pi-title-stub')
    const launchLog = path.join(root, 'launch.json')
    const commandLog = path.join(root, 'commands.jsonl')
    const extensionPath = path.join(root, 'pi-xai-oauth')
    await mkdir(extensionPath)
    await writeFile(
      executable,
      `#!/usr/bin/env node
const readline = require('node:readline')
const { appendFileSync, writeFileSync } = require('node:fs')
writeFileSync(${JSON.stringify(launchLog)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))
const lines = readline.createInterface({ input: process.stdin })
function send(value) { process.stdout.write(JSON.stringify(value) + '\\n') }
lines.on('line', (line) => {
  const command = JSON.parse(line)
  appendFileSync(${JSON.stringify(commandLog)}, JSON.stringify(command) + '\\n')
  if (command.type !== 'prompt') return
  send({ command: 'prompt', id: command.id, success: true, type: 'response' })
  send({
    message: {
      content: [{ text: '{"title":"Summarize chat names"}', type: 'text' }],
      role: 'assistant',
      stopReason: 'stop'
    },
    type: 'message_end'
  })
  send({ type: 'agent_settled' })
})
`
    )
    await chmod(executable, 0o755)
    const generator = new PiConversationTitleGenerator({
      cwd: root,
      effort: XAI_CONVERSATION_TITLE_EFFORT,
      executable,
      extensionPaths: [extensionPath],
      model: XAI_CONVERSATION_TITLE_MODEL
    })

    try {
      expect(await generator.generate({ message: 'How can chats receive summarized names?' })).toBe(
        'Summarize chat names'
      )
      const launch = JSON.parse(await readFile(launchLog, 'utf8')) as {
        argv: string[]
        cwd: string
      }
      const commands = (await readFile(commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { message?: string; type: string })

      expect(await realpath(launch.cwd)).toBe(await realpath(root))
      expect(launch.argv).toEqual(expect.arrayContaining(['--no-session', '--no-tools']))
      expect(commands).toHaveLength(1)
      expect(commands[0]).toMatchObject({ type: 'prompt' })
      expect(commands[0]?.message).toContain('How can chats receive summarized names?')
    } finally {
      generator.close()
      await rm(root, { force: true, recursive: true })
    }
  })
})
