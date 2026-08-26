import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { parseLocalWorkspaceAuthorityReceipt } from '@/app/workspace-document/local-authority/client'

import { startServer } from '#mcp/server'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local workspace authority HTTP receipt contract', () => {
  test('returns initialize and commit receipts accepted by the browser client', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-contract-'))
    roots.push(root)
    const server = startServer({
      authToken: 'authority-contract-token',
      httpPort: 0,
      localWorkspaceId: 'workspace-contract',
      localWorkspaceRoot: root,
      wsPort: 0
    })
    const request = (route: string, body: unknown) =>
      server.app.request(`/local-workspace/v1/${route}`, {
        body: JSON.stringify(body),
        headers: {
          Authorization: 'Bearer authority-contract-token',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      })

    try {
      const initializedResponse = await request('initialize', {
        document: { nodes: ['initial'] },
        requestId: 'request:initialize-contract',
        sourceWorkspaceId: 'workspace-contract'
      })
      expect(initializedResponse.status).toBe(200)
      const initialized = parseLocalWorkspaceAuthorityReceipt(await initializedResponse.json())
      expect(initialized).toMatchObject({
        appliedRevision: 1,
        baseRevision: 0,
        requestId: 'request:initialize-contract',
        status: 'initialized',
        workspaceId: 'workspace-contract'
      })

      const committedResponse = await request('commit', {
        document: { nodes: ['changed'] },
        expectedContentHash: initialized.contentHash,
        expectedRevision: 1,
        requestId: 'request:commit-contract',
        workspaceId: 'workspace-contract'
      })
      expect(committedResponse.status).toBe(200)
      const committed = parseLocalWorkspaceAuthorityReceipt(await committedResponse.json())
      expect(committed).toMatchObject({
        appliedRevision: 2,
        baseRevision: 1,
        requestId: 'request:commit-contract',
        status: 'committed',
        workspaceId: 'workspace-contract'
      })

      const staleBaseResponse = await request('commit', {
        document: { nodes: ['stale-browser-copy'] },
        expectedContentHash: initialized.contentHash,
        expectedRevision: 2,
        requestId: 'request:stale-base-contract',
        workspaceId: 'workspace-contract'
      })
      expect(staleBaseResponse.status).toBe(409)
      expect(await staleBaseResponse.json()).toMatchObject({
        code: 'stale_content_hash',
        currentRevision: committed.appliedRevision
      })

      const invalidResponse = await request('commit', {
        document: { nodes: ['missing-base-hash'] },
        expectedRevision: 2,
        requestId: 'request:missing-base-contract',
        workspaceId: 'workspace-contract'
      })
      expect(invalidResponse.status).toBe(400)
      expect(await invalidResponse.json()).toMatchObject({ code: 'invalid_request' })
    } finally {
      server.close()
    }
  })

  test('accepts an atomically renamed Board file and derives revision, history, and sync', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-external-change-'))
    roots.push(root)
    const workspaceId = 'workspace-external-change'
    const server = startServer({
      authToken: 'authority-external-change-token',
      httpPort: 0,
      localWorkspaceId: workspaceId,
      localWorkspaceRoot: root,
      wsPort: 0
    })
    const headers = { Authorization: 'Bearer authority-external-change-token' }

    try {
      const initializedResponse = await server.app.request('/local-workspace/v1/initialize', {
        body: JSON.stringify({
          document: { nodes: ['initial'] },
          requestId: 'request:initialize-external-change',
          sourceWorkspaceId: workspaceId
        }),
        headers: { ...headers, 'Content-Type': 'application/json' },
        method: 'POST'
      })
      const initialized = parseLocalWorkspaceAuthorityReceipt(await initializedResponse.json())
      const changed = server.app.request(
        `/local-workspace/v1/changes?after_revision=${String(initialized.appliedRevision)}&timeout_ms=2000`,
        { headers }
      )
      await new Promise((resolve) => {
        setTimeout(resolve, 150)
      })

      const workspacePath = path.join(root, 'workspace.json')
      const document = JSON.parse(await readFile(workspacePath, 'utf8')) as { nodes: string[] }
      document.nodes = ['changed-directly']
      const stagedWorkspacePath = path.join(root, 'workspace.json.external.tmp')
      await writeFile(stagedWorkspacePath, `${JSON.stringify(document, null, 2)}\n`)
      await rename(stagedWorkspacePath, workspacePath)

      const observedChange = (await (await changed).json()) as {
        changed: boolean
        contentHash: string
        revision: number
        workspaceId: string
      }
      expect(observedChange).toMatchObject({
        changed: true,
        revision: initialized.appliedRevision + 1,
        workspaceId
      })

      const head = await (await server.app.request('/local-workspace/v1/head', { headers })).json()
      expect(head).toMatchObject({
        contentHash: observedChange.contentHash,
        document,
        revision: observedChange.revision
      })

      const historyFiles = await readdir(path.join(root, 'history'))
      expect(
        historyFiles.some((fileName) =>
          fileName.startsWith(`${String(observedChange.revision).padStart(10, '0')}-`)
        )
      ).toBe(true)
    } finally {
      server.close()
    }
  })
})
