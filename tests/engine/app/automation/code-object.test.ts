import { describe, expect, test } from 'bun:test'

import {
  createAutomationCodeObjectReadHandler,
  createAutomationCodeObjectUpsertHandler
} from '@/app/automation/bridge/code-object-handler'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { codeObjectDocument } from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'

function target(): AutomationTarget {
  const store = createEditorStore()
  const page = store.graph.getNode(store.state.currentPageId)
  if (!page) throw new Error('Missing test page')
  return {
    documentId: 'document-1',
    documentName: 'Test document',
    pageId: page.id,
    pageName: page.name,
    store
  }
}

describe('Code Object automation', () => {
  test('upserts by stable identity and returns canonical native readback', async () => {
    const automationTarget = target()
    const upsert = createAutomationCodeObjectUpsertHandler()
    const read = createAutomationCodeObjectReadHandler()
    const created = await upsert(automationTarget, {
      name: 'Agent metric',
      object_key: 'agent-metric',
      props: { label: 'Throughput' },
      source: 'export default function Metric() { return <strong>Fast</strong> }',
      state: { value: 12 },
      width: 640,
      height: 360,
      zoom_to_selection: false
    })
    expect(created).toMatchObject({
      applied: true,
      component: {
        definition_id: 'agent-metric',
        name: 'Agent metric',
        props: { label: 'Throughput' },
        state: { value: 12 }
      },
      frame: { height: 360, name: 'Agent metric', type: 'FRAME', width: 640 },
      mutation_receipt: { status: 'applied' }
    })
    const frameId = (created as { frame: { id: string } }).frame.id

    const updated = await upsert(automationTarget, {
      name: 'Agent metric',
      object_key: 'agent-metric',
      props: { label: 'Throughput' },
      source: 'export default function Metric() { return <strong>Updated</strong> }',
      state: { value: 24 },
      x: 220,
      y: 180,
      zoom_to_selection: false
    })
    expect(updated).toMatchObject({
      applied: true,
      frame: { id: frameId, x: 220, y: 180 }
    })

    const inspected = await read(automationTarget, { object_key: 'agent-metric' })
    expect(inspected).toMatchObject({
      component: {
        definition_id: 'agent-metric',
        state: { value: 24 }
      },
      frame: { id: frameId }
    })
    expect(codeObjectDocument(automationTarget.store.graph.getNode(frameId))?.component).toBe(
      'user-code'
    )
  })
})
