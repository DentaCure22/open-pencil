import { afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

export function useLocalWorkspaceAuthorityFixture() {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
  })

  return {
    async createStore() {
      const root = await mkdtemp(path.join(tmpdir(), 'openpencil-local-authority-'))
      roots.push(root)
      return {
        root,
        store: new LocalWorkspaceAuthorityStore({
          preferredWorkspaceId: 'workspace-canonical',
          root
        })
      }
    },
    trackRoot(root: string) {
      roots.push(root)
    }
  }
}
