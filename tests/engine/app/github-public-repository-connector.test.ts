import { describe, expect, test } from 'bun:test'

import {
  ConnectorRegistry,
  ConnectorRequestError,
  createGitHubPublicRepositoryConnector,
  GITHUB_PUBLIC_REPOSITORY_READ_SCOPE
} from '@/app/connectors'
import { collectEvidenceWithConnectors } from '@/app/evidence-intake'

const NOW = '2026-07-14T20:00:00.000Z'
const RESOURCE_REF = 'github://repos/openai/openai-node'

const repositoryPayload = {
  archived: false,
  default_branch: 'master',
  description: 'The official JavaScript library for the OpenAI API',
  forks_count: 123,
  full_name: 'openai/openai-node',
  html_url: 'https://github.com/openai/openai-node',
  language: 'TypeScript',
  open_issues_count: 42,
  private: false,
  pushed_at: '2026-07-14T18:00:00Z',
  stargazers_count: 9_999,
  updated_at: '2026-07-14T19:00:00Z',
  visibility: 'public'
}

function response(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      etag: 'W/"repo-v1"',
      'x-github-request-id': `request-${status}`
    },
    status
  })
}

function context(grantedScopes: string[] = [GITHUB_PUBLIC_REPOSITORY_READ_SCOPE]) {
  return {
    grantedScopes,
    now: NOW,
    request: {
      connectorId: 'github-public-repository',
      id: 'github-repository',
      resourceRef: RESOURCE_REF
    }
  }
}

describe('GitHub public repository connector', () => {
  test('reads one bounded public repository with exact transport evidence', async () => {
    const requests: Array<{ init: RequestInit; url: string }> = []
    const connector = createGitHubPublicRepositoryConnector({
      fetcher: async (url, init) => {
        requests.push({ init, url })
        return response(200, repositoryPayload)
      }
    })

    const result = await connector.readEvidence?.(context())

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://api.github.com/repos/openai/openai-node')
    expect(new Headers(requests[0]?.init.headers).get('X-GitHub-Api-Version')).toBe('2026-03-10')
    expect(result).toMatchObject({
      facts: {
        defaultBranch: 'master',
        fullName: 'openai/openai-node',
        openIssues: 42,
        visibility: 'public'
      },
      freshness: 'current',
      sourceRef: RESOURCE_REF,
      staleAt: '2026-07-14T20:05:00.000Z',
      transport: {
        attemptCount: 1,
        etag: 'W/"repo-v1"',
        providerRequestId: 'request-200',
        responseStatus: 200
      },
      truthScope: 'live'
    })
  })

  test('retries transient provider failures with bounded exponential delay', async () => {
    const responses = [response(503), response(502), response(200, repositoryPayload)]
    const delays: number[] = []
    const connector = createGitHubPublicRepositoryConnector({
      fetcher: async () => responses.shift() ?? response(503),
      sleep: async (durationMs) => {
        delays.push(durationMs)
      }
    })

    const result = await connector.readEvidence?.(context())

    expect(delays).toEqual([250, 500])
    expect(result?.transport?.attemptCount).toBe(3)
    expect(result?.truthScope).toBe('live')
  })

  test('records scope denial and exhausted outage attempts without invented evidence', async () => {
    let calls = 0
    const connector = createGitHubPublicRepositoryConnector({
      fetcher: async () => {
        calls += 1
        throw new Error('offline')
      },
      sleep: async () => undefined
    })
    const registry = new ConnectorRegistry([connector])
    const base = {
      collectionId: 'real-github-connector',
      connectorRegistry: registry,
      connectorRequests: [context().request],
      now: NOW,
      requests: []
    }

    const denied = await collectEvidenceWithConnectors({
      ...base,
      grant: { actorId: 'test-owner', issuedAt: NOW, scopes: [] }
    })
    expect(calls).toBe(0)
    expect(denied.items[0]?.access).toBe('redacted')
    expect(denied.receipt.providerRuns[0]).toMatchObject({
      attemptCount: 0,
      errorCode: 'scope-denied',
      status: 'redacted'
    })

    const unavailable = await collectEvidenceWithConnectors({
      ...base,
      grant: {
        actorId: 'test-owner',
        issuedAt: NOW,
        scopes: [GITHUB_PUBLIC_REPOSITORY_READ_SCOPE]
      }
    })
    expect(calls).toBe(3)
    expect(unavailable.items[0]).toMatchObject({
      access: 'redacted',
      facts: {},
      summary: ''
    })
    expect(unavailable.receipt.providerRuns[0]).toMatchObject({
      attemptCount: 3,
      errorCode: 'network',
      status: 'unavailable'
    })
  })

  test('does not retry a not-found response', async () => {
    let calls = 0
    const connector = createGitHubPublicRepositoryConnector({
      fetcher: async () => {
        calls += 1
        return response(404)
      },
      sleep: async () => undefined
    })

    try {
      await connector.readEvidence?.(context())
      throw new Error('not-found request should fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectorRequestError)
      expect(error).toMatchObject({ attemptCount: 1, code: 'not-found', responseStatus: 404 })
    }
    expect(calls).toBe(1)
  })

  const liveTest = process.env.OPENPENCIL_LIVE_GITHUB === '1' ? test : test.skip
  liveTest('reads live public metadata from the real GitHub REST API', async () => {
    const connector = createGitHubPublicRepositoryConnector()
    const result = await connector.readEvidence?.(context())

    expect(result).toMatchObject({
      facts: { fullName: 'openai/openai-node', visibility: 'public' },
      freshness: 'current',
      sourceRef: RESOURCE_REF,
      truthScope: 'live'
    })
    expect(result?.transport?.providerRequestId).toBeTruthy()
    expect(result?.transport?.responseStatus).toBe(200)
  })
})
