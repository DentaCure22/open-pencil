import { describe, expect, test } from 'bun:test'

import { traceRpcArgs, traceRpcCommand } from '#cli/commands/trace'

describe('Trace CLI query arguments', () => {
  test('maps exact and latest gesture selectors without lexical fallback', () => {
    expect(traceRpcCommand({ 'latest-gesture': true })).toBe('trace_get_gesture')
    expect(traceRpcArgs({ 'latest-gesture': true })).toEqual({
      gesture_id: undefined,
      include_image: false,
      latest: true
    })
    expect(traceRpcArgs({ 'gesture-id': 'gesture:1', 'include-image': true })).toEqual({
      gesture_id: 'gesture:1',
      include_image: true,
      latest: undefined
    })
  })

  test('maps the latest spoken turn without caller-supplied Board identity', () => {
    expect(traceRpcArgs({ 'latest-spoken-turn': true })).toEqual({
      latest_spoken_turn: true,
      limit: undefined,
      query: undefined,
      since: undefined,
      spoken_text: undefined,
      spoken_turn_id: undefined,
      task_cursor: undefined,
      until: undefined
    })
  })

  test('maps a bounded ranked query', () => {
    expect(
      traceRpcArgs({
        limit: '3',
        query: 'selected chart'
      })
    ).toMatchObject({
      limit: 3,
      query: 'selected chart'
    })
  })

  test('rejects ambiguous selectors and spoken time-range fallback', () => {
    expect(() => traceRpcArgs({ query: 'chart', 'task-cursor': 'cursor' })).toThrow(
      'Choose exactly one'
    )
    expect(() =>
      traceRpcArgs({
        'latest-spoken-turn': true,
        since: '2026-07-26T00:00:00.000Z'
      })
    ).toThrow('cannot be combined')
  })
})
