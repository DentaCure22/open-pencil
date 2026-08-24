import { describe, expect, test } from 'bun:test'

import {
  CODE_OBJECT_LIVE_RUNTIME_CAP,
  reconcileLiveRuntimeResidency,
  sameStringSet
} from '@/app/code-object/runtime-residency'

describe('Code Object live runtime residency', () => {
  test('keeps pinned frames plus the most recently used viewport frames', () => {
    const resident = reconcileLiveRuntimeResidency({
      cap: CODE_OBJECT_LIVE_RUNTIME_CAP,
      frameIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      interactedAtByFrame: {
        a: 10,
        b: 40,
        c: 30,
        d: 20,
        e: 5
      },
      pinnedFrameIds: ['g'],
      residentFrameIds: new Set(['a', 'b', 'c', 'd'])
    })

    expect(CODE_OBJECT_LIVE_RUNTIME_CAP).toBe(6)
    expect([...resident]).toEqual(['g', 'b', 'c', 'd', 'a', 'e'])
  })

  test('never evicts pinned frames even when they exceed the cap', () => {
    const resident = reconcileLiveRuntimeResidency({
      cap: 2,
      frameIds: ['a', 'b', 'c', 'd'],
      interactedAtByFrame: {},
      pinnedFrameIds: ['a', 'b', 'c'],
      residentFrameIds: new Set()
    })

    expect([...resident]).toEqual(['a', 'b', 'c'])
  })

  test('prefers current residents when interaction order is empty', () => {
    const resident = reconcileLiveRuntimeResidency({
      cap: 4,
      frameIds: ['a', 'b', 'c', 'd', 'e'],
      interactedAtByFrame: {},
      pinnedFrameIds: [],
      residentFrameIds: new Set(['b', 'c'])
    })

    expect([...resident]).toEqual(['b', 'c', 'a', 'd'])
  })

  test('treats equal membership as the same resident set', () => {
    expect(sameStringSet(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
    expect(sameStringSet(new Set(['a']), new Set(['a', 'b']))).toBe(false)
  })
})
