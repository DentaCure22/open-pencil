import type { CodeObjectState, OfficeDocumentState } from '@/app/code-object/model'

import { UniverSurface } from './UniverSurface'

type DocumentProps = {
  fileName: string
  interactionEnabled: boolean
  onStateChange: (state: CodeObjectState) => void
  state: OfficeDocumentState
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
    <p key={key} className="mb-5 whitespace-pre-line text-[14px] leading-[1.72] text-[#3b465c]">
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
        <article className="size-full overflow-hidden bg-[#e8eaee] px-9 py-8 text-[#172033]">
          <div className="mx-auto min-h-full max-w-[650px] bg-white px-[72px] py-[68px] shadow-[0_2px_16px_rgba(15,23,42,0.12)]">
            {sections.map((section, index) => (
              <DocumentSection index={index} key={`${index}-${section}`} section={section} />
            ))}
          </div>
        </article>
      }
    />
  )
}
