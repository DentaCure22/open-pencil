import { describe, expect, test } from 'bun:test'

import { campaignBoardRequestId } from '../src/request-identity'
import { target } from '../src/testing/campaign-support'

describe('campaign Board request identity', () => {
  test('is stable for the same run and exact target', () => {
    const exactTarget = target('page-A')
    const first = campaignBoardRequestId('run-1', exactTarget)

    expect(campaignBoardRequestId('run-1', structuredClone(exactTarget))).toBe(first)
    expect(first).toMatch(/^ptb-run:[a-f0-9]{32}$/u)
  })

  test('changes with the run or any exact-target identity field', () => {
    const exactTarget = target('page-A')
    const baseline = campaignBoardRequestId('run-1', exactTarget)
    const candidates = [
      campaignBoardRequestId('run-2', exactTarget),
      campaignBoardRequestId('run-1', { ...exactTarget, runtime_instance_id: 'runtime-2' }),
      campaignBoardRequestId('run-1', { ...exactTarget, workspace_id: 'workspace-2' }),
      campaignBoardRequestId('run-1', { ...exactTarget, document_id: 'document-2' }),
      campaignBoardRequestId('run-1', {
        ...exactTarget,
        content_document_id: 'content-document-2'
      }),
      campaignBoardRequestId('run-1', { ...exactTarget, page_id: 'page-B' })
    ]

    expect(new Set([baseline, ...candidates]).size).toBe(candidates.length + 1)
  })

  test('allocates distinct IDs for a parallel run and Board matrix', () => {
    const requestIds = Array.from({ length: 8 }, (_, runIndex) =>
      Array.from({ length: 8 }, (_, pageIndex) =>
        campaignBoardRequestId(
          `parallel-run-${String(runIndex)}`,
          target(`page-${String(pageIndex)}`)
        )
      )
    ).flat()

    expect(new Set(requestIds).size).toBe(requestIds.length)
  })

  test('rejects malformed request scopes before hashing', () => {
    expect(() => campaignBoardRequestId(undefined as unknown as string, target('page-A'))).toThrow(
      'request scope run_id must be path-safe'
    )
    expect(() => campaignBoardRequestId('', target('page-A'))).toThrow(
      'request scope run_id must be path-safe'
    )
    expect(() => campaignBoardRequestId(' run-1', target('page-A'))).toThrow(
      'request scope run_id must be path-safe'
    )
    expect(() =>
      campaignBoardRequestId('run-1', { ...target('page-A'), page_id: ' page-A' })
    ).toThrow('target page_id must not contain surrounding whitespace')
    expect(() =>
      campaignBoardRequestId('run-1', { ...target('page-A'), workspace_id: ' ' })
    ).toThrow('Eval target workspace_id must be a string')
  })
})
