import type { EditorStore } from '@/app/editor/active-store'

import type { BoardAuthorityGrant } from './contracts'
import { revokeBoardAuthorityGrant } from './grants'
import { removeOwnedTransientBoardComponents } from './transient-components'

export function disposeBoardAuthorityGrant(
  store: EditorStore,
  grant: BoardAuthorityGrant
): string[] {
  const removedComponentIds = removeOwnedTransientBoardComponents(store, grant)
  revokeBoardAuthorityGrant(store, grant)
  return removedComponentIds
}
