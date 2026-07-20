import type { SceneNode } from '@open-pencil/scene-graph'

import type { DtcgDocument, TokenReview, TokenSnapshot } from '#core/io/tokens'

export const OPENPENCIL_LIBRARY_FORMAT = 'openpencil/library/v1'
export const OPENPENCIL_LIBRARY_PLUGIN_ID = 'openpencil-library'

export type LibrarySceneNode = Omit<SceneNode, 'id' | 'parentId' | 'childIds' | 'textPicture'> & {
  sourceId: string
  textPicture: string | null
  children: LibrarySceneNode[]
}

export interface LibraryComponent {
  publishId: string
  name: string
  version: string
  signature: string
  node: LibrarySceneNode
}

export interface OpenPencilLibrary {
  format: typeof OPENPENCIL_LIBRARY_FORMAT
  library: {
    key: string
    name: string
    version: string
    publishedAt: string
  }
  components: LibraryComponent[]
  tokens: DtcgDocument
  images: Record<string, string>
}

export interface DesignLibraryReviewCount {
  added: number
  updated: number
  unchanged: number
  removed: number
}

export interface DesignLibraryReview {
  components: DesignLibraryReviewCount
  tokens: TokenReview
  tokenSnapshot: TokenSnapshot
  warnings: string[]
}
