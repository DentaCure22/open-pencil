import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import { parsePptx, type PptxDeck as ParsedPptxDeck, type PptxElement } from '@open-pencil/core/io'

import type { CodeObjectState, PptxDeckState } from '../model'

type PptxDeckProps = {
  bytes?: Uint8Array
  fileName: string
  interactionEnabled: boolean
  onStateChange: (state: CodeObjectState) => void
  state: PptxDeckState
}

type SlideSurfaceProps = {
  deck: ParsedPptxDeck
  label: string
  slideIndex: number
  thumbnail?: boolean
}

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

function percentage(value: number, total: number) {
  return `${(value / total) * 100}%`
}

function textJustification(element: Extract<PptxElement, { kind: 'text' }>) {
  if (element.verticalAlign === 'BOTTOM') return 'flex-end'
  if (element.verticalAlign === 'CENTER') return 'center'
  return 'flex-start'
}

function textAlignment(element: Extract<PptxElement, { kind: 'text' }>) {
  if (element.textAlign === 'CENTER') return 'center'
  if (element.textAlign === 'RIGHT') return 'right'
  if (element.textAlign === 'JUSTIFIED') return 'justify'
  return 'left'
}

function shapeStyle(
  element: Extract<PptxElement, { kind: 'shape' }>,
  deck: ParsedPptxDeck
): CSSProperties {
  if (element.shape === 'line') {
    const length = Math.hypot(element.width, element.height)
    const angle = Math.atan2(element.height, element.width) * (180 / Math.PI)
    return {
      backgroundColor: element.strokeColor ?? '#111827',
      height: `${Math.max(element.strokeWidth, 1)}px`,
      left: percentage(element.x, deck.width),
      position: 'absolute',
      top: percentage(element.y, deck.height),
      transform: `rotate(${angle}deg)`,
      transformOrigin: '0 50%',
      width: percentage(length, deck.width)
    }
  }
  return {
    backgroundColor: element.fillColor ?? 'transparent',
    borderColor: element.strokeColor ?? 'transparent',
    borderRadius: element.shape === 'ellipse' ? '9999px' : `${element.cornerRadius}px`,
    borderStyle: element.strokeColor ? 'solid' : 'none',
    borderWidth: `${element.strokeWidth}px`,
    height: percentage(element.height, deck.height),
    left: percentage(element.x, deck.width),
    position: 'absolute',
    top: percentage(element.y, deck.height),
    width: percentage(element.width, deck.width)
  }
}

function elementView(element: PptxElement, deck: ParsedPptxDeck, index: number) {
  if (element.kind === 'shape') {
    return <div key={`${element.name}-${index}`} style={shapeStyle(element, deck)} />
  }
  return (
    <div
      key={`${element.name}-${index}`}
      className="absolute flex overflow-hidden whitespace-pre-wrap"
      style={{
        alignItems: textJustification(element),
        backgroundColor: element.backgroundColor ?? 'transparent',
        color: element.color,
        fontFamily: element.fontFamily,
        fontSize: `${(element.fontSize / deck.width) * 100}cqw`,
        fontWeight: element.fontWeight,
        height: percentage(element.height, deck.height),
        left: percentage(element.x, deck.width),
        lineHeight: 1.15,
        overflowWrap: 'anywhere',
        textAlign: textAlignment(element),
        top: percentage(element.y, deck.height),
        width: percentage(element.width, deck.width)
      }}
    >
      <span className="w-full">{element.text}</span>
    </div>
  )
}

function SlideSurface({ deck, label, slideIndex, thumbnail = false }: SlideSurfaceProps) {
  const slide = deck.slides.at(slideIndex)
  if (!slide) return null
  return (
    <div
      aria-label={label}
      className={`relative aspect-video w-full overflow-hidden [container-type:inline-size] ${
        thumbnail ? '' : 'shadow-[0_24px_80px_rgba(0,0,0,0.34)]'
      }`}
      data-test-id={thumbnail ? 'pptx-thumbnail-slide' : 'pptx-active-slide'}
      style={{ backgroundColor: slide.backgroundColor }}
    >
      {slide.elements.map((element, index) => elementView(element, deck, index))}
    </div>
  )
}

function parseDeck(bytes?: Uint8Array) {
  if (!bytes) return null
  try {
    return parsePptx(bytes)
  } catch {
    return null
  }
}

export function PptxDeck({
  bytes,
  fileName,
  interactionEnabled,
  onStateChange,
  state
}: PptxDeckProps) {
  const deck = useMemo(() => parseDeck(bytes), [bytes])
  const [downloadUrl, setDownloadUrl] = useState('')

  const slideCount = deck?.slides.length ?? 0
  const activeSlide = Math.min(Math.max(state.activeSlide, 0), Math.max(slideCount - 1, 0))
  const goToSlide = (index: number) => {
    if (slideCount === 0) return
    const nextSlide = Math.min(slideCount - 1, Math.max(0, index))
    if (nextSlide === activeSlide) return
    onStateChange({ activeSlide: nextSlide, view: 'deck' })
  }

  useEffect(() => {
    if (!bytes) {
      setDownloadUrl('')
      return undefined
    }
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: PPTX_MIME }))
    setDownloadUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [bytes])

  if (!deck || slideCount === 0) {
    return (
      <div className="flex size-full items-center justify-center bg-[#15171c] p-8 text-center text-sm text-white/70">
        The original PowerPoint is preserved, but this deck could not be rendered.
      </div>
    )
  }

  return (
    <main
      aria-label={`${fileName}, slide ${activeSlide + 1} of ${slideCount}`}
      className="relative size-full select-none overflow-hidden bg-transparent font-sans outline-none"
      data-test-id="pptx-deck-experience"
      tabIndex={interactionEnabled ? 0 : -1}
      onKeyDown={(event) => {
        if (!interactionEnabled) return
        if (event.key === 'ArrowLeft') goToSlide(activeSlide - 1)
        if (event.key === 'ArrowRight' || event.key === ' ') goToSlide(activeSlide + 1)
      }}
    >
      {!interactionEnabled ? (
        <>
          <SlideSurface deck={deck} label={`Slide ${activeSlide + 1}`} slideIndex={activeSlide} />
          <div className="pointer-events-none absolute inset-0 ring-1 ring-black/10 ring-inset" />
        </>
      ) : (
        <div className="flex size-full bg-[#1c1e23] text-white" data-test-id="pptx-deck-controls">
          <aside
            aria-label="Slide thumbnails"
            className="w-[142px] shrink-0 overflow-y-auto border-r border-white/8 bg-[#15171b] px-2 py-3"
          >
            <div className="mb-3 truncate px-1 text-[9px] font-medium text-white/54">
              {fileName}
            </div>
            <div className="space-y-2">
              {deck.slides.map((slide, index) => (
                <button
                  key={`${slide.name}-${index}`}
                  type="button"
                  aria-label={`Open slide ${index + 1}`}
                  aria-pressed={activeSlide === index}
                  className={`block w-full rounded-md border p-1 text-left transition ${
                    activeSlide === index
                      ? 'border-[#8d74ff] bg-[#8d74ff]/12'
                      : 'border-transparent hover:border-white/18 hover:bg-white/5'
                  }`}
                  data-test-id={`pptx-slide-${index + 1}`}
                  onClick={() => goToSlide(index)}
                >
                  <SlideSurface
                    deck={deck}
                    label={`Slide ${index + 1} thumbnail`}
                    slideIndex={index}
                    thumbnail
                  />
                  <span className="mt-1 block px-0.5 text-[9px] tabular-nums text-white/52">
                    {index + 1}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/8 bg-[#202228] px-3">
              <div className="min-w-0">
                <div className="truncate text-[10px] font-medium text-white/82">{fileName}</div>
                <div className="text-[8px] text-white/38">PowerPoint · source preserved</div>
              </div>
              {downloadUrl ? (
                <a
                  className="ml-3 shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-medium text-white/66 transition hover:bg-white/10 hover:text-white"
                  data-test-id="pptx-download"
                  download={fileName}
                  href={downloadUrl}
                >
                  Download original
                </a>
              ) : null}
            </header>

            <div className="flex min-h-0 flex-1 items-center justify-center bg-[#282b31] p-5">
              <div className="w-full max-w-[92%]">
                <SlideSurface
                  deck={deck}
                  label={`Slide ${activeSlide + 1}`}
                  slideIndex={activeSlide}
                />
              </div>
            </div>

            <footer className="flex h-8 shrink-0 items-center justify-between border-t border-white/8 bg-[#202228] px-3">
              <span className="text-[9px] tabular-nums text-white/45">
                Slide {activeSlide + 1} of {slideCount}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous slide"
                  className="rounded px-2 py-1 text-[9px] font-medium text-white/60 transition hover:bg-white/8 hover:text-white disabled:opacity-25"
                  disabled={activeSlide === 0}
                  onClick={() => goToSlide(activeSlide - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  aria-label="Next slide"
                  className="rounded px-2 py-1 text-[9px] font-medium text-white/60 transition hover:bg-white/8 hover:text-white disabled:opacity-25"
                  disabled={activeSlide === slideCount - 1}
                  onClick={() => goToSlide(activeSlide + 1)}
                >
                  Next
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </main>
  )
}
