import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getWorkspaceNodes,
  listWorkspaceChildren,
  loadWorkspace,
  nearbyWorkspaceUnits,
  parseIdList,
  WORKSPACE_GET_CONTRACT,
  WORKSPACE_LS_CONTRACT,
  WORKSPACE_NEARBY_CONTRACT
} from '#cli/board-file/inspect'
import { resolveWorkspacePath } from '#cli/board-file/workspace'

type JsonRecord = Record<string, unknown>

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const cli = join(repo, 'packages/cli/src/index.ts')

function node(id: string, fields: JsonRecord): [string, JsonRecord] {
  return [id, { id, ...fields }]
}

function workspaceNodes(): Array<[string, JsonRecord]> {
  return [
    node('page', {
      childIds: [
        'card',
        'shelf',
        'note',
        ...Array.from({ length: 70 }, (_, index) => `extra-${String(index)}`)
      ],
      name: 'Dental Board',
      type: 'CANVAS'
    }),
    node('card', {
      childIds: ['title'],
      height: 240,
      name: 'Morning Light',
      parentId: 'page',
      type: 'FRAME',
      width: 320,
      x: 120,
      y: 180
    }),
    node('title', {
      height: 24,
      name: 'Morning Light title',
      parentId: 'card',
      pluginData: [{ key: 'blob', pluginId: 'test', value: 'x'.repeat(5000) }],
      text: 'Hello',
      type: 'TEXT',
      width: 200,
      x: 20,
      y: 20
    }),
    node('shelf', {
      height: 200,
      name: 'Second Shelf',
      parentId: 'page',
      type: 'FRAME',
      width: 400,
      x: 500,
      y: 180
    }),
    node('note', {
      height: 80,
      name: 'Far note',
      parentId: 'page',
      type: 'FRAME',
      width: 120,
      x: 2000,
      y: 180
    }),
    ...Array.from({ length: 70 }, (_, index) =>
      node(`extra-${String(index)}`, {
        height: 10,
        name: `Extra ${String(index)}`,
        parentId: 'page',
        type: 'FRAME',
        width: 10,
        x: 10000,
        y: index * 20
      })
    )
  ]
}

async function writeWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-board-file-'))
  const workspacePath = join(directory, 'workspace.json')
  await writeFile(workspacePath, `${JSON.stringify({ nodes: workspaceNodes() }, null, 2)}\n`)
  return workspacePath
}

describe('board file inspect', () => {
  test('parses comma-separated ids and resolves a workspace path', () => {
    expect(parseIdList(['0:35, 0:36'])).toEqual(['0:35', '0:36'])
    expect(resolveWorkspacePath('/tmp/board/workspace.json')).toBe('/tmp/board/workspace.json')
    expect(resolveWorkspacePath('/tmp/board')).toBe('/tmp/board/workspace.json')
  })

  test('gets one node and truncates huge pluginData', async () => {
    const workspacePath = await writeWorkspace()
    try {
      const workspace = await loadWorkspace(workspacePath)
      const result = getWorkspaceNodes(workspace, ['title'])
      expect(result.contract).toBe(WORKSPACE_GET_CONTRACT)
      expect(result.missing).toEqual([])
      expect(result.nodes[0]?.id).toBe('title')
      expect(result.nodes[0]?.parentId).toBe('card')
      expect(result.nodes[0]?.truncated.some((path) => path.endsWith('.pluginData'))).toBe(true)
      expect(JSON.stringify(result.nodes[0]?.node)).not.toContain('xxxxx')
    } finally {
      await rm(join(workspacePath, '..'), { force: true, recursive: true })
    }
  })

  test('lists a bounded child page and nearby siblings', async () => {
    const workspacePath = await writeWorkspace()
    try {
      const workspace = await loadWorkspace(workspacePath)
      const listed = listWorkspaceChildren(workspace, 'page', 64)
      expect(listed.contract).toBe(WORKSPACE_LS_CONTRACT)
      expect(listed.container.name).toBe('Dental Board')
      expect(listed.container.id).toBe('page')
      expect(listed.container.width).toBe(0)
      expect(listed.container.height).toBe(0)
      expect(listed.units).toHaveLength(64)
      expect(listed.omitted).toBe(9)
      expect(listed.units[0]).toMatchObject({ id: 'card', name: 'Morning Light' })

      const near = nearbyWorkspaceUnits(workspace, 'card', 8)
      expect(near.contract).toBe(WORKSPACE_NEARBY_CONTRACT)
      expect(near.units[0]?.id).toBe('card')
      expect(near.units[1]?.id).toBe('shelf')
      expect(near.units.map((unit) => unit.id)).not.toContain('title')
      expect(near.omitted).toBeGreaterThan(0)
    } finally {
      await rm(join(workspacePath, '..'), { force: true, recursive: true })
    }
  })

  test('descends one level when a page has a single workspace frame', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-board-file-'))
    const workspacePath = join(directory, 'workspace.json')
    await writeFile(
      workspacePath,
      `${JSON.stringify({
        nodes: [
          node('page', { childIds: ['workspace'], name: 'Dental Chart', type: 'CANVAS' }),
          node('workspace', {
            childIds: ['card', 'shelf'],
            height: 2000,
            name: 'Dental Chart Workspace',
            parentId: 'page',
            type: 'FRAME',
            width: 3000,
            x: 0,
            y: 0
          }),
          node('card', {
            height: 240,
            name: 'Morning Light',
            parentId: 'workspace',
            type: 'FRAME',
            width: 320,
            x: 120,
            y: 180
          }),
          node('shelf', {
            height: 200,
            name: 'Second Shelf',
            parentId: 'workspace',
            type: 'FRAME',
            width: 400,
            x: 500,
            y: 180
          })
        ]
      })}\n`
    )
    try {
      const listed = listWorkspaceChildren(await loadWorkspace(workspacePath), 'page')
      expect(listed.container).toMatchObject({
        childCount: 2,
        height: 2000,
        id: 'workspace',
        name: 'Dental Chart Workspace',
        type: 'FRAME',
        width: 3000
      })
      expect(listed.units.map((unit) => unit.id)).toEqual(['card', 'shelf'])
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('board get and board ls print compact JSON from the CLI', async () => {
    const workspacePath = await writeWorkspace()
    try {
      const got = spawnSync(
        'bun',
        [cli, 'board', 'get', 'card', '--workspace', workspacePath, '--json'],
        { cwd: repo, encoding: 'utf8' }
      )
      expect(got.status).toBe(0)
      const payload = JSON.parse(got.stdout) as { nodes?: Array<{ id?: string }> }
      expect(payload.nodes?.[0]?.id).toBe('card')

      const listed = spawnSync(
        'bun',
        [cli, 'board', 'ls', 'page', '--workspace', workspacePath, '--json', '--limit', '2'],
        { cwd: repo, encoding: 'utf8' }
      )
      expect(listed.status).toBe(0)
      const lsPayload = JSON.parse(listed.stdout) as {
        container?: { id?: string; name?: string }
        omitted?: number
        units?: unknown[]
      }
      expect(lsPayload.container).toMatchObject({ id: 'page', name: 'Dental Board' })
      expect(lsPayload.units).toHaveLength(2)
      expect(lsPayload.omitted).toBe(71)

      const near = spawnSync(
        'bun',
        [cli, 'board', 'nearby', 'card', '--workspace', workspacePath, '--json', '--limit', '1'],
        { cwd: repo, encoding: 'utf8' }
      )
      expect(near.status).toBe(0)
      const nearPayload = JSON.parse(near.stdout) as { units?: Array<{ id?: string }> }
      expect(nearPayload.units?.map((unit) => unit.id)).toEqual(['card', 'shelf'])
    } finally {
      await rm(join(workspacePath, '..'), { force: true, recursive: true })
    }
  })
})
