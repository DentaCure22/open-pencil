import type { BoardBuildExtension, BoardBuildInput } from './types'
import { BOARD_BUILD_CONTRACT } from './types'

function extensionResult(extension: BoardBuildExtension | undefined) {
  return extension
    ? {
        authority: 'none',
        contract: extension.contract,
        durability: 'response_only',
        ...(extension.outputDigest ? { output_digest: extension.outputDigest } : {}),
        ...(extension.profileId ? { profile_id: extension.profileId } : {}),
        skill_id: extension.skillId,
        used: true,
        ...(extension.skillVersion ? { skill_version: extension.skillVersion } : {})
      }
    : { authority: 'none', durability: 'not_applicable', used: false }
}

export function buildMetadata(input: BoardBuildInput, route: string, owner: string) {
  return {
    contract: BOARD_BUILD_CONTRACT,
    extension: extensionResult(input.extension),
    intent: input.intent,
    recipe_kind: input.recipe?.kind ?? 'plan',
    route: { id: route, semantic_owner: owner }
  }
}
