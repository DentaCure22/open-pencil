#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const DEFAULT_SOURCE_PATH = path.join(
  ROOT,
  'docs',
  'design-labs',
  'open-pencil-component-fixtures.json'
)
const DEFAULT_INVENTORY_PATH = path.join(
  ROOT,
  'docs',
  'design-labs',
  'component-inventory.json'
)
const DEFAULT_OUTPUT_PATH = path.join(
  ROOT,
  'archive',
  'agent-tooling',
  'open-pencil-base',
  'src',
  'app',
  'smylr-component-library',
  'renderer-catalog.generated.json'
)

function parseArgs(argv) {
  const args = {
    check: false,
    inventoryPath: DEFAULT_INVENTORY_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    sourcePath: DEFAULT_SOURCE_PATH,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') args.check = true
    else if (arg === '--inventory')
      args.inventoryPath = path.resolve(argv[++index])
    else if (arg === '--output') args.outputPath = path.resolve(argv[++index])
    else if (arg === '--source') args.sourcePath = path.resolve(argv[++index])
    else throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function buildCatalog(source, inventory) {
  if (source.schemaVersion !== 1) throw new Error('Unsupported fixture schema')
  if (inventory.schemaVersion !== 1)
    throw new Error('Unsupported component inventory schema')
  if (!Array.isArray(source.fixtures) || source.fixtures.length === 0) {
    throw new Error('At least one fixture is required')
  }

  const inventoryByPath = new Map(
    inventory.components.map((component) => [component.relPath, component])
  )
  const fixtureIds = new Set()

  const fixtures = source.fixtures.map((fixture) => {
    if (!/^[a-z][a-z0-9-]*$/.test(fixture.fixtureId)) {
      throw new Error(`Invalid fixture id: ${fixture.fixtureId}`)
    }
    if (fixtureIds.has(fixture.fixtureId)) {
      throw new Error(`Duplicate fixture id: ${fixture.fixtureId}`)
    }
    fixtureIds.add(fixture.fixtureId)

    if (
      path.isAbsolute(fixture.sourcePath) ||
      fixture.sourcePath.split('/').includes('..') ||
      !fixture.sourcePath.startsWith('src/components/')
    ) {
      throw new Error(`Invalid fixture source: ${fixture.sourcePath}`)
    }

    const inventoryComponent = inventoryByPath.get(fixture.sourcePath)
    if (!inventoryComponent) {
      throw new Error(
        `${fixture.fixtureId} is missing from the generated component inventory`
      )
    }
    if (!inventoryComponent.componentNames.includes(fixture.symbol)) {
      throw new Error(
        `${fixture.fixtureId} symbol ${fixture.symbol} is not exported by ${fixture.sourcePath}`
      )
    }
    if (inventoryComponent.storyStatus !== 'covered') {
      throw new Error(
        `${fixture.fixtureId} does not have covered source evidence`
      )
    }
    if (!fs.existsSync(path.join(ROOT, fixture.sourcePath))) {
      throw new Error(`${fixture.fixtureId} source file does not exist`)
    }

    const overlayHeight = positiveInteger(
      fixture.overlayHeight,
      `${fixture.fixtureId}.overlayHeight`
    )

    return {
      ...fixture,
      frameHeight: positiveInteger(
        fixture.frameHeight,
        `${fixture.fixtureId}.frameHeight`
      ),
      frameWidth: positiveInteger(
        fixture.frameWidth,
        `${fixture.fixtureId}.frameWidth`
      ),
      interactionHeight: positiveInteger(
        fixture.interactionHeight ?? overlayHeight,
        `${fixture.fixtureId}.interactionHeight`
      ),
      overlayHeight,
      overlayWidth: positiveInteger(
        fixture.overlayWidth,
        `${fixture.fixtureId}.overlayWidth`
      ),
      repository: 'Smylr-Elite',
      inventory: {
        layer: inventoryComponent.layer,
        storyStatus: inventoryComponent.storyStatus,
        storyTitle: inventoryComponent.storyTitles[0],
        variantAxes: inventoryComponent.variantAxes,
      },
    }
  })

  return {
    schemaVersion: 1,
    rendererVersion: '8',
    generatedFrom: {
      fixtureSource: path
        .relative(ROOT, DEFAULT_SOURCE_PATH)
        .split(path.sep)
        .join('/'),
      inventorySource: path
        .relative(ROOT, DEFAULT_INVENTORY_PATH)
        .split(path.sep)
        .join('/'),
      inventoryComponentCount: inventory.summary.componentCount,
    },
    fixtures,
  }
}

function run() {
  const args = parseArgs(process.argv.slice(2))
  const catalog = buildCatalog(
    readJson(args.sourcePath),
    readJson(args.inventoryPath)
  )
  const nextJson = `${JSON.stringify(catalog, null, 2)}\n`

  if (args.check) {
    const current = fs.existsSync(args.outputPath)
      ? fs.readFileSync(args.outputPath, 'utf8')
      : null
    if (current !== nextJson) {
      throw new Error(
        `OpenPencil component catalog is stale: ${args.outputPath}`
      )
    }
    process.stdout.write(
      `PASS: ${catalog.fixtures.length} OpenPencil renderer fixtures verified\n`
    )
    return
  }

  fs.mkdirSync(path.dirname(args.outputPath), { recursive: true })
  fs.writeFileSync(args.outputPath, nextJson)
  process.stdout.write(
    `Wrote ${catalog.fixtures.length} fixtures to ${args.outputPath}\n`
  )
}

run()
