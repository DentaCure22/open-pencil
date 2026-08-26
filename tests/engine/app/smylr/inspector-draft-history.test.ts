import { describe, expect, test } from 'bun:test'

import { createLiveInspectorDraftHistory } from '@/app/smylr-live-inspector/draft-history'
import type { LiveInspectorPatchDraft } from '@/app/smylr-live-inspector/patch'

function draft(nodeId: string, color: string): LiveInspectorPatchDraft {
  return {
    add: [],
    nodeId,
    remove: [],
    styles: { color }
  }
}

describe('Smylr live-inspector draft history', () => {
  test('owns undo and redo snapshots behind one history interface', () => {
    let selectedId: string | null = 'patient'
    const replays: Array<Map<string, LiveInspectorPatchDraft>> = []
    const history = createLiveInspectorDraftHistory({
      onReplay: (drafts) => replays.push(new Map(drafts)),
      selectedNodeId: () => selectedId
    })

    expect(
      history.commit(new Map([['patient', draft('patient', 'red')]]), {
        label: 'Change patient color',
        nodeId: 'patient'
      })
    ).toBe(true)
    expect(history.canUndo.value).toBe(true)
    expect(history.canUndoSelected.value).toBe(true)
    expect(history.undoLabel.value).toBe('Change patient color')

    expect(history.undo()).toBe(true)
    expect(history.drafts.value.size).toBe(0)
    expect(history.canRedo.value).toBe(true)
    expect(history.historyEpoch.value).toBe(1)

    selectedId = 'other'
    expect(history.canRedoSelected.value).toBe(false)
    expect(history.redo()).toBe(true)
    expect(history.drafts.value.get('patient')?.styles?.color).toBe('red')
    expect(replays).toHaveLength(2)
  })

  test('coalesces rapid edits and explicit pointer transactions into one undo entry', () => {
    let clock = 1_000
    const history = createLiveInspectorDraftHistory({
      now: () => clock,
      onReplay: () => {},
      selectedNodeId: () => 'patient'
    })

    history.commit(new Map([['patient', draft('patient', 'red')]]), {
      coalesceKey: 'patient:color',
      nodeId: 'patient'
    })
    clock += 100
    history.commit(new Map([['patient', draft('patient', 'blue')]]), {
      coalesceKey: 'patient:color',
      nodeId: 'patient'
    })
    expect(history.undo()).toBe(true)
    expect(history.drafts.value.size).toBe(0)

    history.beginTransaction('patient:color')
    history.commit(new Map([['patient', draft('patient', 'green')]]), {
      coalesceKey: 'patient:color',
      nodeId: 'patient'
    })
    clock += 1_000
    history.commit(new Map([['patient', draft('patient', 'purple')]]), {
      coalesceKey: 'patient:color',
      nodeId: 'patient'
    })
    history.endTransaction('patient:color')
    expect(history.undo()).toBe(true)
    expect(history.drafts.value.size).toBe(0)
  })

  test('replacing restored state does not create history and reset clears route-local stacks', () => {
    const history = createLiveInspectorDraftHistory({
      onReplay: () => {},
      selectedNodeId: () => null
    })
    history.replace(new Map([['patient', draft('patient', 'red')]]))
    expect(history.canUndo.value).toBe(false)

    history.commit(new Map([['patient', draft('patient', 'blue')]]))
    expect(history.canUndo.value).toBe(true)
    history.reset()
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(false)
  })
})
