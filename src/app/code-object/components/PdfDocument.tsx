import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { useEffect, useRef, useState } from 'react'

import type { PdfPageImage } from '@/app/media-evidence/pdf'

import type { PdfDocumentState } from '../model'

type PdfDocumentProps = {
  bytes?: Uint8Array
  fileName: string
  interactionEnabled: boolean
  onExtractPage?: (pageNumber: number, image: PdfPageImage) => void
  onStateChange: (state: PdfDocumentState) => void
  state: PdfDocumentState
}

type PdfStatus = 'error' | 'loading' | 'ready'

function isCancelled(error: unknown) {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}

export function PdfDocument({
  bytes,
  fileName,
  interactionEnabled,
  onExtractPage,
  onStateChange,
  state
}: PdfDocumentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const onStateChangeRef = useRef(onStateChange)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const activePageRef = useRef(state.activePage)
  const [pageCount, setPageCount] = useState(0)
  const [status, setStatus] = useState<PdfStatus>('loading')
  const [message, setMessage] = useState('Loading PDF preview')
  const [sourceUrl, setSourceUrl] = useState('')
  const [extracting, setExtracting] = useState(false)

  onStateChangeRef.current = onStateChange
  activePageRef.current = state.activePage

  useEffect(() => {
    if (!bytes?.byteLength) {
      setSourceUrl('')
      return undefined
    }
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }))
    setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [bytes])

  useEffect(() => {
    let disposed = false
    const sourceBytes = bytes
    setPageCount(0)
    setStatus('loading')
    setMessage('Loading PDF preview')
    if (!sourceBytes?.byteLength) {
      setStatus('error')
      setMessage('This PDF has no source data.')
      return undefined
    }

    void import('@/app/media-evidence/pdf')
      .then(({ startPdfDocumentLoad }) => {
        if (disposed) return null
        const task = startPdfDocumentLoad(sourceBytes)
        loadingTaskRef.current = task
        return task.promise
      })
      .then((loaded) => {
        if (!loaded) return null
        if (disposed) {
          void loaded.destroy()
          return null
        }
        pdfRef.current = loaded
        loadingTaskRef.current = null
        setPageCount(loaded.numPages)
        const activePage = Math.min(loaded.numPages, Math.max(1, activePageRef.current))
        if (activePage !== activePageRef.current) {
          onStateChangeRef.current({ activePage, view: 'pdf' })
        }
        return null
      })
      .catch(() => {
        if (disposed) return
        loadingTaskRef.current = null
        setStatus('error')
        setMessage('This PDF could not be decoded.')
      })

    return () => {
      disposed = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
      const loaded = pdfRef.current
      pdfRef.current = null
      if (loaded) void loaded.destroy()
      else if (loadingTaskRef.current) void loadingTaskRef.current.destroy()
      loadingTaskRef.current = null
    }
  }, [bytes])

  useEffect(() => {
    const pdf = pdfRef.current
    const canvas = canvasRef.current
    if (!pdf || !canvas || pageCount === 0) return undefined
    let disposed = false
    const isDisposed = () => disposed
    renderTaskRef.current?.cancel()
    renderTaskRef.current = null
    setStatus('loading')
    setMessage('Loading PDF preview')
    void import('@/app/media-evidence/pdf')
      .then(({ startPdfPageRender }) => startPdfPageRender(pdf, state.activePage, canvas))
      .then(async (task) => {
        if (disposed) {
          task.cancel()
          return null
        }
        renderTaskRef.current = task
        await task.promise
        if (isDisposed()) return null
        setStatus('ready')
        return null
      })
      .catch((error) => {
        if (!disposed && !isCancelled(error)) {
          setStatus('error')
          setMessage('This page could not be rendered.')
        }
      })
      .finally(() => {
        if (!disposed) renderTaskRef.current = null
      })
    return () => {
      disposed = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
    }
  }, [pageCount, state.activePage])

  function goToPage(page: number) {
    if (!interactionEnabled || pageCount === 0) return
    const activePage = Math.min(pageCount, Math.max(1, Math.round(page)))
    if (activePage !== state.activePage) onStateChange({ activePage, view: 'pdf' })
  }

  async function extractPage() {
    const pdf = pdfRef.current
    if (!pdf || !onExtractPage || extracting || status !== 'ready') return
    setExtracting(true)
    try {
      const { extractPdfPageImage } = await import('@/app/media-evidence/pdf')
      onExtractPage(state.activePage, await extractPdfPageImage(pdf, state.activePage, fileName))
    } finally {
      setExtracting(false)
    }
  }

  return (
    <main
      data-test-id="code-object-pdf"
      style={{
        boxSizing: 'border-box',
        minHeight: '100%',
        color: '#f1f1f3',
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        background: '#0e0f12'
      }}
    >
      <header
        style={{
          height: 42,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '0 14px',
          borderBottom: '1px solid #ffffff14',
          background: '#17181d'
        }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {fileName}
        </span>
        <span style={{ color: '#aaa0d2', fontSize: 10, fontWeight: 800 }}>PDF · CODE OBJECT</span>
      </header>
      <section
        data-test-id="code-object-pdf-viewer"
        style={{
          position: 'relative',
          height: 'calc(100% - 42px)',
          minHeight: 420,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: '14px 14px 58px',
          boxSizing: 'border-box',
          background: '#d8d7d3'
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label={`PDF page ${state.activePage} of ${pageCount}: ${fileName}`}
          data-test-id="code-object-pdf-canvas"
          role="img"
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            background: 'white',
            boxShadow: '0 2px 14px rgba(0,0,0,0.16)'
          }}
        />
        {status !== 'ready' ? (
          <div
            data-test-id="code-object-pdf-status"
            role={status === 'error' ? 'alert' : 'status'}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              padding: 24,
              color: '#d7d4e2',
              background: '#111218ee',
              fontSize: 12
            }}
          >
            <div style={{ display: 'grid', justifyItems: 'center', gap: 10 }}>
              <span>{message}</span>
              {status === 'error' && sourceUrl ? (
                <a
                  aria-label={`Open source PDF: ${fileName}`}
                  href={sourceUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Open source PDF
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
        {pageCount > 0 ? (
          <div
            data-test-id="code-object-pdf-controls"
            style={{
              position: 'absolute',
              right: 14,
              bottom: 14,
              left: 14,
              height: 38,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '0 9px',
              border: '1px solid #0000001a',
              borderRadius: 8,
              color: 'white',
              background: '#17181def',
              fontSize: 11
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                aria-label={`Previous PDF page, currently page ${state.activePage} of ${pageCount}`}
                disabled={!interactionEnabled || state.activePage <= 1 || status === 'loading'}
                onClick={() => goToPage(state.activePage - 1)}
                type="button"
              >
                Previous
              </button>
              <span>
                {state.activePage} / {pageCount}
              </span>
              <button
                aria-label={`Next PDF page, currently page ${state.activePage} of ${pageCount}`}
                disabled={
                  !interactionEnabled || state.activePage >= pageCount || status === 'loading'
                }
                onClick={() => goToPage(state.activePage + 1)}
                type="button"
              >
                Next
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              {sourceUrl ? (
                <a
                  aria-label={`Open source PDF: ${fileName}`}
                  href={sourceUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Source
                </a>
              ) : null}
              {onExtractPage ? (
                <button
                  disabled={!interactionEnabled || extracting || status !== 'ready'}
                  onClick={() => void extractPage()}
                  type="button"
                >
                  {extracting ? 'Extracting…' : `Extract page ${state.activePage}`}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  )
}
