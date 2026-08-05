import { isObjectGraphConnectionNode, type SceneNode } from '@open-pencil/scene-graph'

import { buildFigmaClipboardHTML, buildOpenPencilClipboardHTML } from '#core/clipboard'
import type { EditorContext } from '#core/editor/types'

export function createClipboardCopyActions(ctx: EditorContext) {
  async function writeCopyData(clipboardData: DataTransfer, selectedNodes: SceneNode[]) {
    const copyableNodes = selectedNodes.filter((node) => !isObjectGraphConnectionNode(node))
    if (copyableNodes.length === 0) return

    const names = copyableNodes.map((node) => node.name).join('\n')
    clipboardData.setData('text/html', buildOpenPencilClipboardHTML(copyableNodes, ctx.graph))
    clipboardData.setData('text/plain', names)

    const html = await buildFigmaClipboardHTML(copyableNodes, ctx.graph)
    if (html) clipboardData.setData('text/html', html)
  }

  return { writeCopyData }
}
