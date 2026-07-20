import { createGitHubPublicRepositoryConnector } from './github-public-repository'
import { ConnectorRegistry } from './registry'

export function createDefaultConnectorRegistry(): ConnectorRegistry {
  return new ConnectorRegistry([createGitHubPublicRepositoryConnector()])
}
