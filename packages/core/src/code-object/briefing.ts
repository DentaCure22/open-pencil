export const INBOX_BRIEFING_REPORT_VERSION = 1 as const

export type InboxBriefingItem = {
  detail?: string
  id: string
  meta?: string
  title: string
}

export type InboxBriefingSectionTone = 'attention' | 'neutral' | 'positive' | 'quiet'

export type InboxBriefingSection = {
  id: string
  items: InboxBriefingItem[]
  title: string
  tone: InboxBriefingSectionTone
}

export type InboxBriefingReport = {
  generatedAt: string
  sections: InboxBriefingSection[]
  summary?: string
  title: string
  version: typeof INBOX_BRIEFING_REPORT_VERSION
}

type MutableSection = Omit<InboxBriefingSection, 'items'> & {
  items: InboxBriefingItem[]
  usedItemIds: Set<string>
}

type BriefingParserState = {
  current: MutableSection | null
  paragraph: string[]
  preamble: string[]
  sections: MutableSection[]
  title: string
  titleWasRead: boolean
}

const MAX_TITLE_LENGTH = 240
const MAX_SUMMARY_LENGTH = 1_000
const MAX_SECTION_COUNT = 12
const MAX_ITEMS_PER_SECTION = 30
const MAX_ITEM_DETAIL_LENGTH = 2_000

function boundedText(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1).trimEnd()}…` : normalized
}

function plainInlineMarkdown(value: string): string {
  return boundedText(
    value
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/^>\s*/, ''),
    MAX_ITEM_DETAIL_LENGTH
  )
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || fallback
}

function sectionTone(title: string): InboxBriefingSectionTone {
  const value = title.toLowerCase()
  if (/attention|action|urgent|due|blocked|risk|failed|needs|follow.?up/.test(value)) {
    return 'attention'
  }
  if (/complete|done|clear|approved|healthy|\bwin\b|resolved/.test(value)) return 'positive'
  if (/skipped|noise|unchanged|no action|archive|background/.test(value)) return 'quiet'
  return 'neutral'
}

function itemParts(value: string): { detail?: string; title: string } {
  const bold = value.match(/^\*\*([^*]+)\*\*\s*(?:[,\u2014\u2013:-]\s*)?(.*)$/)
  if (bold) {
    const title = boundedText(plainInlineMarkdown(bold[1]), MAX_TITLE_LENGTH)
    const detail = boundedText(plainInlineMarkdown(bold[2]), MAX_ITEM_DETAIL_LENGTH)
    return { ...(detail ? { detail } : {}), title: title || 'Update' }
  }

  const split = value.match(/^(.{1,120}?)(?:\s+[\u2014\u2013-]\s+|:\s+)(.+)$/)
  if (split) {
    const title = boundedText(plainInlineMarkdown(split[1]), MAX_TITLE_LENGTH)
    const detail = boundedText(plainInlineMarkdown(split[2]), MAX_ITEM_DETAIL_LENGTH)
    return { ...(detail ? { detail } : {}), title: title || 'Update' }
  }

  return {
    title: boundedText(plainInlineMarkdown(value), MAX_TITLE_LENGTH) || 'Update'
  }
}

function appendItem(section: MutableSection, value: string) {
  if (section.items.length >= MAX_ITEMS_PER_SECTION) return
  const parsed = itemParts(value)
  const baseId = `${section.id}-${slug(parsed.title, `item-${section.items.length + 1}`)}`
  let id = baseId
  let suffix = 2
  while (section.usedItemIds.has(id)) {
    id = `${baseId}-${suffix}`
    suffix += 1
  }
  section.usedItemIds.add(id)
  section.items.push({ id, ...parsed })
}

function makeSection(title: string, index: number): MutableSection {
  const normalizedTitle = boundedText(plainInlineMarkdown(title), MAX_TITLE_LENGTH) || 'Highlights'
  return {
    id: slug(normalizedTitle, `section-${index + 1}`),
    items: [],
    title: normalizedTitle,
    tone: sectionTone(normalizedTitle),
    usedItemIds: new Set()
  }
}

function flushBriefingParagraph(state: BriefingParserState) {
  const value = boundedText(
    state.paragraph.map(plainInlineMarkdown).join(' '),
    MAX_ITEM_DETAIL_LENGTH
  )
  state.paragraph = []
  if (!value) return
  if (state.current) appendItem(state.current, value)
  else state.preamble.push(value)
}

function startBriefingSection(state: BriefingParserState, title: string) {
  if (state.sections.length >= MAX_SECTION_COUNT) return
  state.current = makeSection(title, state.sections.length)
  state.sections.push(state.current)
}

function acceptBriefingLine(state: BriefingParserState, line: string) {
  if (!line) {
    flushBriefingParagraph(state)
    return
  }

  const heading = line.match(/^(#{1,3})\s+(.+?)\s*$/)
  if (heading) {
    flushBriefingParagraph(state)
    if (heading[1].length === 1 && !state.titleWasRead) {
      state.title = boundedText(plainInlineMarkdown(heading[2]), MAX_TITLE_LENGTH) || state.title
      state.titleWasRead = true
    } else {
      startBriefingSection(state, heading[2])
    }
    return
  }

  const boldHeading = line.match(/^\*\*([^*]{1,120})\*\*$/)
  if (boldHeading) {
    flushBriefingParagraph(state)
    if (!state.titleWasRead && state.preamble.length === 0 && state.sections.length === 0) {
      state.title =
        boundedText(plainInlineMarkdown(boldHeading[1]), MAX_TITLE_LENGTH) || state.title
      state.titleWasRead = true
    } else {
      startBriefingSection(state, boldHeading[1])
    }
    return
  }

  const bullet = line.match(/^(?:[-*+•]|\d+[.)])\s+(.+)$/)
  if (bullet) {
    flushBriefingParagraph(state)
    if (!state.current) startBriefingSection(state, 'Highlights')
    if (state.current) appendItem(state.current, bullet[1])
    return
  }

  state.paragraph.push(line)
}

export function createInboxBriefingReport(
  content: string,
  options: { generatedAt?: string; title: string }
): InboxBriefingReport {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const state: BriefingParserState = {
    current: null,
    paragraph: [],
    preamble: [],
    sections: [],
    title: boundedText(options.title, MAX_TITLE_LENGTH) || 'Scheduled briefing',
    titleWasRead: false
  }

  for (const rawLine of lines) {
    acceptBriefingLine(state, rawLine.trim())
  }
  flushBriefingParagraph(state)

  const summary = boundedText(state.preamble.shift() ?? '', MAX_SUMMARY_LENGTH)
  if (state.preamble.length > 0 && state.sections.length < MAX_SECTION_COUNT) {
    const overview = makeSection('Overview', state.sections.length)
    for (const value of state.preamble) appendItem(overview, value)
    state.sections.unshift(overview)
  }

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sections: state.sections
      .filter((section) => section.items.length > 0)
      .map(({ usedItemIds: _usedItemIds, ...section }) => section),
    ...(summary ? { summary } : {}),
    title: state.title,
    version: INBOX_BRIEFING_REPORT_VERSION
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function isInboxBriefingReport(value: unknown): value is InboxBriefingReport {
  return (
    isRecord(value) &&
    value.version === INBOX_BRIEFING_REPORT_VERSION &&
    typeof value.generatedAt === 'string' &&
    typeof value.title === 'string' &&
    (value.summary === undefined || typeof value.summary === 'string') &&
    Array.isArray(value.sections) &&
    value.sections.every(
      (section) =>
        isRecord(section) &&
        typeof section.id === 'string' &&
        typeof section.title === 'string' &&
        ['attention', 'neutral', 'positive', 'quiet'].includes(String(section.tone)) &&
        Array.isArray(section.items) &&
        section.items.every(
          (item) =>
            isRecord(item) &&
            typeof item.id === 'string' &&
            typeof item.title === 'string' &&
            (item.detail === undefined || typeof item.detail === 'string') &&
            (item.meta === undefined || typeof item.meta === 'string')
        )
    )
  )
}

export const BRIEFING_REPORT_CODE_OBJECT_SOURCE = `type BriefingItem = {
  detail?: string
  id: string
  meta?: string
  title: string
}

type BriefingSection = {
  id: string
  items: BriefingItem[]
  title: string
  tone: 'attention' | 'neutral' | 'positive' | 'quiet'
}

type BriefingReport = {
  generatedAt: string
  sections: BriefingSection[]
  summary?: string
  title: string
  version: 1
}

type BriefingProps = {
  props: { report?: BriefingReport }
}

const toneColor = {
  attention: 'var(--code-warning)',
  neutral: 'var(--code-accent)',
  positive: 'var(--code-success)',
  quiet: 'var(--code-text-muted)'
} as const

function readableDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

export default function BriefingReport({ props }: BriefingProps) {
  const report = props.report
  if (!report) {
    return (
      <main style={{ boxSizing: 'border-box', minHeight: '100%', padding: 32, color: 'var(--code-text-muted)', fontFamily: 'Inter, ui-sans-serif, system-ui' }}>
        This briefing is not available.
      </main>
    )
  }
  const sections = Array.isArray(report.sections) ? report.sections : []
  return (
    <main
      style={{
        boxSizing: 'border-box',
        minHeight: '100%',
        padding: '30px 28px 44px',
        background: 'var(--code-background)',
        color: 'var(--code-text)',
        fontFamily: 'Inter, ui-sans-serif, system-ui'
      }}
    >
      <article style={{ margin: '0 auto', maxWidth: 760 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--code-text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <span style={{ color: 'var(--code-accent)' }}>Briefing</span>
          <span aria-hidden="true">·</span>
          <time dateTime={report.generatedAt}>{readableDate(report.generatedAt)}</time>
        </div>
        <h1 style={{ margin: '13px 0 9px', fontSize: 28, lineHeight: 1.12, letterSpacing: '-0.03em' }}>
          {report.title}
        </h1>
        {report.summary ? (
          <p style={{ margin: 0, maxWidth: 680, color: 'var(--code-text-muted)', fontSize: 15, lineHeight: 1.65 }}>
            {report.summary}
          </p>
        ) : null}
        <div style={{ height: 1, margin: '28px 0 0', background: 'var(--code-border)' }} />
        {sections.map((section) => (
          <section key={section.id} style={{ padding: '25px 0', borderBottom: '1px solid var(--code-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, background: toneColor[section.tone] }} />
              <h2 style={{ margin: 0, fontSize: 16, lineHeight: 1.3, letterSpacing: '-0.012em' }}>{section.title}</h2>
              <span style={{ marginLeft: 'auto', color: 'var(--code-text-muted)', fontSize: 10 }}>{section.items.length}</span>
            </div>
            <div style={{ display: 'grid', gap: 0, marginTop: 14 }}>
              {section.items.map((item, index) => (
                <div
                  key={item.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '18px minmax(0, 1fr)',
                    gap: 10,
                    padding: '12px 0',
                    borderTop: index === 0 ? '0' : '1px solid var(--code-border)'
                  }}
                >
                  <span style={{ color: 'var(--code-text-muted)', fontSize: 11, lineHeight: '20px', fontVariantNumeric: 'tabular-nums' }}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 650, lineHeight: 1.45 }}>{item.title}</div>
                    {item.detail ? (
                      <div style={{ marginTop: 3, color: 'var(--code-text-muted)', fontSize: 13, lineHeight: 1.55 }}>{item.detail}</div>
                    ) : null}
                    {item.meta ? (
                      <div style={{ marginTop: 6, color: 'var(--code-text-muted)', fontSize: 10, letterSpacing: '0.04em' }}>{item.meta}</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {sections.length === 0 ? (
          <div style={{ padding: '26px 0', color: 'var(--code-text-muted)', fontSize: 13 }}>No additional items.</div>
        ) : null}
      </article>
    </main>
  )
}`
