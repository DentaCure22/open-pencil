import type { BoardExperienceDefinition } from './contracts'
import { TOWER_DEFENSE_EXPERIENCE } from './tower-defense/definition'

const DEFINITIONS: BoardExperienceDefinition[] = [TOWER_DEFENSE_EXPERIENCE]

export function boardExperienceDefinition(id: string): BoardExperienceDefinition | null {
  return id === TOWER_DEFENSE_EXPERIENCE.id ? TOWER_DEFENSE_EXPERIENCE : null
}

export function boardExperienceDefinitionsForQuery(query: string): BoardExperienceDefinition[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return DEFINITIONS
  return DEFINITIONS.filter((definition) =>
    `${definition.label} ${definition.description}`.toLowerCase().includes(normalized)
  )
}
