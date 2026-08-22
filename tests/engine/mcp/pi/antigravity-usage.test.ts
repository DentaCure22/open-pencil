import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  captureAntigravityUsageCursor,
  parseAntigravityGenerationMetadata,
  readAntigravityTurnUsage,
  type AntigravitySqlDatabase
} from '#mcp/pi/antigravity-usage'

function encodeVarint(value: number): number[] {
  const bytes: number[] = []
  let remaining = BigInt(value)
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n))
    remaining >>= 7n
  }
  bytes.push(Number(remaining))
  return bytes
}

function varintField(field: number, value: number): number[] {
  return [...encodeVarint(field << 3), ...encodeVarint(value)]
}

function bytesField(field: number, value: number[]): number[] {
  return [...encodeVarint((field << 3) | 2), ...encodeVarint(value.length), ...value]
}

function generationMetadata({
  cacheRead,
  generation,
  input,
  output,
  reasoning
}: {
  cacheRead: number
  generation: number
  input: number
  output: number
  reasoning: number
}): Uint8Array {
  const stats = [
    ...varintField(2, input),
    ...varintField(3, output),
    ...varintField(5, cacheRead),
    ...varintField(9, reasoning),
    ...varintField(10, generation)
  ]
  return Uint8Array.from(bytesField(1, bytesField(4, stats)))
}

function fakeDatabase(rows: Array<{ data: Uint8Array; idx: number }>): AntigravitySqlDatabase {
  return {
    close() {
      return undefined
    },
    prepare(sql) {
      return {
        all(...parameters) {
          if (!sql.includes('WHERE idx > ?')) throw new Error(`Unexpected query: ${sql}`)
          const minimum = Number(parameters[0])
          return rows.filter((row) => row.idx > minimum)
        },
        get() {
          if (!sql.includes('MAX(idx)')) throw new Error(`Unexpected query: ${sql}`)
          return { maxIndex: rows.at(-1)?.idx ?? null }
        }
      }
    }
  }
}

describe('Antigravity token metadata', () => {
  test('decodes Gemini output and its reasoning and generation components', () => {
    expect(
      parseAntigravityGenerationMetadata(
        generationMetadata({
          cacheRead: 167_134,
          generation: 142,
          input: 5_828,
          output: 319,
          reasoning: 177
        })
      )
    ).toEqual({
      cacheRead: 167_134,
      generation: 142,
      input: 5_828,
      output: 319,
      reasoning: 177
    })
  })

  test('reads only generation rows created after the turn cursor', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'openpencil-antigravity-'))
    const sessionMapPath = path.join(directory, 'sessions.json')
    const rows = [
      {
        data: generationMetadata({
          cacheRead: 100,
          generation: 20,
          input: 10,
          output: 50,
          reasoning: 30
        }),
        idx: 4
      }
    ]
    const openDatabase = async () => fakeDatabase(rows)
    try {
      await writeFile(
        sessionMapPath,
        JSON.stringify({ 'sid:pi-session': { conversationId: 'conversation-1' } })
      )
      const cursor = await captureAntigravityUsageCursor(['pi-session'], {
        conversationsDirectory: directory,
        openDatabase,
        sessionMapPath
      })
      expect(cursor).toEqual({ conversationId: 'conversation-1', maxGenerationIndex: 4 })
      if (!cursor) throw new Error('Expected an Antigravity usage cursor.')

      rows.push(
        {
          data: generationMetadata({
            cacheRead: 200,
            generation: 40,
            input: 20,
            output: 100,
            reasoning: 60
          }),
          idx: 5
        },
        {
          data: generationMetadata({
            cacheRead: 300,
            generation: 80,
            input: 30,
            output: 200,
            reasoning: 120
          }),
          idx: 6
        }
      )

      await expect(
        readAntigravityTurnUsage(['pi-session'], cursor, {
          conversationsDirectory: directory,
          openDatabase,
          sessionMapPath
        })
      ).resolves.toEqual({
        cacheRead: 500,
        generation: 120,
        input: 50,
        output: 300,
        reasoning: 180
      })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('follows the conversation created during a brand-new turn', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'openpencil-antigravity-new-'))
    const sessionMapPath = path.join(directory, 'sessions.json')
    const rows = [
      {
        data: generationMetadata({
          cacheRead: 1_000,
          generation: 75,
          input: 100,
          output: 200,
          reasoning: 125
        }),
        idx: 0
      }
    ]
    const openDatabase = async () => fakeDatabase(rows)
    try {
      const cursor = await captureAntigravityUsageCursor(['new-session'], {
        conversationsDirectory: directory,
        openDatabase,
        sessionMapPath
      })
      expect(cursor).toEqual({ conversationId: null, maxGenerationIndex: -1 })
      if (!cursor) throw new Error('Expected a fresh Antigravity usage cursor.')
      await writeFile(
        sessionMapPath,
        JSON.stringify({ 'sid:new-session': { conversationId: 'conversation-new' } })
      )

      await expect(
        readAntigravityTurnUsage(['new-session'], cursor, {
          conversationsDirectory: directory,
          openDatabase,
          sessionMapPath
        })
      ).resolves.toMatchObject({ output: 200 })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
