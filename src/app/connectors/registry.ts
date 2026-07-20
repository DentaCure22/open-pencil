import { WorkspaceDomainError } from '@/app/workspace'

import type { OpenPencilConnector } from './types'

export class ConnectorRegistry {
  private readonly connectors = new Map<string, OpenPencilConnector>()

  constructor(connectors: OpenPencilConnector[] = []) {
    connectors.forEach((connector) => this.register(connector))
  }

  get(id: string): OpenPencilConnector | undefined {
    return this.connectors.get(id)
  }

  list(): OpenPencilConnector[] {
    return [...this.connectors.values()]
  }

  register(connector: OpenPencilConnector): void {
    if (!connector.descriptor.id || this.connectors.has(connector.descriptor.id)) {
      throw new WorkspaceDomainError(
        'duplicate_id',
        `connector ${connector.descriptor.id || '(missing id)'}`
      )
    }
    this.connectors.set(connector.descriptor.id, connector)
  }

  require(id: string): OpenPencilConnector {
    const connector = this.connectors.get(id)
    if (!connector) throw new WorkspaceDomainError('not_found', `connector ${id}`)
    return connector
  }
}
