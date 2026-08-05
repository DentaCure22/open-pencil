import { beforeAll, describe, expect, test } from 'bun:test'

import { strToU8, zipSync } from 'fflate'

import { initCodec } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'
import { parsePptx, readContentSource } from '@open-pencil/core/io'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

import { codeObjectDocument, isCodeObjectFrame } from '@/app/code-object/model'
import { convertPptxDeckToDesign, placePptxFiles } from '@/app/presentation-intake/intake'
import { isPptxDeckNode } from '@/app/presentation-intake/source'

function presentationXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst>
      <p:sldSz cx="12192000" cy="6858000"/>
    </p:presentation>`
}

function relationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Target="slides/slide1.xml"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/>
      <Relationship Id="rId2" Target="slides/slide2.xml"
        Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/>
    </Relationships>`
}

function slideXml(title: string, background: string, accent: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld>
        <p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill></p:bgPr></p:bg>
        <p:spTree>
          <p:nvGrpSpPr/><p:grpSpPr/>
          <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="Rule"/></p:nvCxnSpPr><p:spPr>
            <a:xfrm><a:off x="914400" y="4572000"/><a:ext cx="2743200" cy="0"/></a:xfrm>
            <a:prstGeom prst="straightConnector1"/><a:ln w="12700"><a:solidFill><a:srgbClr val="${accent}"/></a:solidFill></a:ln>
          </p:spPr></p:cxnSp>
          <p:sp><p:nvSpPr><p:cNvPr id="2" name="Accent"/></p:nvSpPr><p:spPr>
            <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="914400" cy="457200"/></a:xfrm>
            <a:prstGeom prst="roundRect"/><a:solidFill><a:srgbClr val="${accent}"/></a:solidFill>
          </p:spPr></p:sp>
          <p:sp><p:nvSpPr><p:cNvPr id="3" name="Title"/></p:nvSpPr><p:spPr>
            <a:xfrm><a:off x="914400" y="1828800"/><a:ext cx="7315200" cy="1371600"/></a:xfrm>
            <a:prstGeom prst="rect"/>
          </p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr">
            <a:defRPr sz="3200"><a:solidFill><a:srgbClr val="111111"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr>
          </a:pPr><a:r><a:rPr sz="3200" b="1"><a:solidFill><a:srgbClr val="111111"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
        </p:spTree>
      </p:cSld>
    </p:sld>`
}

function pptxBytes(): Uint8Array {
  return zipSync({
    'ppt/_rels/presentation.xml.rels': strToU8(relationshipsXml()),
    'ppt/presentation.xml': strToU8(presentationXml()),
    'ppt/slides/slide1.xml': strToU8(slideXml('First filename', 'FFFFFF', '6DCBF4')),
    'ppt/slides/slide2.xml': strToU8(slideXml('First relationship', '10151F', 'E9B872'))
  })
}

describe('PowerPoint Code Object intake', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('parses ordered slides into native-ready geometry and styles', () => {
    const deck = parsePptx(pptxBytes())

    expect(deck).toMatchObject({ height: 540, width: 960 })
    expect(deck.slides.map((slide) => slide.backgroundColor)).toEqual(['#10151F', '#FFFFFF'])
    expect(deck.slides[0].elements.map((element) => element.name)).toEqual([
      'Rule',
      'Accent',
      'Title'
    ])
    expect(deck.slides[0].elements.find((element) => element.name === 'Title')).toMatchObject({
      fontSize: 32,
      fontWeight: 700,
      kind: 'text',
      text: 'First relationship',
      textAlign: 'CENTER',
      verticalAlign: 'CENTER'
    })
  })

  test('places one interactive deck, retains source, and restores the same ID on redo', async () => {
    const editor = createEditor()
    const bytes = pptxBytes()
    const result = await placePptxFiles(
      editor,
      [
        new File([bytes.slice().buffer], 'native-deck.pptx', {
          type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        })
      ],
      800,
      500
    )
    const rootId = result.placedIds[0]
    const root = editor.graph.getNode(rootId)
    const source = root ? readContentSource(root) : null
    const assetHash = source ? assetHashFromReference(source.source) : null

    expect(isPptxDeckNode(root)).toBe(true)
    expect(isCodeObjectFrame(root)).toBe(true)
    expect(codeObjectDocument(root)).toMatchObject({
      component: 'pptx-deck',
      state: { activeSlide: 0, view: 'deck' }
    })
    expect(root ? editor.graph.getChildren(root.id) : []).toHaveLength(0)
    expect(assetHash ? editor.graph.images.get(assetHash) : undefined).toEqual(bytes)

    editor.undo.undo()
    expect(editor.graph.getNode(rootId)).toBeUndefined()
    expect(assetHash ? editor.graph.images.has(assetHash) : false).toBe(false)

    editor.undo.redo()
    expect(editor.graph.getNode(rootId)).toBeDefined()
    expect(assetHash ? editor.graph.images.get(assetHash) : undefined).toEqual(bytes)

    const reopened = await parseFigFile((await exportFigFile(editor.graph)).buffer as ArrayBuffer)
    const reopenedRoot = [...reopened.getAllNodes()].find((node) => isPptxDeckNode(node))
    const reopenedSource = reopenedRoot ? readContentSource(reopenedRoot) : null
    const reopenedHash = reopenedSource ? assetHashFromReference(reopenedSource.source) : null
    expect(isPptxDeckNode(reopenedRoot)).toBe(true)
    expect(isCodeObjectFrame(reopenedRoot)).toBe(true)
    expect(reopenedHash ? reopened.images.get(reopenedHash) : undefined).toEqual(bytes)
  })

  test('creates native editable slides only through the explicit conversion action', async () => {
    const editor = createEditor()
    const bytes = pptxBytes()
    const result = await placePptxFiles(
      editor,
      [
        new File([bytes.slice().buffer], 'source-first-deck.pptx', {
          type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        })
      ],
      800,
      500
    )
    const sourceId = result.placedIds[0]
    if (!sourceId) throw new Error('PowerPoint source deck was not placed')

    const projectionId = convertPptxDeckToDesign(editor, sourceId)
    if (!projectionId) throw new Error('PowerPoint deck was not converted')
    const projection = editor.graph.getNode(projectionId)
    const slideIds = projection
      ? editor.graph
          .getChildren(projection.id)
          .filter((node) => node.name.startsWith('Slide '))
          .map((node) => node.id)
      : []

    expect(slideIds).toHaveLength(2)
    expect(
      slideIds.flatMap((id) => editor.graph.getChildren(id)).filter((node) => node.type === 'TEXT')
    ).toHaveLength(2)
    expect(editor.graph.getChildren(sourceId)).toHaveLength(0)

    editor.undo.undo()
    expect(editor.graph.getNode(projectionId)).toBeUndefined()
    expect(editor.graph.getNode(sourceId)).toBeDefined()

    editor.undo.redo()
    expect(editor.graph.getNode(projectionId)).toBeDefined()
    expect(slideIds.every((id) => editor.graph.getNode(id))).toBe(true)
  })
})
