import type { IDocumentData, IWorkbookData, PluginCtor, Univer } from '@univerjs/core'

import type {
  OfficeDocumentState,
  OfficeSpreadsheetCell,
  OfficeSpreadsheetState
} from '@/app/code-object/model'

export type OfficeRuntimeKind = 'document' | 'spreadsheet'

type OfficeRuntimeSnapshot = { [key: string]: unknown }

export type OfficeRuntime = {
  dispose: () => void
  save: () => OfficeRuntimeSnapshot
}

type CreateOfficeRuntimeInput = {
  container: HTMLElement
  fileName: string
  kind: OfficeRuntimeKind
  state: OfficeDocumentState | OfficeSpreadsheetState
}

type PresetPlugin = PluginCtor | [PluginCtor, unknown]

function isOfficeRuntimeSnapshot(value: unknown): value is OfficeRuntimeSnapshot {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function officeRuntimeSnapshot(value: unknown): OfficeRuntimeSnapshot {
  const parsed: unknown = structuredClone(value)
  if (!isOfficeRuntimeSnapshot(parsed)) {
    throw new TypeError('Office runtime returned a non-object snapshot.')
  }
  return parsed
}

function registerPreset(univer: Univer, plugins: PresetPlugin[], excluded = new Set<string>()) {
  const deduplicated = new Map<string, { options: unknown; plugin: PluginCtor }>()
  for (const entry of plugins) {
    const [plugin, options] = Array.isArray(entry) ? entry : [entry, undefined]
    if (excluded.has(plugin.pluginName)) continue
    if (deduplicated.has(plugin.pluginName)) deduplicated.delete(plugin.pluginName)
    deduplicated.set(plugin.pluginName, { options, plugin })
  }
  for (const { options, plugin } of deduplicated.values()) {
    univer.registerPlugin(plugin, options)
  }
}

function documentTitle(fileName: string) {
  return fileName.replace(/\.(docx?|rtf|txt)$/i, '').trim() || 'Untitled document'
}

function documentSnapshot(state: OfficeDocumentState, fileName: string): Partial<IDocumentData> {
  if (state.snapshot) return structuredClone(state.snapshot) as Partial<IDocumentData>
  const content = state.seedText.replace(/\r?\n/g, '\r').trim()
  const dataStream = `${content}\r\n`
  return {
    body: {
      dataStream,
      paragraphs: Array.from(dataStream.matchAll(/\r/g), ({ index }) => ({ startIndex: index })),
      sectionBreaks: [{ startIndex: dataStream.length - 1 }],
      textRuns: []
    },
    documentStyle: {},
    id: 'openpencil-office-document',
    title: documentTitle(fileName)
  }
}

function spreadsheetTitle(fileName: string) {
  return fileName.replace(/\.(csv|xlsx?)$/i, '').trim() || 'Untitled spreadsheet'
}

function spreadsheetCell(value: OfficeSpreadsheetCell) {
  return typeof value === 'string' && value.startsWith('=')
    ? { f: value }
    : {
        v: value
      }
}

function spreadsheetCellData(rows: OfficeSpreadsheetCell[][]) {
  return Object.fromEntries(
    rows.map((row, rowIndex) => [
      rowIndex,
      Object.fromEntries(row.map((value, columnIndex) => [columnIndex, spreadsheetCell(value)]))
    ])
  )
}

function spreadsheetSnapshot(
  state: OfficeSpreadsheetState,
  fileName: string
): Partial<IWorkbookData> {
  if (state.snapshot) return structuredClone(state.snapshot) as Partial<IWorkbookData>
  const sheetId = 'openpencil-sheet-overview'
  const columnCount = Math.max(26, ...state.seedCells.map((row) => row.length))
  return {
    id: 'openpencil-office-spreadsheet',
    name: spreadsheetTitle(fileName),
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: {
        cellData: spreadsheetCellData(state.seedCells),
        columnCount,
        id: sheetId,
        name: 'Overview',
        rowCount: Math.max(100, state.seedCells.length)
      }
    }
  }
}

export async function createOfficeRuntime(input: CreateOfficeRuntimeInput): Promise<OfficeRuntime> {
  const [{ FUniver }, { LocaleType, LogLevel, Univer }, { defaultTheme }] = await Promise.all([
    import('@univerjs/core/lib/facade'),
    import('@univerjs/core'),
    import('@univerjs/themes')
  ])

  let univer: InstanceType<typeof Univer>
  if (input.kind === 'document') {
    if (input.state.view !== 'document') throw new Error('Document state is invalid')
    const [{ UniverDocsCorePreset }, localeModule] = await Promise.all([
      import('@univerjs/preset-docs-core'),
      import('@univerjs/preset-docs-core/locales/en-US')
    ])
    univer = new Univer({
      darkMode: false,
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: localeModule.default },
      logLevel: LogLevel.WARN,
      theme: defaultTheme
    })
    registerPreset(
      univer,
      UniverDocsCorePreset({
        container: input.container,
        contextMenu: true,
        footer: false,
        header: true,
        ribbonType: 'simple',
        toolbar: true
      }).plugins
    )
  } else {
    if (input.state.view !== 'spreadsheet') throw new Error('Spreadsheet state is invalid')
    const [{ UniverSheetsCorePreset }, localeModule] = await Promise.all([
      import('@univerjs/preset-sheets-core'),
      import('@univerjs/preset-sheets-core/locales/en-US')
    ])
    univer = new Univer({
      darkMode: false,
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: localeModule.default },
      logLevel: LogLevel.WARN,
      theme: defaultTheme
    })
    registerPreset(
      univer,
      UniverSheetsCorePreset({
        container: input.container,
        contextMenu: true,
        footer: {
          menus: false,
          sheetBar: true,
          statisticBar: false,
          zoomSlider: true
        },
        formulaBar: true,
        header: true,
        ribbonType: 'simple',
        toolbar: true
      }).plugins,
      // Formula calculation remains enabled; this optional autocomplete UI currently races
      // the sheet hover service when several board-owned Office surfaces coexist.
      new Set(['SHEET_FORMULA_UI_PLUGIN'])
    )
  }

  const univerAPI = FUniver.newAPI(univer)
  if (input.kind === 'document') {
    if (input.state.view !== 'document') throw new Error('Document state is invalid')
    const document = univerAPI.createUniverDoc(documentSnapshot(input.state, input.fileName))
    return {
      dispose: () => {
        univerAPI.dispose()
        univer.dispose()
      },
      save: () => officeRuntimeSnapshot(document.getSnapshot())
    }
  }

  if (input.state.view !== 'spreadsheet') throw new Error('Spreadsheet state is invalid')
  const workbook = univerAPI.createWorkbook(spreadsheetSnapshot(input.state, input.fileName))
  return {
    dispose: () => {
      univerAPI.dispose()
      univer.dispose()
    },
    save: () => officeRuntimeSnapshot(workbook.save())
  }
}
