import { mediaIntakeKind, type MediaIntakeKind } from '@/app/media-evidence/source'

import { boardFileIntakeRegistry, type BoardFileIntakeRegistry } from './registry'

export type BoardFileClassification =
  | { kind: 'media'; mediaKind: MediaIntakeKind }
  | { adapterId: string; kind: 'specialized' }
  | { kind: 'source-object'; reason: 'no-board-adapter' }

export function classifyBoardFile(
  file: Pick<File, 'name' | 'size' | 'type'>,
  registry: BoardFileIntakeRegistry = boardFileIntakeRegistry
): BoardFileClassification {
  const adapter = registry.find(file)
  if (adapter) return { adapterId: adapter.id, kind: 'specialized' }
  const mediaKind = mediaIntakeKind(file)
  return mediaKind
    ? { kind: 'media', mediaKind }
    : { kind: 'source-object', reason: 'no-board-adapter' }
}
