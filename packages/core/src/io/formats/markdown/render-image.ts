import type { Tokens } from 'marked'

import type { Fill } from '@open-pencil/scene-graph'
import { computeImageHash } from '@open-pencil/scene-graph/images'

import { colorToFill } from '#core/color'
import { TRANSPARENT } from '#core/constants'

import { resolveMarkdownImage } from './image'
import {
  BORDER_COLOR,
  createTextNode,
  createVerticalFrame,
  markdownData,
  type MarkdownRenderContext,
  MUTED_COLOR,
  solidStroke,
  SUBTLE_SURFACE_COLOR
} from './scene'

export async function renderMarkdownImage(
  context: MarkdownRenderContext,
  parentId: string,
  image: Tokens.Image,
  raw: string,
  width: number
): Promise<void> {
  const resolution = await resolveMarkdownImage(image.href, context.resolveImage)
  const frame = createVerticalFrame(context.graph, parentId, image.text || 'Linked image', width, {
    itemSpacing: 8,
    paddingTop: 20,
    paddingRight: 20,
    paddingBottom: 20,
    paddingLeft: 20,
    fills: [colorToFill(SUBTLE_SURFACE_COLOR)],
    strokes: [solidStroke(BORDER_COLOR)],
    cornerRadius: 10,
    pluginData: markdownData('image', raw, {
      href: image.href,
      title: image.title ?? undefined,
      error: resolution.error,
      mimeType: resolution.asset?.mimeType
    })
  })
  if (resolution.asset) {
    const hash = computeImageHash(resolution.asset.data)
    context.graph.images.set(hash, resolution.asset.data)
    const availableWidth = width - 40
    const ratio =
      resolution.asset.width && resolution.asset.height
        ? resolution.asset.height / resolution.asset.width
        : 9 / 16
    const imageHeight = Math.min(420, Math.max(120, availableWidth * ratio))
    const fill: Fill = {
      type: 'IMAGE',
      imageHash: hash,
      imageScaleMode: 'FIT',
      color: TRANSPARENT,
      opacity: 1,
      visible: true
    }
    context.graph.createNode('RECTANGLE', frame.id, {
      name: image.text || 'Markdown image',
      width: availableWidth,
      height: imageHeight,
      fills: [fill],
      cornerRadius: 6,
      layoutAlignSelf: 'STRETCH'
    })
  }
  createTextNode(context.graph, frame.id, image.text || 'Linked image', {
    name: 'Image description',
    width: width - 40,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 21
  })
  createTextNode(
    context.graph,
    frame.id,
    image.href.startsWith('data:') ? 'Embedded data image' : image.href,
    {
      name: 'Image source',
      width: width - 40,
      fontSize: 12,
      lineHeight: 18,
      color: MUTED_COLOR
    }
  )
  if (resolution.error) {
    createTextNode(context.graph, frame.id, resolution.error, {
      name: 'Image status',
      width: width - 40,
      fontSize: 12,
      lineHeight: 18,
      color: MUTED_COLOR
    })
  }
}
