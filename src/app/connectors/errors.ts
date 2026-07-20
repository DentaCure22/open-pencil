import type { ConnectorFailureCode } from './types'

export type ConnectorRequestErrorInput = {
  attemptCount: number
  code: ConnectorFailureCode
  message: string
  providerRequestId?: string
  responseStatus?: number
  retryAfterMs?: number
}

export class ConnectorRequestError extends Error {
  readonly attemptCount: number
  readonly code: ConnectorFailureCode
  readonly providerRequestId?: string
  readonly responseStatus?: number
  readonly retryAfterMs?: number

  constructor(input: ConnectorRequestErrorInput) {
    super(input.message)
    this.name = 'ConnectorRequestError'
    this.attemptCount = input.attemptCount
    this.code = input.code
    this.providerRequestId = input.providerRequestId
    this.responseStatus = input.responseStatus
    this.retryAfterMs = input.retryAfterMs
  }
}
