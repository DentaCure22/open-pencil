import type { CodeObjectTheme } from '@open-pencil/core/code-object'

import type { CodeObjectState, OfficeDocumentState } from '@/app/code-object/model'

import { UniverSurface } from './UniverSurface'

type DocumentProps = {
  fileName: string
  interactionEnabled: boolean
  onStateChange: (state: CodeObjectState) => void
  state: OfficeDocumentState
  theme: CodeObjectTheme
}

function DocumentSection({ index, section }: { index: number; section: string }) {
  const key = `${index}-${section}`
  if (index === 0) {
    return (
      <h1 key={key} className="mb-8 text-[30px] leading-tight font-semibold tracking-[-0.03em]">
        {section}
      </h1>
    )
  }
  if (section === 'Principles') {
    return (
      <h2 key={key} className="mt-8 mb-3 text-[15px] font-semibold tracking-[-0.01em]">
        {section}
      </h2>
    )
  }
  return (
    <p
      key={key}
      className="mb-5 whitespace-pre-line text-[14px] leading-[1.72] text-[var(--code-text-muted)]"
    >
      {section}
    </p>
  )
}

export function Document(props: DocumentProps) {
  const source =
    typeof props.state.snapshot?.body === 'object' &&
    props.state.snapshot.body !== null &&
    'dataStream' in props.state.snapshot.body &&
    typeof props.state.snapshot.body.dataStream === 'string'
      ? props.state.snapshot.body.dataStream.replace(/\r/g, '\n').replace(/\n+$/, '')
      : props.state.seedText
  const sections = source.split(/\n{2,}/)

  return (
    <UniverSurface
      {...props}
      kind="document"
      preview={
        <article className="size-full overflow-hidden bg-[var(--code-background)] px-9 py-8 text-[var(--code-text)]">
          <div className="mx-auto min-h-full max-w-[650px] bg-[var(--code-surface-elevated)] px-[72px] py-[68px] shadow-[var(--code-shadow)]">
            {sections.map((section, index) => (
              <DocumentSection index={index} key={`${index}-${section}`} section={section} />
            ))}
          </div>
        </article>
      }
    />
  )
}
