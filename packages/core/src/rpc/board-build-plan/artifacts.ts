import { resolveCodeObjectUiBlock } from '#core/code-object/ui-block'

import {
  boardBuildPlanReferenceKey,
  boundedNumber,
  DIRECTION_OFFSETS,
  exactFields,
  isRecord,
  NATIVE_CARD_ADAPTIVE_WIDTH,
  NATIVE_CARD_SOFT_BODY_FIT_BUDGET,
  optionalPlainJsonObject,
  optionalString,
  optionalText,
  parseAlias,
  parseCodeObjectSurface,
  parseCodeObjectViewport,
  parseDirections,
  parsePlacement,
  parseReference,
  preferredDirectionOffset,
  requiredString
} from './parsing'
import type { JsonRecord } from './parsing'
import type {
  BoardBuildPlanArtifact,
  BoardBuildPlanArtifactRecipe,
  BoardBuildPlanReference
} from './types'

function normalizeRecipeKind(value: JsonRecord, label: string): JsonRecord {
  if (value.type === undefined) return value
  if (value.kind !== undefined && value.kind !== value.type) {
    throw new Error(`${label}.kind and ${label}.type must match when both are supplied.`)
  }
  const { type, ...rest } = value
  return { ...rest, kind: value.kind ?? type }
}

function parseNativeTextRecipe(value: JsonRecord, label: string): BoardBuildPlanArtifactRecipe {
  exactFields(
    value,
    ['font_size', 'height', 'kind', 'max_width', 'name', 'placement', 'text', 'width'],
    label
  )
  const fontSize =
    value.font_size === undefined
      ? undefined
      : boundedNumber(value.font_size, `${label}.font_size`, 8, 256)
  if (
    value.max_width !== undefined &&
    value.width !== undefined &&
    value.max_width !== value.width
  ) {
    throw new Error(`${label}.max_width and ${label}.width must match when both are supplied.`)
  }
  const maxWidthInput = value.max_width ?? value.width
  const maxWidth =
    maxWidthInput === undefined
      ? undefined
      : boundedNumber(maxWidthInput, `${label}.max_width`, 48, 2_000)
  const height =
    value.height === undefined ? undefined : boundedNumber(value.height, `${label}.height`, 16, 720)
  const name = optionalString(value.name, `${label}.name`, 120)
  const placement = parsePlacement(value.placement, `${label}.placement`, true)
  return {
    ...(fontSize === undefined ? {} : { font_size: fontSize }),
    ...(height === undefined ? {} : { height }),
    kind: 'native_text',
    ...(maxWidth === undefined ? {} : { max_width: maxWidth }),
    ...(name ? { name } : {}),
    ...(placement ? { placement } : {}),
    text: requiredString(value.text, `${label}.text`, 10_000)
  }
}

function parseNativeCardRecipe(value: JsonRecord, label: string): BoardBuildPlanArtifactRecipe {
  exactFields(
    value,
    ['body', 'content', 'height', 'kind', 'name', 'placement', 'title', 'width'],
    label
  )
  if (value.body !== undefined && value.content !== undefined && value.body !== value.content) {
    throw new Error(`${label}.body and ${label}.content must match when both are supplied.`)
  }
  const body = optionalText(value.body ?? value.content, `${label}.body`, 1_200)
  const height =
    value.height === undefined ? undefined : boundedNumber(value.height, `${label}.height`, 80, 720)
  const name = optionalString(value.name, `${label}.name`, 120)
  const placement = parsePlacement(value.placement, `${label}.placement`, true)
  const requestedWidth =
    value.width === undefined ? undefined : boundedNumber(value.width, `${label}.width`, 240, 640)
  const width =
    requestedWidth ??
    (body.length > NATIVE_CARD_SOFT_BODY_FIT_BUDGET ? NATIVE_CARD_ADAPTIVE_WIDTH : undefined)
  return {
    body,
    ...(height === undefined ? {} : { height }),
    kind: 'native_card',
    ...(name ? { name } : {}),
    ...(placement ? { placement } : {}),
    title: requiredString(value.title ?? value.name, `${label}.title`, 120),
    ...(width === undefined ? {} : { width })
  }
}

function parseNativeDiagramRecipe(value: JsonRecord, label: string): BoardBuildPlanArtifactRecipe {
  exactFields(
    value,
    ['kind', 'owner_id', 'placement', 'source', 'source_format', 'zoom_to_selection'],
    label
  )
  if (value.source_format !== 'mermaid') {
    throw new Error(`${label}.source_format must be mermaid.`)
  }
  if (value.zoom_to_selection !== undefined && typeof value.zoom_to_selection !== 'boolean') {
    throw new Error(`${label}.zoom_to_selection must be a boolean.`)
  }
  const placement = parsePlacement(value.placement, `${label}.placement`, true)
  const ownerId = optionalString(value.owner_id, `${label}.owner_id`, 240)
  return {
    kind: 'native_diagram',
    ...(ownerId ? { owner_id: ownerId } : {}),
    ...(placement ? { placement } : {}),
    source: requiredString(value.source, `${label}.source`, 50_000),
    source_format: 'mermaid',
    ...(typeof value.zoom_to_selection === 'boolean'
      ? { zoom_to_selection: value.zoom_to_selection }
      : {})
  }
}

function parseCodeObjectRecipe(value: JsonRecord, label: string): BoardBuildPlanArtifactRecipe {
  exactFields(
    value,
    [
      'height',
      'initial_state',
      'kind',
      'name',
      'object_key',
      'operation',
      'placement',
      'props',
      'source',
      'source_format',
      'surface',
      'width'
    ],
    label
  )
  if (value.operation !== 'create') throw new Error(`${label}.operation must be create.`)
  if (value.source_format !== 'tsx') {
    throw new Error(`${label}.source_format must be tsx.`)
  }
  const height =
    value.height === undefined
      ? undefined
      : boundedNumber(value.height, `${label}.height`, 160, 1_200)
  const initialState = optionalPlainJsonObject(value.initial_state, `${label}.initial_state`)
  const placement = parsePlacement(value.placement, `${label}.placement`, true)
  const surface = parseCodeObjectSurface(value.surface, `${label}.surface`)
  const props = optionalPlainJsonObject(value.props, `${label}.props`)
  const width =
    value.width === undefined ? undefined : boundedNumber(value.width, `${label}.width`, 240, 1_600)
  return {
    ...(height === undefined ? {} : { height }),
    ...(initialState ? { initial_state: initialState } : {}),
    kind: 'code_object',
    name: requiredString(value.name, `${label}.name`, 120),
    object_key: requiredString(value.object_key, `${label}.object_key`, 160),
    operation: 'create',
    ...(placement ? { placement } : {}),
    ...(props ? { props } : {}),
    source: requiredString(value.source, `${label}.source`, 100_000),
    source_format: 'tsx',
    ...(surface ? { surface } : {}),
    ...(width === undefined ? {} : { width })
  }
}

function parseUiBlockRecipe(value: JsonRecord, label: string): BoardBuildPlanArtifactRecipe {
  exactFields(
    value,
    [
      'block',
      'config',
      'height',
      'initial_state',
      'kind',
      'name',
      'object_key',
      'operation',
      'placement',
      'surface',
      'width'
    ],
    label
  )
  if (value.operation !== 'create') throw new Error(`${label}.operation must be create.`)
  const height =
    value.height === undefined
      ? undefined
      : boundedNumber(value.height, `${label}.height`, 160, 1_200)
  const initialState = optionalPlainJsonObject(value.initial_state, `${label}.initial_state`)
  const placement = parsePlacement(value.placement, `${label}.placement`, true)
  const surface = parseCodeObjectSurface(value.surface, `${label}.surface`)
  const width =
    value.width === undefined ? undefined : boundedNumber(value.width, `${label}.width`, 240, 1_600)
  const resolved = resolveCodeObjectUiBlock(
    {
      block: requiredString(value.block, `${label}.block`, 120),
      config: value.config,
      height,
      initialState,
      surface,
      width
    },
    `${label}.config`
  )
  return {
    block: resolved.block,
    config: resolved.config,
    height: resolved.height,
    initial_state: resolved.initialState,
    kind: 'ui_block',
    name: requiredString(value.name, `${label}.name`, 120),
    object_key: requiredString(value.object_key, `${label}.object_key`, 160),
    operation: 'create',
    ...(placement ? { placement } : {}),
    surface: resolved.surface,
    width: resolved.width
  }
}

function isLocalAppRoute(route: string): boolean {
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\')) return false
  for (const character of route) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined || codePoint < 32 || codePoint === 127) return false
  }
  return true
}

function optionalBoundedNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number | undefined {
  return value === undefined ? undefined : boundedNumber(value, label, minimum, maximum)
}

function parseTrustedWebAppRecipe(value: JsonRecord, label: string): BoardBuildPlanArtifactRecipe {
  exactFields(
    value,
    [
      'app_id',
      'height',
      'kind',
      'name',
      'operation',
      'placement',
      'route',
      'viewport_preset',
      'width'
    ],
    label
  )
  if (value.operation !== 'create') throw new Error(`${label}.operation must be create.`)
  if (value.app_id !== 'smylr') throw new Error(`${label}.app_id must be smylr.`)
  const route = requiredString(value.route, `${label}.route`, 2_048)
  if (!isLocalAppRoute(route)) {
    throw new Error(`${label}.route must be a local path beginning with one slash.`)
  }
  const { preset: viewportPreset, viewport } = parseCodeObjectViewport(value, label)
  const height =
    viewport?.height ?? optionalBoundedNumber(value.height, `${label}.height`, 160, 1_200)
  const placement = parsePlacement(value.placement, `${label}.placement`, true)
  const width = viewport?.width ?? optionalBoundedNumber(value.width, `${label}.width`, 240, 1_600)
  return {
    app_id: 'smylr',
    ...(height === undefined ? {} : { height }),
    kind: 'trusted_web_app',
    name: requiredString(value.name, `${label}.name`, 120),
    operation: 'create',
    ...(placement ? { placement } : {}),
    route,
    ...(viewportPreset ? { viewport_preset: viewportPreset } : {}),
    ...(width === undefined ? {} : { width })
  }
}

function parseCanonicalObjectRecipe(
  value: JsonRecord,
  label: string
): BoardBuildPlanArtifactRecipe {
  exactFields(value, ['kind', 'operation', 'placement', 'source_object_id'], label)
  if (value.operation !== 'place') throw new Error(`${label}.operation must be place.`)
  const placement = parsePlacement(value.placement, `${label}.placement`, true)
  return {
    kind: 'canonical_object',
    operation: 'place',
    ...(placement ? { placement } : {}),
    source_object_id: requiredString(value.source_object_id, `${label}.source_object_id`, 240)
  }
}

export function parseRecipe(value: unknown, label: string): BoardBuildPlanArtifactRecipe {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  const recipe = normalizeRecipeKind(value, label)
  if (recipe.kind === 'native_text') return parseNativeTextRecipe(recipe, label)
  if (recipe.kind === 'native_card') return parseNativeCardRecipe(recipe, label)
  if (recipe.kind === 'native_diagram') return parseNativeDiagramRecipe(recipe, label)
  if (recipe.kind === 'code_object') return parseCodeObjectRecipe(recipe, label)
  if (recipe.kind === 'ui_block') return parseUiBlockRecipe(recipe, label)
  if (recipe.kind === 'trusted_web_app') return parseTrustedWebAppRecipe(recipe, label)
  if (recipe.kind === 'canonical_object') return parseCanonicalObjectRecipe(recipe, label)
  throw new Error(
    `${label}.kind must be canonical_object, native_text, native_card, native_diagram, code_object, ui_block, or trusted_web_app in plan v1.`
  )
}

export function hasPlacementTarget(recipe: BoardBuildPlanArtifactRecipe): boolean {
  return (
    (recipe.kind === 'native_card' ||
      recipe.kind === 'native_text' ||
      recipe.kind === 'native_diagram' ||
      recipe.kind === 'code_object' ||
      recipe.kind === 'trusted_web_app' ||
      recipe.kind === 'canonical_object') &&
    recipe.placement?.target !== undefined
  )
}

export function assertReferenceAvailable(
  reference: BoardBuildPlanReference,
  aliases: ReadonlySet<string>,
  label: string
): void {
  if ('alias' in reference && !aliases.has(reference.alias)) {
    throw new Error(`${label} references unknown or forward alias "${reference.alias}".`)
  }
}

function mergeArtifactPlacementFields(value: JsonRecord, label: string): unknown {
  if (value.clearance === undefined && value.preferred_directions === undefined) {
    return value.recipe
  }
  if (!isRecord(value.recipe)) throw new Error(`${label}.recipe must be an object.`)
  const placement = isRecord(value.recipe.placement) ? value.recipe.placement : {}
  if (
    value.clearance !== undefined &&
    placement.clearance !== undefined &&
    value.clearance !== placement.clearance
  ) {
    throw new Error(`${label} has conflicting clearance values.`)
  }
  if (
    value.preferred_directions !== undefined &&
    placement.preferred_directions !== undefined &&
    JSON.stringify(value.preferred_directions) !== JSON.stringify(placement.preferred_directions)
  ) {
    throw new Error(`${label} has conflicting preferred_directions values.`)
  }
  return {
    ...value.recipe,
    placement: {
      ...placement,
      ...(value.clearance === undefined ? {} : { clearance: value.clearance }),
      ...(value.preferred_directions === undefined
        ? {}
        : { preferred_directions: value.preferred_directions })
    }
  }
}

function extractPlacementAnchor(
  recipeInput: unknown,
  label: string
): { anchor?: BoardBuildPlanReference; recipeInput: unknown } {
  if (!isRecord(recipeInput) || !isRecord(recipeInput.placement)) return { recipeInput }
  if (recipeInput.placement.anchor === undefined) return { recipeInput }
  const anchor = parseReference(recipeInput.placement.anchor, `${label}.recipe.placement.anchor`)
  const placement = { ...recipeInput.placement }
  delete placement.anchor
  return { anchor, recipeInput: { ...recipeInput, placement } }
}

function resolveArtifactAnchor(
  declaredValue: unknown,
  placementAnchor: BoardBuildPlanReference | undefined,
  earlierAliases: ReadonlySet<string>,
  label: string
): BoardBuildPlanReference | undefined {
  const declaredAnchor =
    declaredValue === undefined ? undefined : parseReference(declaredValue, `${label}.anchor`)
  if (
    declaredAnchor &&
    placementAnchor &&
    boardBuildPlanReferenceKey(declaredAnchor) !== boardBuildPlanReferenceKey(placementAnchor)
  ) {
    throw new Error(`${label} has conflicting artifact and placement anchors.`)
  }
  const anchor = declaredAnchor ?? placementAnchor
  if (anchor) assertReferenceAvailable(anchor, earlierAliases, `${label}.anchor`)
  return anchor
}

function remainingPreferredDirections(
  rawPreferred: unknown,
  targetDirection: string | undefined
): unknown[] {
  if (Array.isArray(rawPreferred)) {
    return rawPreferred.filter(
      (direction) => typeof direction !== 'string' || direction !== targetDirection
    )
  }
  return rawPreferred === undefined ? [] : [rawPreferred]
}

function normalizeDirectionalTarget(recipeInput: JsonRecord, label: string): JsonRecord {
  if (!isRecord(recipeInput.placement)) return recipeInput
  const target = recipeInput.placement.target
  if (!isRecord(target) || target.kind !== 'relative' || target.direction === undefined) {
    return recipeInput
  }
  exactFields(target, ['direction', 'kind'], `${label}.recipe.placement.target`)
  const targetDirection = typeof target.direction === 'string' ? target.direction : undefined
  const preferredDirections = parseDirections(
    [
      target.direction,
      ...remainingPreferredDirections(recipeInput.placement.preferred_directions, targetDirection)
    ],
    `${label}.recipe.placement.target.direction`
  )
  const relativeOffset = targetDirection
    ? DIRECTION_OFFSETS.get(targetDirection.replace(' ', '-'))
    : undefined
  const placement = { ...recipeInput.placement }
  delete placement.target
  return {
    ...recipeInput,
    placement: {
      ...placement,
      preferred_directions: preferredDirections,
      ...(relativeOffset ? { relative_offset: relativeOffset } : {})
    }
  }
}

function inferPlacementOffset(recipeInput: JsonRecord): JsonRecord {
  if (!isRecord(recipeInput.placement) || recipeInput.placement.relative_offset !== undefined) {
    return recipeInput
  }
  const relativeOffset = preferredDirectionOffset(recipeInput.placement.preferred_directions)
  return relativeOffset
    ? {
        ...recipeInput,
        placement: { ...recipeInput.placement, relative_offset: relativeOffset }
      }
    : recipeInput
}

function normalizeAnchoredPlacement(
  recipeInput: unknown,
  anchor: BoardBuildPlanReference | undefined,
  label: string
): unknown {
  if (!anchor || !isRecord(recipeInput)) return recipeInput
  return inferPlacementOffset(normalizeDirectionalTarget(recipeInput, label))
}

export function parseArtifact(
  value: unknown,
  index: number,
  earlierAliases: ReadonlySet<string>
): BoardBuildPlanArtifact {
  const label = `plan.artifacts[${index}]`
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  exactFields(value, ['alias', 'anchor', 'clearance', 'preferred_directions', 'recipe'], label)
  const alias = parseAlias(value.alias, `${label}.alias`)
  const mergedRecipeInput = mergeArtifactPlacementFields(value, label)
  const { anchor: placementAnchor, recipeInput } = extractPlacementAnchor(mergedRecipeInput, label)
  const anchor = resolveArtifactAnchor(value.anchor, placementAnchor, earlierAliases, label)
  const normalizedRecipe = parseRecipe(
    normalizeAnchoredPlacement(recipeInput, anchor, label),
    `${label}.recipe`
  )
  return { alias, ...(anchor ? { anchor } : {}), recipe: normalizedRecipe }
}
