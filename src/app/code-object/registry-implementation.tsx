import type { ReactNode } from 'react'

import type { PdfPageImage } from '@/app/media-evidence/pdf'

import { CodeStarter } from './components/CodeStarter'
import { EarthSignals } from './components/EarthSignals'
import { Document } from './components/office/Document'
import { Spreadsheet } from './components/office/Spreadsheet'
import { OpenSourceWorkspace } from './components/OpenSourceWorkspace'
import { OrbitLab } from './components/OrbitLab'
import { PdfDocument } from './components/PdfDocument'
import { PptxDeck } from './components/PptxDeck'
import { SignalBloom } from './components/SignalBloom'
import { SmylrFlowScreen } from './components/SmylrFlowScreen'
import type { CodeObjectDocument, CodeObjectState } from './model'

export type CodeObjectRenderContext = {
  document: CodeObjectDocument
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
    render: ({ document, interactionEnabled, onStateChange }) =>
      document.component === 'code-starter' ? (
        <CodeStarter
          interactionEnabled={interactionEnabled}
          onStateChange={onStateChange}
          state={document.state}
        />
      ) : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'earth-signals',
    displayName: 'Earth signals',
    render: ({ document, onStateChange }) =>
      document.component === 'earth-signals' ? (
        <EarthSignals onStateChange={onStateChange} state={document.state} />
      ) : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'orbit-lab',
    displayName: 'Orbit lab',
    render: ({ document, onStateChange }) =>
      document.component === 'orbit-lab' ? (
        <OrbitLab onStateChange={onStateChange} state={document.state} />
      ) : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'signal-bloom',
    displayName: 'Signal bloom',
    render: ({ document, onStateChange }) =>
      document.component === 'signal-bloom' ? (
        <SignalBloom onStateChange={onStateChange} state={document.state} />
      ) : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'open-source-workspace',
    displayName: 'Open-source board piece',
    render: ({ document, interactionEnabled, onStateChange }) =>
      document.component === 'open-source-workspace' ? (
        <OpenSourceWorkspace
          interactionEnabled={interactionEnabled}
          onStateChange={onStateChange}
          state={document.state}
        />
      ) : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'office-document',
    displayName: 'Document',
    render: ({ document, interactionEnabled, onStateChange, sourceFileName }) =>
      document.component === 'office-document' ? (
        <Document
          fileName={sourceFileName ?? 'Product direction.docx'}
          interactionEnabled={interactionEnabled}
          onStateChange={onStateChange}
          state={document.state}
        />
      ) : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'office-spreadsheet',
    displayName: 'Spreadsheet',
    render: ({ document, interactionEnabled, onStateChange, sourceFileName }) =>
      document.component === 'office-spreadsheet' ? (
        <Spreadsheet
          fileName={sourceFileName ?? 'Planning model.xlsx'}
          interactionEnabled={interactionEnabled}
          onStateChange={onStateChange}
          state={document.state}
        />
      ) : null
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
      document.component === 'pdf-document' ? (
        <PdfDocument
          bytes={sourceBytes}
          fileName={sourceFileName ?? 'Untitled.pdf'}
          interactionEnabled={interactionEnabled}
          onExtractPage={onExtractPdfPage}
          onStateChange={onStateChange}
          state={document.state}
        />
      ) : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'pptx-deck',
    displayName: 'PowerPoint deck',
    render: ({ document, interactionEnabled, onStateChange, sourceBytes, sourceFileName }) =>
      document.component === 'pptx-deck' ? (
        <PptxDeck
          bytes={sourceBytes}
          fileName={sourceFileName ?? 'Untitled presentation.pptx'}
          interactionEnabled={interactionEnabled}
          onStateChange={onStateChange}
          state={document.state}
        />
      ) : null
  }),
  defineCodeObjectCompatibilityAdapter({
    component: 'smylr-flow-screen',
    displayName: 'Smylr flow screen',
    render: ({ document, onStateChange }) =>
      document.component === 'smylr-flow-screen' ? (
        <SmylrFlowScreen onStateChange={onStateChange} surface={document} />
      ) : null
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
