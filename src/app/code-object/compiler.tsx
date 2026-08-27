import * as D3 from 'd3'
import * as React from 'react'
import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  useLayoutEffect,
  useMemo
} from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import { transform } from 'sucrase'

import {
  normalizeCodeObjectSurface,
  type CodeObjectSurface,
  type ResolvedCodeObjectAppearance
} from '@open-pencil/core/code-object'

import {
  CODE_OBJECT_BOARD_API_VERSION,
  type CodeObjectBoardClient,
  type DispatchCodeObjectBoardAction
} from '@/app/code-object/contracts'
import type { CodeObjectDocument, CodeObjectState } from '@/app/code-object/model'
import * as CodeObjectUi from '@/app/code-object/ui-runtime'

export type AuthoredCodeObjectProps = {
  appearance: ResolvedCodeObjectAppearance
  board: CodeObjectBoardClient
  boardApiVersion: typeof CODE_OBJECT_BOARD_API_VERSION
  dispatchBoardAction: DispatchCodeObjectBoardAction
  interactionEnabled: boolean
  props: Record<string, unknown>
  renderComponent: () => ReactNode
  setState: (next: CodeObjectState | ((current: CodeObjectState) => CodeObjectState)) => void
  state: CodeObjectState
  surface: CodeObjectSurface
  theme: 'dark' | 'light'
}

type CompiledCodeObject =
  | { component: ComponentType<AuthoredCodeObjectProps>; error: null }
  | { component: null; error: string }

type CodeObjectExports = { default?: unknown; [name: string]: unknown }
type CodeObjectModule = { ['exports']: CodeObjectExports }

type CodeObjectErrorBoundaryProps = {
  children: ReactNode
  frameId: string
  generation: number
  source: string
}

type CodeObjectErrorBoundaryState = {
  error: string | null
}

const compiledSources = new Map<string, CompiledCodeObject>()

type CodeObjectRuntimeRenderRecord = {
  error?: string
  generation: number
  mounted: boolean
  source: string
  status: 'error' | 'pending' | 'rendered'
}

export type CodeObjectRuntimeRenderAcknowledgement =
  | { error: string; generation: number; mounted: boolean; status: 'error' }
  | { generation: number | null; mounted: boolean; status: 'timeout' }
  | { generation: number; mounted: true; status: 'rendered' }
  | { generation: null; mounted: false; status: 'unavailable' }

export type WaitForCodeObjectRuntimeRender = (
  frameId: string,
  source: string,
  afterGeneration?: number
) => Promise<CodeObjectRuntimeRenderAcknowledgement>

const runtimeRenderRecords = new Map<string, CodeObjectRuntimeRenderRecord>()
const runtimeRenderListeners = new Map<string, Set<() => void>>()
const RUNTIME_RENDER_ACKNOWLEDGEMENT_TIMEOUT_MS = 1_500
let runtimeRenderGeneration = 0

function notifyRuntimeRenderListeners(frameId: string): void {
  for (const listener of runtimeRenderListeners.get(frameId) ?? []) listener()
}

function setRuntimeRenderRecord(frameId: string, record: CodeObjectRuntimeRenderRecord): void {
  runtimeRenderRecords.set(frameId, record)
  notifyRuntimeRenderListeners(frameId)
}

export function beginCodeObjectRuntimeRender(
  frameId: string,
  source: string,
  mounted = runtimeRenderRecords.get(frameId)?.mounted ?? false
): number {
  runtimeRenderGeneration += 1
  const generation = runtimeRenderGeneration
  setRuntimeRenderRecord(frameId, {
    generation,
    mounted,
    source,
    status: 'pending'
  })
  return generation
}

export function currentCodeObjectRuntimeRenderGeneration(frameId: string): number | null {
  return runtimeRenderRecords.get(frameId)?.generation ?? null
}

export function acknowledgeCodeObjectRuntimeMount(frameId: string, mounted: boolean): void {
  const current = runtimeRenderRecords.get(frameId)
  if (!current || current.mounted === mounted) return
  setRuntimeRenderRecord(frameId, { ...current, mounted })
}

export function acknowledgeCodeObjectRuntimeRender(
  frameId: string,
  generation: number,
  source: string,
  error?: string
): void {
  const current = runtimeRenderRecords.get(frameId)
  if (!current || current.generation !== generation || current.source !== source) return
  setRuntimeRenderRecord(frameId, {
    ...(error ? { error } : {}),
    generation,
    mounted: current.mounted,
    source,
    status: error ? 'error' : 'rendered'
  })
}

export function clearCodeObjectRuntimeRender(frameId: string): void {
  runtimeRenderRecords.delete(frameId)
  notifyRuntimeRenderListeners(frameId)
  runtimeRenderListeners.delete(frameId)
}

function resolvedRuntimeRenderAcknowledgement(
  frameId: string,
  source: string,
  afterGeneration: number
): CodeObjectRuntimeRenderAcknowledgement | null {
  const current = runtimeRenderRecords.get(frameId)
  if (!current || current.generation <= afterGeneration || current.source !== source) return null
  if (current.status === 'error') {
    return {
      error: current.error ?? 'Code Object render failed.',
      generation: current.generation,
      mounted: current.mounted,
      status: 'error'
    }
  }
  return current.status === 'rendered' && current.mounted
    ? { generation: current.generation, mounted: true, status: 'rendered' }
    : null
}

export function waitForCodeObjectRuntimeRender(
  frameId: string,
  source: string,
  afterGeneration = -1
): Promise<CodeObjectRuntimeRenderAcknowledgement> {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return Promise.resolve({ generation: null, mounted: false, status: 'unavailable' })
  }
  const resolved = resolvedRuntimeRenderAcknowledgement(frameId, source, afterGeneration)
  if (resolved) return Promise.resolve(resolved)

  return new Promise((resolve) => {
    const listeners = runtimeRenderListeners.get(frameId) ?? new Set<() => void>()
    let settled = false
    const finish = (result: CodeObjectRuntimeRenderAcknowledgement) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      listeners.delete(check)
      if (listeners.size === 0) runtimeRenderListeners.delete(frameId)
      resolve(result)
    }
    const check = () => {
      const next = resolvedRuntimeRenderAcknowledgement(frameId, source, afterGeneration)
      if (next) finish(next)
    }
    listeners.add(check)
    runtimeRenderListeners.set(frameId, listeners)
    const timeout = setTimeout(() => {
      finish({
        generation: runtimeRenderRecords.get(frameId)?.generation ?? null,
        mounted: runtimeRenderRecords.get(frameId)?.mounted ?? false,
        status: 'timeout'
      })
    }, RUNTIME_RENDER_ACKNOWLEDGEMENT_TIMEOUT_MS)
    check()
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

function codeObjectRequire(moduleId: string): unknown {
  if (moduleId === '@open-pencil/code-object-ui') return CodeObjectUi
  if (moduleId === 'd3') return D3
  if (moduleId === 'react') return React
  if (moduleId === 'react/jsx-runtime') return ReactJsxRuntime
  throw new Error(
    `Code Objects can only import "@open-pencil/code-object-ui", "d3", "react", and "react/jsx-runtime"; received "${moduleId}".`
  )
}

export function compileCodeObjectSource(source: string): CompiledCodeObject {
  const cached = compiledSources.get(source)
  if (cached) return cached
  try {
    const compiled = transform(source, {
      production: true,
      transforms: ['typescript', 'jsx', 'imports']
    }).code
    const exportRecord: CodeObjectExports = {}
    const moduleRecord: CodeObjectModule = { exports: exportRecord }
    // oxlint-disable-next-line typescript-eslint/no-implied-eval -- The owned Code Object runtime compiles trusted authored TSX.
    const evaluate = new Function(
      'module',
      'exports',
      'require',
      'React',
      `${compiled}\nreturn module.exports.default ?? exports.default`
    ) as (
      module: CodeObjectModule,
      exports: CodeObjectExports,
      require: (moduleId: string) => unknown,
      react: typeof React
    ) => unknown
    const evaluated = evaluate(moduleRecord, exportRecord, codeObjectRequire, React)
    const namedComponents = Object.entries(moduleRecord.exports)
      .filter(([name, value]) => name !== 'default' && typeof value === 'function')
      .map(([, value]) => value)
    const candidate = evaluated ?? (namedComponents.length === 1 ? namedComponents[0] : null)
    if (typeof candidate !== 'function') {
      throw new TypeError('A Code Object must export one React component.')
    }
    const result: CompiledCodeObject = {
      component: candidate as ComponentType<AuthoredCodeObjectProps>,
      error: null
    }
    compiledSources.set(source, result)
    return result
  } catch (error) {
    const result: CompiledCodeObject = { component: null, error: errorMessage(error) }
    compiledSources.set(source, result)
    return result
  }
}

export function clearCompiledCodeObjectCache(): void {
  compiledSources.clear()
}

class CodeObjectErrorBoundary extends Component<
  CodeObjectErrorBoundaryProps,
  CodeObjectErrorBoundaryState
> {
  state: CodeObjectErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): CodeObjectErrorBoundaryState {
    return { error: errorMessage(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    acknowledgeCodeObjectRuntimeRender(
      this.props.frameId,
      this.props.generation,
      this.props.source,
      errorMessage(error)
    )
    console.warn('[Code Object] render failed', error, info.componentStack)
  }

  componentDidUpdate(previous: CodeObjectErrorBoundaryProps): void {
    if (previous.generation !== this.props.generation && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    if (this.state.error) return <CodeObjectError message={this.state.error} />
    return this.props.children
  }
}

function CodeObjectError({ message }: { message: string }) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        height: '100%',
        overflow: 'auto',
        padding: 24,
        color: '#fecaca',
        background: '#1c1114',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
      }}
    >
      <strong style={{ display: 'block', marginBottom: 8 }}>Code Object error</strong>
      <span style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{message}</span>
    </div>
  )
}

function CodeObjectRenderAcknowledgement({
  frameId,
  generation,
  source
}: {
  frameId: string
  generation: number
  source: string
}) {
  useLayoutEffect(() => {
    acknowledgeCodeObjectRuntimeRender(frameId, generation, source)
  }, [frameId, generation, source])
  return null
}

function CodeObjectCompileFailure({
  error,
  frameId,
  generation,
  source
}: {
  error: string
  frameId: string
  generation: number
  source: string
}) {
  useLayoutEffect(() => {
    acknowledgeCodeObjectRuntimeRender(frameId, generation, source, error)
  }, [error, frameId, generation, source])
  return <CodeObjectError message={error} />
}

export function AuthoredCodeObject({
  appearance,
  board,
  dispatchBoardAction,
  document,
  frameId,
  generation,
  interactionEnabled,
  onStateChange,
  renderComponent,
  theme
}: {
  appearance: ResolvedCodeObjectAppearance
  board: CodeObjectBoardClient
  dispatchBoardAction: DispatchCodeObjectBoardAction
  document: CodeObjectDocument
  frameId: string
  generation: number
  interactionEnabled: boolean
  onStateChange: (state: CodeObjectState) => void
  renderComponent: () => ReactNode
  theme: 'dark' | 'light'
}) {
  const compiled = useMemo(() => compileCodeObjectSource(document.source), [document.source])
  if (!compiled.component) {
    return (
      <CodeObjectCompileFailure
        error={compiled.error}
        frameId={frameId}
        generation={generation}
        source={document.source}
      />
    )
  }
  const AuthoredComponent = compiled.component
  const setState: AuthoredCodeObjectProps['setState'] = (next) => {
    const resolved = typeof next === 'function' ? next(document.state) : next
    onStateChange(structuredClone(resolved))
  }
  return (
    <CodeObjectErrorBoundary frameId={frameId} generation={generation} source={document.source}>
      <AuthoredComponent
        appearance={appearance}
        board={board}
        boardApiVersion={CODE_OBJECT_BOARD_API_VERSION}
        dispatchBoardAction={dispatchBoardAction}
        interactionEnabled={interactionEnabled}
        props={document.props}
        renderComponent={renderComponent}
        setState={setState}
        state={document.state}
        surface={normalizeCodeObjectSurface(document.surface)}
        theme={theme}
      />
      <CodeObjectRenderAcknowledgement
        frameId={frameId}
        generation={generation}
        source={document.source}
      />
    </CodeObjectErrorBoundary>
  )
}
