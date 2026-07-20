import { describe, expect, test } from 'bun:test'

import { strToU8, zipSync } from 'fflate'

import { createEditor } from '@open-pencil/core/editor'

import { classifyBoardFile } from '@/app/file-intake/classify'
import { placeFileIntakeFiles } from '@/app/file-intake/intake'
import {
  MAX_OFFICE_SOURCE_BYTES,
  officeDocumentSource,
  parseOfficeDocumentPreview
} from '@/app/office-document'

function officeArchive(entries: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries({ '[Content_Types].xml': '<Types/>', ...entries }).map(([name, value]) => [
        name,
        strToU8(value)
      ])
    ),
    { level: 1 }
  )
}

function docxBytes(): Uint8Array {
  return officeArchive({
    'word/document.xml': `
      <w:document xmlns:w="word">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Launch brief</w:t></w:r></w:p>
          <w:p><w:r><w:t xml:space="preserve">A source-backed </w:t></w:r><w:r><w:t>document preview.</w:t></w:r></w:p>
          <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr><w:r><w:t>Keep exact bytes</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `
  })
}

function xlsxBytes(): Uint8Array {
  return officeArchive({
    'xl/_rels/workbook.xml.rels': `
      <Relationships xmlns="relationships">
        <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
      </Relationships>
    `,
    'xl/sharedStrings.xml': `
      <sst xmlns="spreadsheet"><si><t>Metric</t></si><si><t>Retention</t></si></sst>
    `,
    'xl/workbook.xml': `
      <workbook xmlns="spreadsheet" xmlns:r="relationships">
        <sheets><sheet name="Forecast" sheetId="1" r:id="rId1"/></sheets>
      </workbook>
    `,
    'xl/worksheets/sheet1.xml': `
      <worksheet xmlns="spreadsheet"><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
        <row r="2"><c r="A2" t="inlineStr"><is><t>Week 1</t></is></c><c r="B2"><v>82</v></c></row>
      </sheetData></worksheet>
    `
  })
}

function pptxBytes(): Uint8Array {
  return officeArchive({
    'ppt/_rels/presentation.xml.rels': `
      <Relationships xmlns="relationships">
        <Relationship Id="rId1" Target="slides/slide1.xml"/>
      </Relationships>
    `,
    'ppt/presentation.xml': `
      <p:presentation xmlns:p="presentation" xmlns:r="relationships">
        <p:sldSz cx="12192000" cy="6858000"/>
        <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
      </p:presentation>
    `,
    'ppt/slides/slide1.xml': `
      <p:sld xmlns:p="presentation" xmlns:a="drawing">
        <p:cSld><p:spTree><p:sp>
          <p:nvSpPr><p:cNvPr name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="1219200" y="685800"/><a:ext cx="9753600" cy="1371600"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:t>Decision review</a:t></a:r></a:p></p:txBody>
        </p:sp></p:spTree></p:cSld>
      </p:sld>
    `
  })
}

describe('Office document previews', () => {
  test('extracts bounded DOCX text flow without mutating source bytes', () => {
    const bytes = docxBytes()
    const result = parseOfficeDocumentPreview(bytes, 'docx')

    expect(result.status).toBe('ready')
    if (result.status !== 'ready' || result.preview.kind !== 'docx') return
    expect(result.preview.title).toBe('Launch brief')
    expect(result.preview.blocks).toEqual([
      { kind: 'title', level: 0, text: 'Launch brief' },
      { kind: 'paragraph', level: 0, text: 'A source-backed document preview.' },
      { kind: 'list-item', level: 1, text: 'Keep exact bytes' }
    ])
  })

  test('extracts XLSX sheet names, shared strings, inline strings, and sparse values', () => {
    const result = parseOfficeDocumentPreview(xlsxBytes(), 'xlsx')

    expect(result.status).toBe('ready')
    if (result.status !== 'ready' || result.preview.kind !== 'xlsx') return
    expect(result.preview.sheets[0]).toMatchObject({
      name: 'Forecast',
      truncated: false
    })
    expect(result.preview.sheets[0]?.cells).toEqual([
      { column: 0, row: 0, value: 'Metric' },
      { column: 1, row: 0, value: 'Retention' },
      { column: 0, row: 1, value: 'Week 1' },
      { column: 1, row: 1, value: '82' }
    ])
  })

  test('extracts PPTX slide order, text, semantic role, and approximate geometry', () => {
    const result = parseOfficeDocumentPreview(pptxBytes(), 'pptx')

    expect(result.status).toBe('ready')
    if (result.status !== 'ready' || result.preview.kind !== 'pptx') return
    expect(result.preview.slides).toHaveLength(1)
    expect(result.preview.slides[0]?.shapes[0]).toMatchObject({
      height: 20,
      role: 'title',
      text: 'Decision review',
      width: 80,
      x: 10,
      y: 10
    })
  })

  test('keeps corrupt, encrypted, and oversized files as honest fallback results', () => {
    expect(parseOfficeDocumentPreview(new Uint8Array([1, 2, 3]), 'docx')).toMatchObject({
      code: 'invalid-package',
      status: 'error'
    })
    expect(
      parseOfficeDocumentPreview(
        new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        'xlsx'
      )
    ).toMatchObject({ code: 'encrypted', status: 'error' })
    expect(
      parseOfficeDocumentPreview(new Uint8Array(MAX_OFFICE_SOURCE_BYTES + 1), 'pptx')
    ).toMatchObject({ code: 'file-too-large', status: 'error' })
  })

  test('routes Office files through the specialized adapter while preserving exact bytes', async () => {
    const editor = createEditor()
    const bytes = xlsxBytes()
    const file = new File([bytes], 'forecast.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })

    expect(classifyBoardFile(file)).toEqual({
      adapterId: 'office-document',
      kind: 'specialized'
    })
    const result = await placeFileIntakeFiles(editor, [file], 400, 300)
    expect(result.specializedIds).toHaveLength(1)
    expect(result.sourceObjectIds).toEqual([])
    const node = editor.graph.getNode(result.specializedIds[0])
    const source = officeDocumentSource(node)
    expect(node).toMatchObject({ height: 500, width: 720 })
    expect(source).toMatchObject({ fileName: 'forecast.xlsx', kind: 'xlsx' })
    expect(source ? editor.graph.images.get(source.assetHash) : undefined).toEqual(bytes)
  })
})
