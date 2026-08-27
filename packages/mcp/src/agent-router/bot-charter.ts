import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { WorkMapSnapshot } from './work-map-contract'

const BOT_CHARTER_DIRECTORY = 'bot-charters'
const BOT_CHARTER_FILENAME = 'AGENTS.md'

export function botCharterKey(botId: string): string {
  return createHash('sha256').update(botId).digest('hex')
}

export function botCharterPath(authorityRoot: string, botId: string): string {
  return path.join(
    path.resolve(authorityRoot),
    BOT_CHARTER_DIRECTORY,
    botCharterKey(botId),
    BOT_CHARTER_FILENAME
  )
}

function botCharterTemplate(botId: string, directoryName?: string): string {
  const identity = JSON.stringify(botId)
  const directory = directoryName?.trim()
  return `# OpenPencil Bot charter

This is the durable instruction file for Bot ${identity}.${directory ? ` Its directory is ${JSON.stringify(directory)}.` : ''}

## Conversation

- Speak like a capable person texting, not a report generator.
- Keep replies concise and direct. Usually use one short paragraph for one thought.
- When there are genuinely distinct updates, separate them with blank lines so any delivery channel can present them as separate messages.
- Avoid headings, long introductions, and dense lists unless the information is genuinely structured.
- Do not fragment approvals, code, factual briefings, or important handoffs merely to make them shorter.

## Work

- Keep references to Todos, progress, scheduled results, approvals, files, and Board objects concise. Their linked objects carry the detail.
- Scheduled work stays scheduled and reports back through the same Bot identity.
- Ask only for choices that materially change the work, and present those choices compactly.

## Delivery boundary

- The OpenPencil chat and a future Messages or iMessage connection are delivery channels for this same Bot, not separate personalities.
- Keep behavior and state independent of channel-specific UI. Never assume that a particular bubble, sidebar, or card is available in the text itself.
`
}

export function ensureBotCharter(
  authorityRoot: string,
  input: { botId: string; directoryName?: string }
): string {
  const filePath = botCharterPath(authorityRoot, input.botId)
  if (existsSync(filePath)) return filePath
  const directory = path.dirname(filePath)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = path.join(directory, `.${BOT_CHARTER_FILENAME}.${randomUUID()}.tmp`)
  writeFileSync(temporary, botCharterTemplate(input.botId, input.directoryName), {
    encoding: 'utf8',
    mode: 0o600
  })
  renameSync(temporary, filePath)
  chmodSync(filePath, 0o600)
  return filePath
}

export function botCharterForThread(
  authorityRoot: string,
  workMap: WorkMapSnapshot,
  threadId: string
): { botId: string; path: string } | null {
  const bot = workMap.bots.find((candidate) => candidate.threadId === threadId)
  if (!bot) return null
  const directoryName = bot.projectId
    ? workMap.projects.find((project) => project.id === bot.projectId)?.name
    : undefined
  return {
    botId: bot.id,
    path: ensureBotCharter(authorityRoot, { botId: bot.id, directoryName })
  }
}
