import { describe, expect, test } from 'bun:test'

import { strToU8, zipSync } from 'fflate'

import { createEditor } from '@open-pencil/core/editor'
import { readContentSource } from '@open-pencil/core/io'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

import { codeObjectDocument } from '@/app/code-object/model'
import { extractDocxText, extractXlsxCells, placeOfficeFiles } from '@/app/office-intake/intake'

function docxBytes() {
  return zipSync({
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Board-native Office</w:t></w:r></w:p>
          <w:p><w:r><w:t>Documents stay readable and editable.</w:t></w:r></w:p>
        </w:body>
      </w:document>`)
  })
}

function xlsxBytes() {
  return zipSync({
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <si><t>Channel</t></si><si><t>Q1</t></si><si><t>Product</t></si>
      </sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
          <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>84</v></c><c r="C2"><f>B2*2</f><v>168</v></c></row>
        </sheetData>
      </worksheet>`)
  })
}

describe('Office Code Object intake', () => {
  test('extracts useful document and spreadsheet previews from OOXML', () => {
    expect(extractDocxText(docxBytes())).toBe(
      'Board-native Office\n\nDocuments stay readable and editable.'
    )
    expect(extractXlsxCells(xlsxBytes())).toEqual([
      ['Channel', 'Q1'],
      ['Product', 84, '=B2*2']
    ])
  })

  test('places Office Code Objects while retaining exact source bytes', async () => {
    const editor = createEditor()
    const documentBytes = docxBytes()
    const spreadsheetBytes = xlsxBytes()
    const result = await placeOfficeFiles(
      editor,
      [
        new File([documentBytes.slice().buffer], 'brief.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }),
        new File([spreadsheetBytes.slice().buffer], 'plan.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        })
      ],
      900,
      600
    )

    expect(result.fallbackFiles).toHaveLength(0)
    expect(result.placedIds).toHaveLength(2)
    const [documentNode, spreadsheetNode] = result.placedIds.map((id) => editor.graph.getNode(id))
    expect(codeObjectDocument(documentNode)).toMatchObject({
      component: 'office-document',
      state: { seedText: 'Board-native Office\n\nDocuments stay readable and editable.' }
    })
    expect(codeObjectDocument(spreadsheetNode)).toMatchObject({
      component: 'office-spreadsheet',
      state: {
        seedCells: [
          ['Channel', 'Q1'],
          ['Product', 84, '=B2*2']
        ]
      }
    })

    for (const [node, bytes] of [
      [documentNode, documentBytes],
      [spreadsheetNode, spreadsheetBytes]
    ] as const) {
      const source = node ? readContentSource(node) : null
      const assetHash = source ? assetHashFromReference(source.source) : null
      expect(assetHash ? editor.graph.images.get(assetHash) : undefined).toEqual(bytes)
    }

    editor.undo.undo()
    expect(result.placedIds.every((id) => editor.graph.getNode(id) === undefined)).toBe(true)
    editor.undo.redo()
    expect(result.placedIds.every((id) => editor.graph.getNode(id) !== undefined)).toBe(true)
  })
})
