import { WorkspaceDomainError, type WorkspacePropertyValue } from '@/app/workspace'

import { ConnectorRequestError } from './errors'
import type {
  ConnectorEvidenceContext,
  ConnectorEvidenceResult,
  ConnectorFailureCode,
  OpenPencilConnector
} from './types'

const API_VERSION = '2026-03-10'
const DEFAULT_BASE_URL = 'https://api.github.com/'
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_TIMEOUT_MS = 10_000
const READ_SCOPE = 'github:repository:read'
const RESOURCE_PATTERN = /^github:\/\/repos\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/

type Fetcher = (input: string, init: RequestInit) => Promise<Response>
type Sleeper = (durationMs: number) => Promise<void>

export type GitHubPublicRepositoryConnectorOptions = {
  baseUrl?: string
  fetcher?: Fetcher
  maxAttempts?: number
  sleep?: Sleeper
  timeoutMs?: number
}

type GitHubRepositoryResponse = {
  archived: boolean
  default_branch: string
  description: string | null
  forks_count: number
  full_name: string
  html_url: string
  language: string | null
  open_issues_count: number
  private: boolean
  pushed_at: string
  stargazers_count: number
  updated_at: string
  visibility: string
}

type RepositoryTarget = { owner: string; repository: string }

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

function repositoryTarget(resourceRef: string): RepositoryTarget {
  const match = RESOURCE_PATTERN.exec(resourceRef)
  const owner = match?.[1]
  const repository = match?.[2]
  if (!owner || !repository || repository.endsWith('.git')) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'GitHub repository evidence requires github://repos/{owner}/{repository}'
    )
  }
  return { owner, repository }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key]
  return typeof field === 'string' ? field : null
}

function nullableStringField(
  value: Record<string, unknown>,
  key: string
): string | null | undefined {
  const field = value[key]
  return field === null || typeof field === 'string' ? field : undefined
}

function numberField(value: Record<string, unknown>, key: string): number | null {
  const field = value[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : null
}

function repositoryResponse(value: unknown): GitHubRepositoryResponse | null {
  if (!isRecord(value)) return null
  const archived = value.archived
  const privateRepository = value.private
  const defaultBranch = stringField(value, 'default_branch')
  const description = nullableStringField(value, 'description')
  const forks = numberField(value, 'forks_count')
  const fullName = stringField(value, 'full_name')
  const htmlUrl = stringField(value, 'html_url')
  const language = nullableStringField(value, 'language')
  const openIssues = numberField(value, 'open_issues_count')
  const pushedAt = stringField(value, 'pushed_at')
  const stars = numberField(value, 'stargazers_count')
  const updatedAt = stringField(value, 'updated_at')
  const visibility = stringField(value, 'visibility')
  if (
    typeof archived !== 'boolean' ||
    typeof privateRepository !== 'boolean' ||
    !defaultBranch ||
    description === undefined ||
    forks === null ||
    !fullName ||
    !htmlUrl ||
    language === undefined ||
    openIssues === null ||
    !pushedAt ||
    stars === null ||
    !updatedAt ||
    !visibility
  ) {
    return null
  }
  return {
    archived,
    default_branch: defaultBranch,
    description,
    forks_count: forks,
    full_name: fullName,
    html_url: htmlUrl,
    language,
    open_issues_count: openIssues,
    private: privateRepository,
    pushed_at: pushedAt,
    stargazers_count: stars,
    updated_at: updatedAt,
    visibility
  }
}

function responseCode(response: Response): ConnectorFailureCode {
  if (response.status === 404) return 'not-found'
  if (response.status === 401) return 'permission-denied'
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  ) {
    return 'rate-limited'
  }
  if (response.status === 403) return 'permission-denied'
  return 'unavailable'
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 500 || status === 502 || status === 503 || status === 504
}

function retryAfterMs(response: Response): number | undefined {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter && Number.isFinite(Number(retryAfter))) return Number(retryAfter) * 1_000
  const reset = response.headers.get('x-ratelimit-reset')
  if (!reset || !Number.isFinite(Number(reset))) return undefined
  return Math.max(0, Number(reset) * 1_000 - Date.now())
}

function failureFromResponse(response: Response, attemptCount: number): ConnectorRequestError {
  const code = responseCode(response)
  return new ConnectorRequestError({
    attemptCount,
    code,
    message: `GitHub repository request failed with status ${response.status}`,
    providerRequestId: response.headers.get('x-github-request-id') ?? undefined,
    responseStatus: response.status,
    retryAfterMs: code === 'rate-limited' ? retryAfterMs(response) : undefined
  })
}

function endpoint(baseUrl: string, target: RepositoryTarget): string {
  const base = new URL(baseUrl)
  if (base.protocol !== 'https:') {
    throw new WorkspaceDomainError('validation_failed', 'GitHub connector base URL must use HTTPS')
  }
  return new URL(
    `repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}`,
    base
  ).toString()
}

function facts(repository: GitHubRepositoryResponse): Record<string, WorkspacePropertyValue> {
  return {
    archived: repository.archived,
    defaultBranch: repository.default_branch,
    description: repository.description,
    forks: repository.forks_count,
    fullName: repository.full_name,
    htmlUrl: repository.html_url,
    language: repository.language,
    openIssues: repository.open_issues_count,
    pushedAt: repository.pushed_at,
    stars: repository.stargazers_count,
    updatedAt: repository.updated_at,
    visibility: repository.visibility
  }
}

function staleAt(now: string): string | undefined {
  const instant = Date.parse(now)
  return Number.isFinite(instant) ? new Date(instant + 5 * 60_000).toISOString() : undefined
}

class GitHubPublicRepositoryConnector implements OpenPencilConnector {
  readonly descriptor = {
    actionReadbackScopes: [],
    actionWriteScopes: [],
    capabilities: {
      actionReadback: false,
      actionWrite: false,
      evidenceRead: true,
      networkAccess: true
    },
    evidenceReadScopes: [READ_SCOPE],
    id: 'github-public-repository',
    name: 'GitHub public repository'
  }

  private readonly baseUrl: string
  private readonly fetcher: Fetcher
  private readonly maxAttempts: number
  private readonly sleep: Sleeper
  private readonly timeoutMs: number

  constructor(options: GitHubPublicRepositoryConnectorOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    this.sleep = options.sleep ?? delay
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 5) {
      throw new WorkspaceDomainError('validation_failed', 'GitHub maxAttempts must be from 1 to 5')
    }
  }

  async readEvidence(context: ConnectorEvidenceContext): Promise<ConnectorEvidenceResult> {
    if (!context.grantedScopes.includes(READ_SCOPE)) {
      throw new WorkspaceDomainError('permission_denied', `missing ${READ_SCOPE}`)
    }
    const target = repositoryTarget(context.request.resourceRef)
    const url = endpoint(this.baseUrl, target)
    let lastFailure: ConnectorRequestError | undefined
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const response = await this.fetcher(url, {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': API_VERSION
          },
          redirect: 'follow',
          signal: controller.signal
        })
        if (!response.ok) {
          const failure = failureFromResponse(response, attempt)
          if (!retryableStatus(response.status) || attempt === this.maxAttempts) throw failure
          lastFailure = failure
          await this.sleep(250 * 2 ** (attempt - 1))
          continue
        }
        const repository = repositoryResponse(await response.json())
        if (!repository || repository.private) {
          throw new ConnectorRequestError({
            attemptCount: attempt,
            code: 'invalid-response',
            message: 'GitHub returned an invalid or non-public repository response',
            providerRequestId: response.headers.get('x-github-request-id') ?? undefined,
            responseStatus: response.status
          })
        }
        return {
          facts: facts(repository),
          freshness: 'current',
          observedAt: context.now,
          sourceRef: context.request.resourceRef,
          staleAt: staleAt(context.now),
          summary: `${repository.full_name} is a public GitHub repository on ${repository.default_branch} with ${repository.open_issues_count} open issues.`,
          title: `GitHub repository ${repository.full_name}`,
          transport: {
            attemptCount: attempt,
            etag: response.headers.get('etag') ?? undefined,
            providerRequestId: response.headers.get('x-github-request-id') ?? undefined,
            responseStatus: response.status
          },
          truthScope: 'live'
        }
      } catch (error) {
        if (error instanceof ConnectorRequestError) throw error
        const timedOut = error instanceof DOMException && error.name === 'AbortError'
        lastFailure = new ConnectorRequestError({
          attemptCount: attempt,
          code: timedOut ? 'timeout' : 'network',
          message: timedOut
            ? 'GitHub repository request timed out'
            : 'GitHub network request failed'
        })
        if (attempt === this.maxAttempts) throw lastFailure
        await this.sleep(250 * 2 ** (attempt - 1))
      } finally {
        clearTimeout(timeout)
      }
    }
    throw (
      lastFailure ??
      new ConnectorRequestError({
        attemptCount: this.maxAttempts,
        code: 'unavailable',
        message: 'GitHub repository request was unavailable'
      })
    )
  }
}

export function createGitHubPublicRepositoryConnector(
  options: GitHubPublicRepositoryConnectorOptions = {}
): OpenPencilConnector {
  return new GitHubPublicRepositoryConnector(options)
}

export const GITHUB_PUBLIC_REPOSITORY_READ_SCOPE = READ_SCOPE
