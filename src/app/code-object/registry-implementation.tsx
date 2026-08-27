import { lazy, Suspense, type ReactNode } from 'react'

import type { ResolvedCodeObjectAppearance } from '@open-pencil/core/code-object'

import type { PdfPageImage } from '@/app/media-evidence/pdf'

import type { CodeObjectDocument, CodeObjectState } from './model'

const CodeStarter = lazy(() =>
  import('./components/CodeStarter').then(({ CodeStarter: component }) => ({ default: component }))
)
const EarthSignals = lazy(() =>
  import('./components/EarthSignals').then(({ EarthSignals: component }) => ({
    default: component
  }))
)
const ExternalLiveSurface = lazy(() =>
  import('./components/ExternalLiveSurface').then(({ ExternalLiveSurface: component }) => ({
    default: component
  }))
)
const Document = lazy(() =>
  import('./components/office/Document').then(({ Document: component }) => ({ default: component }))
)
const Spreadsheet = lazy(() =>
  import('./components/office/Spreadsheet').then(({ Spreadsheet: component }) => ({
    default: component
  }))
)
const OpenSourceWorkspace = lazy(() =>
  import('./components/OpenSourceWorkspace').then(({ OpenSourceWorkspace: component }) => ({
    default: component
  }))
)
const OrbitLab = lazy(() =>
  import('./components/OrbitLab').then(({ OrbitLab: component }) => ({ default: component }))
)
const PdfDocument = lazy(() =>
  import('./components/PdfDocument').then(({ PdfDocument: component }) => ({ default: component }))
)
const PptxDeck = lazy(() =>
  import('./components/PptxDeck').then(({ PptxDeck: component }) => ({ default: component }))
)
const SignalBloom = lazy(() =>
  import('./components/SignalBloom').then(({ SignalBloom: component }) => ({ default: component }))
)
const SmylrFlowScreen = lazy(() =>
  import('./components/SmylrFlowScreen').then(({ SmylrFlowScreen: component }) => ({
    default: component
  }))
)

function deferredCodeObject(node: ReactNode) {
  return (
    <Suspense
      fallback={
        <div
          aria-label="Loading content"
          style={{ display: 'grid', height: '100%', opacity: 0.55, placeItems: 'center' }}
        >
          Loading…
        </div>
      }
    >
      {node}
    </Suspense>
  )
}

export type CodeObjectRenderContext = {
  appearance: ResolvedCodeObjectAppearance
  document: CodeObjectDocument
  frameId: string
  interactionEnabled: boolean
  onStateChange: (state: CodeObjectState) => void
  onExtractPdfPage?: (pageNumber: number, image: PdfPageImage) => void
  sourceBytes?: Uint8Array
  sourceFileName?: string
}

export type CodeObjectCompatibilityAdapter = {
  component: CodeObjectDocument['component']
  displayName: string
  render: (context: CodeObjectRenderContext) => ReactNode
}

export function defineCodeObjectCompatibilityAdapter(
  definition: CodeObjectCompatibilityAdapter
): CodeObjectCompatibilityAdapter {
  return definition
}

const CODE_OBJECT_COMPATIBILITY_ADAPTERS = [
  defineCodeObjectCompatibilityAdapter({
    component: 'code-starter',
    displayName: 'Legacy Code Starter',
    render: ({ appearance, document, interactionEnabled, onStateChange }) =>
      document.component === 'code-starter'
        ? deferredCodeObject(
            <CodeStarter
              appearance={appearance}
              interactionEnabled={interactionEnabled}
              onStateChange={onStateChange}
              state={document.state}
            />
          )
        : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'external-live-surface',
    displayName: 'External live surface',
    render: ({ document, frameId, interactionEnabled }) =>
      document.component === 'external-live-surface'
        ? deferredCodeObject(
            <ExternalLiveSurface
              document={document}
              frameId={frameId}
              interactionEnabled={interactionEnabled}
            />
          )
        : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'earth-signals',
    displayName: 'Earth signals',
    render: ({ document, onStateChange }) =>
      document.component === 'earth-signals'
        ? deferredCodeObject(<EarthSignals onStateChange={onStateChange} state={document.state} />)
        : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'orbit-lab',
    displayName: 'Orbit lab',
    render: ({ document, onStateChange }) =>
      document.component === 'orbit-lab'
        ? deferredCodeObject(<OrbitLab onStateChange={onStateChange} state={document.state} />)
        : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'signal-bloom',
    displayName: 'Signal bloom',
    render: ({ appearance, document, onStateChange }) =>
      document.component === 'signal-bloom'
        ? deferredCodeObject(
            <SignalBloom
              appearance={appearance}
              onStateChange={onStateChange}
              state={document.state}
            />
          )
        : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'open-source-workspace',
    displayName: 'Open-source board piece',
    render: ({ document, interactionEnabled, onStateChange }) =>
      document.component === 'open-source-workspace'
        ? deferredCodeObject(
            <OpenSourceWorkspace
              interactionEnabled={interactionEnabled}
              onStateChange={onStateChange}
              state={document.state}
            />
          )
        : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'office-document',
    displayName: 'Document',
    render: ({ appearance, document, interactionEnabled, onStateChange, sourceFileName }) =>
      document.component === 'office-document'
        ? deferredCodeObject(
            <Document
              fileName={sourceFileName ?? 'Product direction.docx'}
              interactionEnabled={interactionEnabled}
              onStateChange={onStateChange}
              state={document.state}
              theme={appearance.theme}
            />
          )
        : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'office-spreadsheet',
    displayName: 'Spreadsheet',
    render: ({ appearance, document, interactionEnabled, onStateChange, sourceFileName }) =>
      document.component === 'office-spreadsheet'
        ? deferredCodeObject(
            <Spreadsheet
              fileName={sourceFileName ?? 'Planning model.xlsx'}
              interactionEnabled={interactionEnabled}
              onStateChange={onStateChange}
              state={document.state}
              theme={appearance.theme}
            />
          )
        : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'pdf-document',
    displayName: 'PDF document',
    render: ({
      document,
      interactionEnabled,
      onExtractPdfPage,
      onStateChange,
      sourceBytes,
      sourceFileName
    }) =>
      document.component === 'pdf-document'
        ? deferredCodeObject(
            <PdfDocument
              bytes={sourceBytes}
              fileName={sourceFileName ?? 'Untitled.pdf'}
              interactionEnabled={interactionEnabled}
              onExtractPage={onExtractPdfPage}
              onStateChange={onStateChange}
              state={document.state}
            />
          )
        : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'pptx-deck',
    displayName: 'PowerPoint deck',
    render: ({ document, interactionEnabled, onStateChange, sourceBytes, sourceFileName }) =>
      document.component === 'pptx-deck'
        ? deferredCodeObject(
            <PptxDeck
              bytes={sourceBytes}
              fileName={sourceFileName ?? 'Untitled presentation.pptx'}
              interactionEnabled={interactionEnabled}
              onStateChange={onStateChange}
              state={document.state}
            />
          )
        : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'smylr-flow-screen',
    displayName: 'Smylr flow screen',
    render: ({ document, onStateChange }) =>
      document.component === 'smylr-flow-screen'
        ? deferredCodeObject(<SmylrFlowScreen onStateChange={onStateChange} surface={document} />)
        : null
  })
] satisfies readonly CodeObjectCompatibilityAdapter[]

export function codeObjectCompatibilityAdapter(component: CodeObjectDocument['component']) {
  return (
    CODE_OBJECT_COMPATIBILITY_ADAPTERS.find((definition) => definition.component === component) ??
    null
  )
}

export function renderCodeObjectCompatibilityAdapter(context: CodeObjectRenderContext) {
  return codeObjectCompatibilityAdapter(context.document.component)?.render(context) ?? null
}

export function registeredCodeObjectAdapters() {
  return CODE_OBJECT_COMPATIBILITY_ADAPTERS.map(({ component, displayName }) => ({
    component,
    displayName
  }))
}
