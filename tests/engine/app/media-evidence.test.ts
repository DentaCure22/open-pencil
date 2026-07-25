import { beforeAll, describe, expect, test } from 'bun:test'

import { initCodec } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'
import { readContentSource } from '@open-pencil/core/io'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

import { codeObjectDocument } from '@/app/code-object/model'
import { placeExtractedPdfPage } from '@/app/media-evidence/extraction'
import { placeMediaEvidenceFiles } from '@/app/media-evidence/intake'
import {
  mediaEvidenceMimeType,
  mediaEvidenceSource,
  mediaIntakeKind
} from '@/app/media-evidence/source'

describe('media and PDF intake', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('classifies the bounded media set', () => {
    expect(mediaIntakeKind(new File([], 'photo.png', { type: 'image/png' }))).toBe('raster')
    expect(mediaIntakeKind(new File([], 'brief.pdf', { type: 'application/pdf' }))).toBe('pdf')
    expect(mediaIntakeKind(new File([], 'demo.mov'))).toBe('video')
    expect(mediaIntakeKind(new File([], 'notes.mp3'))).toBe('audio')
    expect(mediaIntakeKind(new File([], 'logo.svg', { type: 'image/svg+xml' }))).toBeNull()
    expect(mediaIntakeKind(new File([], 'archive.zip'))).toBeNull()
  })

  test('derives accurate viewer MIME types from filenames when File.type is absent', () => {
    expect(mediaEvidenceMimeType(new File([], 'walkthrough.webm'), 'video')).toBe('video/webm')
    expect(mediaEvidenceMimeType(new File([], 'recording.wav'), 'audio')).toBe('audio/wav')
    expect(mediaEvidenceMimeType(new File([], 'review.pdf'), 'pdf')).toBe('application/pdf')
  })

  test('places PDF as a Code Object and keeps video and audio as ordinary media frames', async () => {
    const editor = createEditor()
    const selectedFrame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      height: 200,
      name: 'Previously selected frame',
      width: 200
    })
    editor.select([selectedFrame.id])
    const inputs = [
      new File([new Uint8Array([37, 80, 68, 70])], 'research.pdf', {
        type: 'application/pdf'
      }),
      new File([new Uint8Array([0, 0, 0, 24])], 'interview.mp4', { type: 'video/mp4' }),
      new File([new Uint8Array([73, 68, 51])], 'memo.mp3', { type: 'audio/mpeg' })
    ]

    const ids = await placeMediaEvidenceFiles(editor, inputs, 1200, 600)

    expect(ids).toHaveLength(3)
    expect(editor.state.selectedIds).toEqual(new Set(ids))
    for (const id of ids) {
      const node = editor.graph.getNode(id)
      expect(node?.type).toBe('FRAME')
      if (!node) continue
      const source = mediaEvidenceSource(node)
      expect(node.parentId).toBe(editor.state.currentPageId)
      expect(source).not.toBeNull()
      expect(source?.metadata.source.startsWith('openpencil-asset://')).toBe(true)
      expect(source?.metadata.source.includes('base64')).toBe(false)
      expect(source ? editor.graph.images.has(source.assetHash) : false).toBe(true)
    }

    const sources = ids.flatMap((id) => {
      const node = editor.graph.getNode(id)
      const source = node ? readContentSource(node) : null
      return source ? [source] : []
    })
    expect(sources.map((source) => source.fileName)).toEqual([
      'research.pdf',
      'interview.mp4',
      'memo.mp3'
    ])
    expect(sources.map((source) => source.mimeType)).toEqual([
      'application/pdf',
      'video/mp4',
      'audio/mpeg'
    ])
    expect(codeObjectDocument(editor.graph.getNode(ids[0]))).toMatchObject({
      component: 'pdf-document',
      state: { activePage: 1, view: 'pdf' }
    })
    expect(codeObjectDocument(editor.graph.getNode(ids[1]))).toBeNull()
    expect(codeObjectDocument(editor.graph.getNode(ids[2]))).toBeNull()
  })

  test('cascades repeated media placement instead of stacking exact duplicates', async () => {
    const editor = createEditor()
    const bytes = new Uint8Array([37, 80, 68, 70])
    const [firstId] = await placeMediaEvidenceFiles(
      editor,
      [new File([bytes], 'first.pdf', { type: 'application/pdf' })],
      400,
      300
    )
    const [secondId] = await placeMediaEvidenceFiles(
      editor,
      [new File([bytes], 'second.pdf', { type: 'application/pdf' })],
      400,
      300
    )

    const first = editor.graph.getNode(firstId)
    const second = editor.graph.getNode(secondId)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(second?.x).toBe((first?.x ?? 0) + 32)
    expect(second?.y).toBe((first?.y ?? 0) + 32)
  })

  test('undo only removes shared bytes after the final referencing node is gone', async () => {
    const editor = createEditor()
    const bytes = new Uint8Array([37, 80, 68, 70])
    const [firstId] = await placeMediaEvidenceFiles(
      editor,
      [new File([bytes], 'first.pdf', { type: 'application/pdf' })],
      400,
      300
    )
    const [secondId] = await placeMediaEvidenceFiles(
      editor,
      [new File([bytes], 'second.pdf', { type: 'application/pdf' })],
      400,
      300
    )
    const first = editor.graph.getNode(firstId)
    const source = first ? readContentSource(first) : null
    const hash = source ? assetHashFromReference(source.source) : null

    editor.undo.undo()
    expect(editor.graph.getNode(secondId)).toBeUndefined()
    expect(hash ? editor.graph.images.has(hash) : false).toBe(true)

    editor.undo.undo()
    expect(editor.graph.getNode(firstId)).toBeUndefined()
    expect(hash ? editor.graph.images.has(hash) : false).toBe(false)
  })

  test('redo restores the PDF Code Object and its binary asset', async () => {
    const editor = createEditor()
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'source.pdf', {
      type: 'application/pdf'
    })
    const [id] = await placeMediaEvidenceFiles(editor, [file], 400, 300)
    const node = editor.graph.getNode(id)
    const source = node ? readContentSource(node) : null
    const hash = source ? assetHashFromReference(source.source) : null

    editor.undo.undo()
    expect(editor.graph.getNode(id)).toBeUndefined()
    expect(hash ? editor.graph.images.has(hash) : false).toBe(false)

    editor.undo.redo()
    expect(editor.graph.getNode(id)).toBeDefined()
    expect(hash ? editor.graph.images.has(hash) : false).toBe(true)
  })

  test('retains PDF Code Object bytes and source identity after native save and reopen', async () => {
    const editor = createEditor()
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])
    await placeMediaEvidenceFiles(
      editor,
      [new File([bytes], 'durable.pdf', { type: 'application/pdf' })],
      400,
      300
    )

    const reopened = await parseFigFile((await exportFigFile(editor.graph)).buffer as ArrayBuffer)
    const reopenedNode = [...reopened.getAllNodes()].find(
      (node) => readContentSource(node)?.fileName === 'durable.pdf'
    )
    const reopenedSource = reopenedNode ? readContentSource(reopenedNode) : null
    const reopenedHash = reopenedSource ? assetHashFromReference(reopenedSource.source) : null

    expect(reopenedNode?.type).toBe('FRAME')
    expect(codeObjectDocument(reopenedNode)).toMatchObject({
      component: 'pdf-document',
      state: { activePage: 1, view: 'pdf' }
    })
    expect(reopenedSource).toMatchObject({
      fileName: 'durable.pdf',
      mimeType: 'application/pdf'
    })
    expect(reopenedHash ? reopened.images.get(reopenedHash) : undefined).toEqual(bytes)
  })

  test('restores the exact extracted page ID on redo and survives save and reopen', async () => {
    const editor = createEditor()
    const [sourceId] = await placeMediaEvidenceFiles(
      editor,
      [
        new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])], 'source.pdf', {
          type: 'application/pdf'
        })
      ],
      400,
      300
    )
    const sourceNode = editor.graph.getNode(sourceId)
    const source = sourceNode ? mediaEvidenceSource(sourceNode) : null
    expect(sourceNode).toBeDefined()
    expect(source).not.toBeNull()
    if (!sourceNode || !source) return

    const extractedBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const extractedId = placeExtractedPdfPage(editor, sourceNode, source, 2, {
      bytes: extractedBytes,
      fileName: 'source - page 2.png',
      height: 1200,
      width: 900
    })
    const extractedNode = editor.graph.getNode(extractedId)
    const extractedSource = extractedNode ? readContentSource(extractedNode) : null
    const extractedHash = extractedSource ? assetHashFromReference(extractedSource.source) : null

    expect(extractedNode?.pluginData).toContainEqual({
      key: 'media-evidence/pdf-page',
      pluginId: 'open-pencil',
      value: '2'
    })
    expect(editor.state.selectedIds).toEqual(new Set([extractedId]))

    editor.undo.undo()
    expect(editor.graph.getNode(sourceId)).toBeDefined()
    expect(editor.graph.getNode(extractedId)).toBeUndefined()
    expect(editor.state.selectedIds).toEqual(new Set([sourceId]))
    expect(extractedHash ? editor.graph.images.has(extractedHash) : false).toBe(false)

    editor.undo.redo()
    expect(editor.graph.getNode(extractedId)?.id).toBe(extractedId)
    expect(editor.state.selectedIds).toEqual(new Set([extractedId]))
    expect(extractedHash ? editor.graph.images.get(extractedHash) : undefined).toEqual(
      extractedBytes
    )

    const reopened = await parseFigFile((await exportFigFile(editor.graph)).buffer as ArrayBuffer)
    const reopenedExtract = [...reopened.getAllNodes()].find((candidate) =>
      candidate.pluginData.some(
        (entry) => entry.key === 'media-evidence/kind' && entry.value === 'pdf-page'
      )
    )
    const reopenedSource = reopenedExtract ? readContentSource(reopenedExtract) : null
    const reopenedHash = reopenedSource ? assetHashFromReference(reopenedSource.source) : null

    expect(reopenedExtract?.pluginData).toContainEqual({
      key: 'media-evidence/source-asset-hash',
      pluginId: 'open-pencil',
      value: source.assetHash
    })
    expect(reopenedHash ? reopened.images.get(reopenedHash) : undefined).toEqual(extractedBytes)
  })
})
