import { htmlBoardRegisteredComponentById } from './components'

import type { HtmlBoardRevisionRef, HtmlBoardSourceBinding } from './workspace'

const SOURCE_ATTRIBUTE = {
  filePath: 'data-openpencil-source-file',
  repository: 'data-openpencil-source-repository',
  route: 'data-openpencil-source-route',
  selector: 'data-openpencil-source-selector',
  symbol: 'data-openpencil-source-symbol',
  verification: 'data-openpencil-source-verification'
} as const

function attributeValue(openingTag: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = openingTag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return (match?.[2] ?? '').replaceAll('&amp;', '&')
}

function sourceIdentity(binding: HtmlBoardSourceBinding): string {
  return [
    binding.repository,
    binding.filePath,
    binding.symbol,
    binding.route,
    binding.selector
  ].join('\n')
}

/**
 * Derive repository evidence only from a component that exactly matches a
 * built-in registry descriptor. A user-authored source attribute by itself is
 * never enough to become repository-verified.
 */
export function repositoryVerifiedHtmlBoardComponentSources(
  html: string,
  attachedTo: HtmlBoardRevisionRef
): HtmlBoardSourceBinding[] {
  const bindings: HtmlBoardSourceBinding[] = []
  const seen = new Set<string>()
  const candidates = html.match(/<[A-Za-z][\w:-]*(?:\s[^<>]*?)?>/g) ?? []

  for (const openingTag of candidates) {
    const registryId = attributeValue(openingTag, 'data-openpencil-registry-id')
    const instanceId = attributeValue(openingTag, 'data-openpencil-component-id')
    const componentName = attributeValue(openingTag, 'data-openpencil-component')
    const component = htmlBoardRegisteredComponentById(registryId)
    const source = component?.source
    if (!component || !source || !instanceId || componentName !== component.componentName) continue
    if (
      attributeValue(openingTag, SOURCE_ATTRIBUTE.repository) !== source.repository ||
      attributeValue(openingTag, SOURCE_ATTRIBUTE.filePath) !== source.filePath ||
      attributeValue(openingTag, SOURCE_ATTRIBUTE.symbol) !== source.symbol ||
      attributeValue(openingTag, SOURCE_ATTRIBUTE.route) !== source.route ||
      attributeValue(openingTag, SOURCE_ATTRIBUTE.selector) !== source.selector ||
      attributeValue(openingTag, SOURCE_ATTRIBUTE.verification) !== source.verification
    ) {
      continue
    }

    const binding: HtmlBoardSourceBinding = {
      attachedTo,
      filePath: source.filePath,
      id: `source-${attachedTo.boardId}-r${attachedTo.revision}-${registryId}-${instanceId}`,
      kind: 'component',
      repository: source.repository,
      route: source.route,
      selector: source.selector,
      symbol: source.symbol,
      verification: source.verification
    }
    const identity = sourceIdentity(binding)
    if (seen.has(identity)) continue
    seen.add(identity)
    bindings.push(binding)
  }

  return bindings
}

export function mergedHtmlBoardSourceBindings(
  existing: HtmlBoardSourceBinding[],
  verified: HtmlBoardSourceBinding[]
): HtmlBoardSourceBinding[] {
  const next = [...existing]
  for (const binding of verified) {
    const identity = sourceIdentity(binding)
    const existingIndex = next.findIndex(
      (candidate) =>
        candidate.attachedTo.boardId === binding.attachedTo.boardId &&
        candidate.attachedTo.revision === binding.attachedTo.revision &&
        candidate.attachedTo.schemaVersion === binding.attachedTo.schemaVersion &&
        sourceIdentity(candidate) === identity
    )
    if (existingIndex === -1) next.push(binding)
    else next.splice(existingIndex, 1, binding)
  }
  return next
}
