import { describe, expect, test } from 'bun:test'

import {
  prepareTraceEdit,
  traceEditGestureRpcArgs,
  type TraceEditRpcSender
} from '#cli/board-prepare-edit'

describe('Trace-guided Board preparation CLI', () => {
  test('encapsulates gesture resolution and authoritative Board preparation', async () => {
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const send: TraceEditRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'trace_get_gesture') {
        return {
          result: {
            gesture: {
              boardOrigin: {
                contentDocumentId: 'content:1',
                documentId: 'tab:1',
                pageId: 'page:1',
                runtimeInstanceId: 'runtime:1',
                workspaceId: 'workspace:1'
              },
              candidates: {
                items: [{ stableId: 'frame:card' }, { stableId: 'frame:header' }],
                primaryTargetId: 'frame:header'
              },
              geometry: { pageRegion: { height: 80, width: 160, x: 70, y: 50 } },
              gestureId: 'gesture:1'
            },
            status: 'matched'
          }
        }
      }
      return {
        result: {
          board_build_base: { context_token: 'context:1', expected_revision: 12 },
          contract: 'board-edit-context/v1'
        },
        target: {
          boardRevision: 12,
          documentId: 'tab:1',
          documentName: 'Dental board',
          pageId: 'page:1',
          pageName: 'Exam'
        }
      }
    }

    const prepared = await prepareTraceEdit(
      { intent: 'Make the header white', 'latest-gesture': true },
      send
    )

    expect(calls).toEqual([
      {
        args: { include_image: false, latest: true },
        command: 'trace_get_gesture'
      },
      {
        args: {
          candidate_object_ids: ['frame:card', 'frame:header'],
          content_document_id: 'content:1',
          document_id: 'tab:1',
          gesture_id: 'gesture:1',
          intent: 'Make the header white',
          page_id: 'page:1',
          primary_target_id: 'frame:header',
          region: { height: 80, width: 160, x: 70, y: 50 },
          runtime_instance_id: 'runtime:1',
          workspace_id: 'workspace:1'
        },
        command: 'board_prepare_edit'
      }
    ])
    expect(prepared.semanticRpcCalls).toEqual({
      board_prepare_edit: 1,
      total: 2,
      trace_get_gesture: 1
    })
    expect(prepared.response.result).toMatchObject({ contract: 'board-edit-context/v1' })
  })

  test('requires one selector and a routable captured Board origin', async () => {
    expect(() => traceEditGestureRpcArgs({ intent: 'Edit it' })).toThrow('exactly one')
    expect(() =>
      traceEditGestureRpcArgs({
        'gesture-id': 'gesture:1',
        intent: 'Edit it',
        'latest-gesture': true
      })
    ).toThrow('exactly one')

    const send: TraceEditRpcSender = async () => ({
      result: {
        gesture: {
          boardOrigin: { contentDocumentId: 'content:old', pageId: 'page:old' },
          candidates: { items: [] },
          geometry: { pageRegion: { height: 10, width: 10, x: 0, y: 0 } },
          gestureId: 'gesture:old'
        },
        status: 'matched'
      }
    })
    await expect(
      prepareTraceEdit({ 'gesture-id': 'gesture:old', intent: 'Edit it' }, send)
    ).rejects.toThrow('no exact workspace or document tab')
  })
})
