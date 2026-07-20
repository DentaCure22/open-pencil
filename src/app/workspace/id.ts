import type { WorkspaceObjectType } from './types'

export type WorkspaceIdPrefix = WorkspaceObjectType | 'workspace' | 'view' | 'relation' | 'mutation'

type SecureCrypto = Pick<Crypto, 'getRandomValues' | 'randomUUID'>

function isSecureCrypto(value: unknown): value is SecureCrypto {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getRandomValues' in value &&
    typeof value.getRandomValues === 'function' &&
    'randomUUID' in value &&
    typeof value.randomUUID === 'function'
  )
}

function requireCrypto(): SecureCrypto {
  const cryptoApi: unknown = Reflect.get(globalThis, 'crypto')
  if (!isSecureCrypto(cryptoApi)) {
    throw new TypeError('secure_crypto_unavailable: OpenPencil workspace IDs require Web Crypto.')
  }
  return cryptoApi
}

export function createWorkspaceId(prefix: WorkspaceIdPrefix): string {
  const cryptoApi = requireCrypto()
  return `${prefix}_${cryptoApi.randomUUID()}`
}
