import * as React from 'react'
import { Component, type ComponentType, type ErrorInfo, type ReactNode, useMemo } from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import { transform } from 'sucrase'

import {
  CODE_OBJECT_BOARD_API_VERSION,
  type CodeObjectBoardClient,
  type CodeObjectConnectionDescriptor,
  type DispatchCodeObjectBoardAction
} from '@/app/code-object/contracts'
import type { CodeObjectDocument, CodeObjectState } from '@/app/code-object/model'

export type AuthoredCodeObjectProps = {
  board: CodeObjectBoardClient
  boardApiVersion: typeof CODE_OBJECT_BOARD_API_VERSION
  connections: CodeObjectConnectionDescriptor[]
  dispatchBoardAction: DispatchCodeObjectBoardAction
  interactionEnabled: boolean
  props: Record<string, unknown>
  renderComponent: () => ReactNode
  setState: (next: CodeObjectState | ((current: CodeObjectState) => CodeObjectState)) => void
  state: CodeObjectState
}

type CompiledCodeObject =
  | { component: ComponentType<AuthoredCodeObjectProps>; error: null }
  | { component: null; error: string }

type CodeObjectExports = { default?: unknown; [name: string]: unknown }
type CodeObjectModule = { ['exports']: CodeObjectExports }

type CodeObjectErrorBoundaryProps = {
  children: ReactNode
  resetKey: string
}

type CodeObjectErrorBoundaryState = {
  error: string | null
}

const compiledSources = new Map<string, CompiledCodeObject>()

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

function codeObjectRequire(moduleId: string): unknown {
  if (moduleId === 'react') return React
  if (moduleId === 'react/jsx-runtime') return ReactJsxRuntime
  throw new Error(
    `Code Objects can only import "react" and "react/jsx-runtime"; received "${moduleId}".`
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
    console.warn('[Code Object] render failed', error, info.componentStack)
  }

  componentDidUpdate(previous: CodeObjectErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
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

export function AuthoredCodeObject({
  board,
  dispatchBoardAction,
  document,
  interactionEnabled,
  onStateChange,
  renderComponent
}: {
  board: CodeObjectBoardClient
  dispatchBoardAction: DispatchCodeObjectBoardAction
  document: CodeObjectDocument
  interactionEnabled: boolean
  onStateChange: (state: CodeObjectState) => void
  renderComponent: () => ReactNode
}) {
  const compiled = useMemo(() => compileCodeObjectSource(document.source), [document.source])
  if (!compiled.component) return <CodeObjectError message={compiled.error} />
  const AuthoredComponent = compiled.component
  const setState: AuthoredCodeObjectProps['setState'] = (next) => {
    const resolved = typeof next === 'function' ? next(document.state) : next
    onStateChange(structuredClone(resolved))
  }
  return (
    <CodeObjectErrorBoundary resetKey={document.source}>
      <AuthoredComponent
        board={board}
        boardApiVersion={CODE_OBJECT_BOARD_API_VERSION}
        connections={board.connections}
        dispatchBoardAction={dispatchBoardAction}
        interactionEnabled={interactionEnabled}
        props={document.props}
        renderComponent={renderComponent}
        setState={setState}
        state={document.state}
      />
    </CodeObjectErrorBoundary>
  )
}
