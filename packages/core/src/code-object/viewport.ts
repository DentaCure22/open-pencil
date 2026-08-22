export type CodeObjectViewportPresetId = 'desktop' | 'laptop' | 'phone' | 'tablet'

export type CodeObjectViewportPreset = {
  height: number
  id: CodeObjectViewportPresetId
  label: string
  width: number
}

export const CODE_OBJECT_VIEWPORT_PRESETS: readonly CodeObjectViewportPreset[] = [
  { height: 1069, id: 'desktop', label: 'Desktop', width: 1728 },
  { height: 800, id: 'laptop', label: 'Laptop', width: 1280 },
  { height: 1024, id: 'tablet', label: 'Tablet', width: 768 },
  { height: 844, id: 'phone', label: 'Phone', width: 390 }
]

export function isCodeObjectViewportPresetId(value: unknown): value is CodeObjectViewportPresetId {
  return CODE_OBJECT_VIEWPORT_PRESETS.some((preset) => preset.id === value)
}

export function codeObjectViewportPreset(id: CodeObjectViewportPresetId): CodeObjectViewportPreset {
  const preset = CODE_OBJECT_VIEWPORT_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`Unknown Code Object viewport preset "${id}".`)
  return preset
}
