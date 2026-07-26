import { parseColor } from '@open-pencil/core/color'
import { DEFAULT_FONT_FAMILY } from '@open-pencil/core/constants'
import type { Editor } from '@open-pencil/core/editor'
import {
  CONTENT_SOURCE_REVISION,
  contentSourcePluginData,
  parsePptx,
  readContentSource,
  type PptxElement,
  type PptxSlide
} from '@open-pencil/core/io'
import type { Fill, SceneNode, Stroke } from '@open-pencil/scene-graph'
import {
  assetHashFromReference,
  assetReference,
  computeImageHash
} from '@open-pencil/scene-graph/images'

import { codeObjectPluginData, createPptxDeckDocument } from '@/app/code-object/model'

import { pptxDeckPluginData } from './source'

const NATIVE_SLIDE_GAP = 48
const NATIVE_DECK_GAP = 120
const DECK_CASCADE = 36
const PPTX_DECK_WIDTH = 1180

type CreatedDeck = {
  assetHash: string
  bytes: Uint8Array
  root: SceneNode
  snapshots: SceneNode[]
}

function solidFill(color: string | null): Fill[] {
  if (!color) return []
  const parsed = parseColor(color)
  return [
    {
      color: parsed,
      opacity: parsed.a,
      type: 'SOLID',
      visible: parsed.a > 0
    }
  ]
}

function solidStroke(color: string | null, width: number): Stroke[] {
  if (!color || width <= 0) return []
  const parsed = parseColor(color)
  return [
    {
      align: 'INSIDE',
      cap: 'NONE',
      color: parsed,
      dashPattern: [],
      join: 'MITER',
      opacity: parsed.a,
      visible: parsed.a > 0,
      weight: width
    }
  ]
}

function sceneNodeType(element: Extract<PptxElement, { kind: 'shape' }>): SceneNode['type'] {
  if (element.shape === 'ellipse') return 'ELLIPSE'
  if (element.shape === 'line') return 'LINE'
  return 'RECTANGLE'
}

function addElement(editor: Editor, parentId: string, element: PptxElement): SceneNode[] {
  if (element.kind === 'shape') {
    return [
      editor.graph.createNode(sceneNodeType(element), parentId, {
        cornerRadius: element.cornerRadius,
        fills: element.shape === 'line' ? [] : solidFill(element.fillColor),
        height: element.height,
        name: element.name,
        strokes: solidStroke(element.strokeColor, element.strokeWidth),
        width: element.width,
        x: element.x,
        y: element.y
      })
    ]
  }

  const nodes: SceneNode[] = []
  if (element.backgroundColor) {
    nodes.push(
      editor.graph.createNode('RECTANGLE', parentId, {
        fills: solidFill(element.backgroundColor),
        height: element.height,
        name: `${element.name} background`,
        width: element.width,
        x: element.x,
        y: element.y
      })
    )
  }
  nodes.push(
    editor.graph.createNode('TEXT', parentId, {
      fills: solidFill(element.color),
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: element.fontSize,
      fontWeight: element.fontWeight,
      height: element.height,
      lineHeight: element.fontSize * 1.15,
      name: element.name,
      pluginData: [
        {
          key: 'source-font-family',
          pluginId: 'open-pencil-pptx',
          value: element.fontFamily
        }
      ],
      text: element.text,
      textAlignHorizontal: element.textAlign,
      textAlignVertical: element.verticalAlign,
      textAutoResize: 'NONE',
      width: element.width,
      x: element.x,
      y: element.y
    })
  )
  return nodes
}

function addSlide(
  editor: Editor,
  parentId: string,
  slide: PptxSlide,
  width: number,
  height: number,
  index: number
): SceneNode[] {
  const frame = editor.graph.createNode('FRAME', parentId, {
    clipsContent: true,
    fills: solidFill(slide.backgroundColor),
    height,
    name: slide.name,
    width,
    x: index * (width + NATIVE_SLIDE_GAP),
    y: 0
  })
  return [frame, ...slide.elements.flatMap((element) => addElement(editor, frame.id, element))]
}

function assetIsReferenced(editor: Editor, hash: string): boolean {
  for (const node of editor.graph.getAllNodes()) {
    const source = readContentSource(node)
    if (source && assetHashFromReference(source.source) === hash) return true
    if (node.fills.some((fill) => fill.imageHash === hash)) return true
  }
  return false
}

function restoreSnapshots(editor: Editor, snapshots: SceneNode[]) {
  for (const snapshot of snapshots) {
    editor.graph.createNodeWithId(
      snapshot.id,
      snapshot.type,
      snapshot.parentId ?? editor.state.currentPageId,
      { ...structuredClone(snapshot), childIds: [] }
    )
  }
}

async function createDeck(
  editor: Editor,
  file: File,
  cx: number,
  cy: number,
  offset: number
): Promise<CreatedDeck> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const deck = parsePptx(bytes)
  const deckHeight = Math.round(PPTX_DECK_WIDTH * (deck.height / deck.width))
  const assetHash = computeImageHash(bytes)
  const fileName = file.name.trim() || 'Untitled presentation.pptx'
  const root = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    clipsContent: true,
    fills: [],
    height: deckHeight,
    name: fileName.replace(/\.pptx$/i, '') || fileName,
    pluginData: [
      ...pptxDeckPluginData(deck.slides.length),
      ...contentSourcePluginData({
        fileName,
        format: 'pptx',
        mimeType:
          file.type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        revision: CONTENT_SOURCE_REVISION,
        source: assetReference(assetHash)
      })
    ],
    width: PPTX_DECK_WIDTH,
    x: cx - PPTX_DECK_WIDTH / 2 + offset * DECK_CASCADE,
    y: cy - deckHeight / 2 + offset * DECK_CASCADE
  })
  editor.graph.updateNode(root.id, {
    pluginData: codeObjectPluginData(root, createPptxDeckDocument())
  })
  editor.graph.images.set(assetHash, bytes)
  const persistedRoot = editor.graph.getNode(root.id) ?? root
  return {
    assetHash,
    bytes,
    root: persistedRoot,
    snapshots: [structuredClone(persistedRoot)]
  }
}

export function convertPptxDeckToDesign(editor: Editor, deckId: string): string | null {
  const sourceDeck = editor.graph.getNode(deckId)
  const source = sourceDeck ? readContentSource(sourceDeck) : null
  const assetHash = source ? assetHashFromReference(source.source) : null
  const bytes = assetHash ? editor.graph.images.get(assetHash) : null
  if (!sourceDeck || !bytes) return null

  let deck: ReturnType<typeof parsePptx>
  try {
    deck = parsePptx(bytes)
  } catch {
    return null
  }

  const previousSelection = [...editor.state.selectedIds]
  const slidesWidth = deck.width * deck.slides.length + NATIVE_SLIDE_GAP * (deck.slides.length - 1)
  const root = editor.graph.createNode('FRAME', sourceDeck.parentId ?? editor.state.currentPageId, {
    clipsContent: false,
    fills: [],
    height: deck.height,
    name: `${sourceDeck.name} — editable slides`,
    width: slidesWidth,
    x: sourceDeck.x + sourceDeck.width + NATIVE_DECK_GAP,
    y: sourceDeck.y
  })
  const created = [root]
  for (const [index, slide] of deck.slides.entries()) {
    created.push(...addSlide(editor, root.id, slide, deck.width, deck.height, index))
  }
  const snapshots = created.map((node) => structuredClone(node))
  editor.select([root.id])
  editor.undo.push({
    label: 'Convert PowerPoint to design',
    forward: () => {
      restoreSnapshots(editor, snapshots)
      editor.select([root.id])
      editor.requestRender()
    },
    inverse: () => {
      editor.graph.deleteNode(root.id)
      if (previousSelection.length > 0) editor.select(previousSelection)
      else editor.clearSelection()
      editor.requestRender()
    }
  })
  editor.requestRender()
  return root.id
}

export function isPptxFile(file: Pick<File, 'name' | 'type'>): boolean {
  return (
    file.name.toLowerCase().endsWith('.pptx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )
}

export async function placePptxFiles(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number
): Promise<{ fallbackFiles: File[]; placedIds: string[] }> {
  const previousSelection = [...editor.state.selectedIds]
  const decks: CreatedDeck[] = []
  const fallbackFiles: File[] = []
  for (const [index, file] of files.entries()) {
    try {
      decks.push(await createDeck(editor, file, cx, cy, index))
    } catch {
      fallbackFiles.push(file)
    }
  }
  const placedIds = decks.map(({ root }) => root.id)
  if (placedIds.length === 0) return { fallbackFiles, placedIds }
  editor.select(placedIds)
  editor.undo.push({
    forward: () => {
      for (const deck of decks) {
        editor.graph.images.set(deck.assetHash, deck.bytes)
        restoreSnapshots(editor, deck.snapshots)
      }
      editor.select(placedIds)
      editor.requestRender()
    },
    inverse: () => {
      for (const id of placedIds) editor.graph.deleteNode(id)
      for (const deck of decks) {
        if (!assetIsReferenced(editor, deck.assetHash)) editor.graph.images.delete(deck.assetHash)
      }
      if (previousSelection.length > 0) editor.select(previousSelection)
      else editor.clearSelection()
      editor.requestRender()
    },
    label: files.length === 1 ? 'Place PowerPoint deck' : 'Place PowerPoint decks'
  })
  editor.requestRender()
  return { fallbackFiles, placedIds }
}
