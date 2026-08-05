import { describe, expect, test } from 'bun:test'

import { resolveAutomationTabFromTabs } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'
import type { Tab } from '@/app/tabs'
import {
  createOpenPencilWorkspaceIdentity,
  stampOpenPencilWorkspaceIdentity
} from '@/app/workspace-document/identity'

function tab(id: string, documentName: string): Tab {
  const store = createEditorStore()
  store.state.documentName = documentName
  return { id, store }
}

describe('OpenPencil workspace automation target', () => {
  test('defaults to the one workspace instead of an active external document', () => {
    const workspace = tab('tab-workspace', 'OpenPencil Workspace')
    const identity = createOpenPencilWorkspaceIdentity(() => 'stable')
    stampOpenPencilWorkspaceIdentity(workspace.store.graph, identity)
    const external = tab('tab-external', 'Imported file')
    const tabs = [workspace, external]

    expect(
      resolveAutomationTabFromTabs(tabs, external.store, undefined, undefined, undefined).id
    ).toBe(workspace.id)
    expect(
      resolveAutomationTabFromTabs(tabs, external.store, undefined, undefined, identity.workspaceId)
        .id
    ).toBe(workspace.id)
    expect(
      resolveAutomationTabFromTabs(tabs, external.store, external.id, undefined, undefined).id
    ).toBe(external.id)
  })

  test('fails instead of guessing when multiple workspaces are open', () => {
    const first = tab('tab-workspace-a', 'OpenPencil Workspace')
    const second = tab('tab-workspace-b', 'OpenPencil Workspace copy')
    stampOpenPencilWorkspaceIdentity(
      first.store.graph,
      createOpenPencilWorkspaceIdentity(() => 'first')
    )
    stampOpenPencilWorkspaceIdentity(
      second.store.graph,
      createOpenPencilWorkspaceIdentity(() => 'second')
    )

    expect(() =>
      resolveAutomationTabFromTabs([first, second], second.store, undefined, undefined, undefined)
    ).toThrow('Multiple OpenPencil workspaces are open')
  })
})
