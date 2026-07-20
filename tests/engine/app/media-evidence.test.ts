import { beforeAll, describe, expect, test } from 'bun:test'

import { initCodec } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'
import { readContentSource } from '@open-pencil/core/io'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

import { placeMediaEvidenceFiles } from '@/app/media-evidence/intake'
import {
  mediaEvidenceMimeType,
  mediaEvidenceSource,
  mediaIntakeKind
} from '@/app/media-evidence/source'

describe('media evidence intake', () => {
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

  test('places PDF, video, and audio as ordinary source-backed frames', async () => {
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

  test('redo restores both viewer nodes and their binary assets', async () => {
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

  test('retains viewer bytes and source identity after native save and reopen', async () => {
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
    expect(reopenedSource).toMatchObject({
      fileName: 'durable.pdf',
      mimeType: 'application/pdf'
    })
    expect(reopenedHash ? reopened.images.get(reopenedHash) : undefined).toEqual(bytes)
  })
})
