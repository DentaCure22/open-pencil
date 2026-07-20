export const BOARD_ICON_OPTIONS = [
  { key: 'canvas', label: 'Canvas' },
  { key: 'flow', label: 'Flow' },
  { key: 'document', label: 'Document' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'image', label: 'Media' },
  { key: 'chart', label: 'Data' },
  { key: 'code', label: 'Code' },
  { key: 'review', label: 'Review' }
] as const

export type BoardIconKey = (typeof BOARD_ICON_OPTIONS)[number]['key']

const BOARD_ICON_KEYS = new Set<string>(BOARD_ICON_OPTIONS.map((option) => option.key))

const BOARD_ICON_KEYWORDS: Array<{ icon: BoardIconKey; pattern: RegExp }> = [
  { icon: 'flow', pattern: /flow|journey|process|route|map/iu },
  { icon: 'document', pattern: /doc|note|brief|writing|spec|knowledge/iu },
  { icon: 'calendar', pattern: /calendar|schedule|timeline|plan/iu },
  { icon: 'image', pattern: /image|imaging|photo|media|gallery|x-ray|xray/iu },
  { icon: 'chart', pattern: /chart|data|analytics|metric|report/iu },
  { icon: 'code', pattern: /code|component|developer|html|css|tsx|api/iu },
  { icon: 'review', pattern: /review|decision|feedback|approval|handoff/iu }
]

export function isBoardIconKey(value: unknown): value is BoardIconKey {
  return typeof value === 'string' && BOARD_ICON_KEYS.has(value)
}

export function defaultBoardIcon(label: string, stableId: string): BoardIconKey {
  const matchingRule = BOARD_ICON_KEYWORDS.find((rule) => rule.pattern.test(label))
  if (matchingRule) return matchingRule.icon

  let hash = 0
  for (const character of stableId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return BOARD_ICON_OPTIONS[hash % BOARD_ICON_OPTIONS.length]?.key ?? 'canvas'
}
