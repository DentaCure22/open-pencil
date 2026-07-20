import { strToU8, zipSync } from 'fflate'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test')

function officeArchive(entries: Record<string, string>): number[] {
  return [
    ...zipSync(
      Object.fromEntries(
        Object.entries({ '[Content_Types].xml': '<Types/>', ...entries }).map(([name, value]) => [
          name,
          strToU8(value)
        ])
      ),
      { level: 1 }
    )
  ]
}

async function dropOfficeFile(name: string, type: string, bytes: number[]) {
  await editor.page.getByTestId('canvas-element').evaluate(
    (canvas, input) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(input.bytes)], input.name, { type: input.type }))
      const rect = canvas.getBoundingClientRect()
      canvas.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          dataTransfer: transfer
        })
      )
    },
    { bytes, name, type }
  )
}

test('DOCX opens as a readable source-backed text-flow preview', async () => {
  await dropOfficeFile(
    'launch-brief.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    officeArchive({
      'word/document.xml': `
        <w:document xmlns:w="word"><w:body>
          <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Launch brief</w:t></w:r></w:p>
          <w:p><w:r><w:t>Decide what ships in the first source-backed release.</w:t></w:r></w:p>
        </w:body></w:document>
      `
    })
  )

  const preview = editor.page.getByTestId('office-docx-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('Launch brief')
  await expect(preview).toContainText('Decide what ships')
  await expect(preview).toContainText('TEXT-FLOW PREVIEW')
  await expect(editor.page.getByTestId('source-object')).toContainText('DOCX · READ ONLY')
  await expect(
    editor.page.getByRole('link', { name: 'Download source file: launch-brief.docx' })
  ).toBeVisible()
  editor.canvas.assertNoErrors()
})

test('XLSX renders a bounded grid and switches among preserved worksheets', async () => {
  await dropOfficeFile(
    'forecast.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    officeArchive({
      'xl/_rels/workbook.xml.rels': `
        <Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>
      `,
      'xl/sharedStrings.xml': `<sst><si><t>Metric</t></si><si><t>Retention</t></si><si><t>Owner</t></si><si><t>Omar</t></si></sst>`,
      'xl/workbook.xml': `
        <workbook xmlns:r="relationships"><sheets><sheet name="Forecast" r:id="rId1"/><sheet name="Owners" r:id="rId2"/></sheets></workbook>
      `,
      'xl/worksheets/sheet1.xml': `
        <worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>Week 1</v></c><c r="B2"><v>82</v></c></row></sheetData></worksheet>
      `,
      'xl/worksheets/sheet2.xml': `
        <worksheet><sheetData><row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1" t="s"><v>3</v></c></row></sheetData></worksheet>
      `
    })
  )

  const preview = editor.page.getByTestId('office-xlsx-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('Metric')
  await expect(preview).toContainText('Retention')
  await preview.getByRole('button', { name: 'Owners' }).click()
  await expect(preview).toContainText('Owner')
  await expect(preview).toContainText('Omar')
  editor.canvas.assertNoErrors()
})

test('PPTX preserves slide order and provides selected read-only navigation', async () => {
  await dropOfficeFile(
    'decision-review.pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    officeArchive({
      'ppt/_rels/presentation.xml.rels': `
        <Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>
      `,
      'ppt/presentation.xml': `
        <p:presentation xmlns:p="presentation" xmlns:r="relationships"><p:sldSz cx="12192000" cy="6858000"/><p:sldIdLst><p:sldId r:id="rId1"/><p:sldId r:id="rId2"/></p:sldIdLst></p:presentation>
      `,
      'ppt/slides/slide1.xml': `
        <p:sld xmlns:p="presentation" xmlns:a="drawing"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1219200" y="685800"/><a:ext cx="9753600" cy="1371600"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Decision review</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>
      `,
      'ppt/slides/slide2.xml': `
        <p:sld xmlns:p="presentation" xmlns:a="drawing"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr name="Title 2"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Approved scope</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>
      `
    })
  )

  const preview = editor.page.getByTestId('office-pptx-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('Decision review')
  await expect(preview).toContainText('1 / 2')
  await preview.getByRole('button', { name: 'Next slide' }).click()
  await expect(preview).toContainText('Approved scope')
  await expect(preview).toContainText('2 / 2')
  await expect(preview).toContainText(
    'Images, charts, transitions, and theme styling are not rendered'
  )
  editor.canvas.assertNoErrors()
})
