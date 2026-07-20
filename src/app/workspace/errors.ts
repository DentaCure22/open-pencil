export type WorkspaceDomainErrorCode =
  | 'archive_conflict'
  | 'duplicate_id'
  | 'idempotency_conflict'
  | 'invalid_operation'
  | 'not_found'
  | 'permission_denied'
  | 'reconstruction_conflict'
  | 'revision_conflict'
  | 'scope_conflict'
  | 'validation_failed'

export class WorkspaceDomainError extends Error {
  readonly code: WorkspaceDomainErrorCode

  constructor(code: WorkspaceDomainErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.code = code
    this.name = 'WorkspaceDomainError'
  }
}
