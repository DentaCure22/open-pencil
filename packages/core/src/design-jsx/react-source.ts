import { transform } from 'sucrase'

const REACT_FRAGMENT = Symbol.for('open-pencil.react-source.fragment')

export type ReactSourceNode = ReactSourceElement | string | number | null | ReactSourceNode[]

export interface ReactSourceElement {
  type: 'element'
  tagName: string
  props: Record<string, unknown>
  children: ReactSourceNode[]
  componentName: string | null
}

export interface ReactSourceState {
  index: number
  initialValue: unknown
  value: unknown
}

export interface ReactSourceEvaluation {
  children: ReactSourceNode[]
  componentName: string
  states: ReactSourceState[]
  warnings: string[]
}

export interface EvaluateReactSourceOptions {
  componentName?: string
  stateValues?: unknown[]
}

type ReactSourceComponent = (props: Record<string, unknown>) => ReactSourceNode
type ReactSourceTag = string | ReactSourceComponent | typeof REACT_FRAGMENT

interface ReactSourceModule {
  moduleExports: Record<string, unknown>
}

interface ReactSourceRuntimeContext {
  componentStack: string[]
  hookIndex: number
  states: ReactSourceState[]
  stateValues: unknown[]
  warnings: string[]
}

function componentNameFor(component: ReactSourceComponent): string {
  return component.name || 'AnonymousComponent'
}

function normalizeChildren(children: ReactSourceNode[]): ReactSourceNode[] {
  const normalized: ReactSourceNode[] = []
  const append = (child: ReactSourceNode): void => {
    if (child === null || child === undefined || typeof child === 'boolean') return
    if (Array.isArray(child)) {
      for (const item of child) append(item)
      return
    }
    normalized.push(child)
  }
  for (const child of children) append(child)
  return normalized
}

function unsupportedComponent(
  moduleId: string,
  exportName: string,
  context: ReactSourceRuntimeContext
): ReactSourceComponent {
  const component = (props: Record<string, unknown>): ReactSourceElement => ({
    type: 'element',
    tagName: 'div',
    props: {
      ...props,
      'data-open-pencil-unsupported-component': `${moduleId}:${exportName}`
    },
    children: normalizeChildren((props.children as ReactSourceNode[]) ?? []),
    componentName: exportName
  })
  Object.defineProperty(component, 'name', { value: exportName, configurable: true })
  context.warnings.push(
    `Imported component ${exportName} from "${moduleId}" was retained as an editable fallback frame.`
  )
  return component
}

function unsupportedModule(moduleId: string, context: ReactSourceRuntimeContext): object {
  const fallback = unsupportedComponent(moduleId, 'default', context)
  return new Proxy(fallback, {
    get(_target, property) {
      if (property === '__esModule') return false
      if (property === 'default') return fallback
      if (typeof property !== 'string') return undefined
      return unsupportedComponent(moduleId, property, context)
    }
  })
}

function stateValue(
  initialValue: unknown | (() => unknown),
  context: ReactSourceRuntimeContext
): unknown {
  const index = context.hookIndex
  context.hookIndex += 1
  const initial =
    typeof initialValue === 'function' ? (initialValue as () => unknown)() : initialValue
  const value = index < context.stateValues.length ? context.stateValues[index] : initial
  context.states.push({ index, initialValue: initial, value })
  return value
}

function createReactRuntime(context: ReactSourceRuntimeContext) {
  const createElement = (
    tag: ReactSourceTag,
    props: Record<string, unknown> | null,
    ...children: ReactSourceNode[]
  ): ReactSourceNode => {
    const normalizedChildren = normalizeChildren(children)
    if (tag === REACT_FRAGMENT) return normalizedChildren

    const elementProps = {
      ...props,
      children: normalizedChildren.length > 0 ? normalizedChildren : undefined
    }

    if (typeof tag === 'function') {
      const name = componentNameFor(tag)
      context.componentStack.push(name)
      try {
        return tag(elementProps)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        context.warnings.push(`${name} could not be evaluated: ${message}`)
        return {
          type: 'element',
          tagName: 'div',
          props: {
            'data-open-pencil-unsupported-component': name,
            'data-open-pencil-unsupported-reason': message
          },
          children: [`${name} (unsupported)`],
          componentName: name
        }
      } finally {
        context.componentStack.pop()
      }
    }

    return {
      type: 'element',
      tagName: tag,
      props: elementProps,
      children: normalizedChildren,
      componentName: context.componentStack.at(-1) ?? null
    }
  }

  const runtime = {
    Fragment: REACT_FRAGMENT,
    Children: { toArray: (children: ReactSourceNode) => normalizeChildren([children]) },
    cloneElement: (
      element: ReactSourceElement,
      props: Record<string, unknown> | null,
      ...children: ReactSourceNode[]
    ) =>
      createElement(
        element.tagName,
        { ...element.props, ...props },
        ...(children.length ? children : element.children)
      ),
    createElement,
    jsx: (tag: ReactSourceTag, props: Record<string, unknown>) =>
      createElement(tag, props, ...normalizeChildren([props.children as ReactSourceNode])),
    jsxs: (tag: ReactSourceTag, props: Record<string, unknown>) =>
      createElement(tag, props, ...normalizeChildren([props.children as ReactSourceNode])),
    useCallback: <T>(callback: T): T => callback,
    useId: (): string => `open-pencil-react-${context.hookIndex++}`,
    useMemo: <T>(factory: () => T): T => factory(),
    useRef: <T>(value: T): { current: T } => ({ current: value }),
    useState: (initialValue: unknown | (() => unknown)) =>
      [stateValue(initialValue, context), () => undefined] as const
  }

  return runtime
}

function sourceWithDefaultExport(source: string): string {
  if (/\bexport\s+default\b/.test(source)) return source
  if (/^\s*[<(]/.test(source)) {
    return `export default function OpenPencilReactSource() { return (${source}) }`
  }

  const componentNames = [
    ...source.matchAll(/\b(?:function|const|let|var)\s+([A-Z][A-Za-z0-9_$]*)/g)
  ]
  const componentName = componentNames.at(-1)?.[1]
  if (!componentName) {
    throw new TypeError('React source needs a default component export or one PascalCase component')
  }
  return `${source}\nexport default ${componentName}`
}

function componentExport(
  exports: Record<string, unknown>,
  requestedName: string | undefined
): ReactSourceComponent {
  const candidate = requestedName ? exports[requestedName] : exports.default
  if (typeof candidate === 'function') return candidate as ReactSourceComponent

  const firstComponent = Object.values(exports).find((value) => typeof value === 'function')
  if (typeof firstComponent === 'function') return firstComponent as ReactSourceComponent
  throw new TypeError('React source did not export a renderable component')
}

/**
 * Evaluate a trusted, self-contained React/TSX module into a neutral element tree.
 * React itself and common render-only hooks are provided by a small deterministic runtime.
 * External component imports become labelled fallback frames instead of pretending to render.
 */
export function evaluateReactSource(
  source: string,
  options: EvaluateReactSourceOptions = {}
): ReactSourceEvaluation {
  const context: ReactSourceRuntimeContext = {
    componentStack: [],
    hookIndex: 0,
    states: [],
    stateValues: options.stateValues ?? [],
    warnings: []
  }
  const React = createReactRuntime(context)
  const moduleRecord: ReactSourceModule = { moduleExports: {} }
  Object.defineProperty(moduleRecord, 'exports', {
    configurable: false,
    enumerable: false,
    get: () => moduleRecord.moduleExports,
    set: (value: Record<string, unknown>) => {
      moduleRecord.moduleExports = value
    }
  })
  const requireModule = (moduleId: string): object => {
    if (moduleId === 'react' || moduleId === 'react/jsx-runtime') return React
    if (/\.(?:css|scss|sass|less)$/.test(moduleId)) return {}
    return unsupportedModule(moduleId, context)
  }
  const transformed = transform(sourceWithDefaultExport(source), {
    transforms: ['typescript', 'jsx', 'imports'],
    jsxPragma: '__h',
    jsxFragmentPragma: '__Fragment',
    production: true
  }).code

  // React source import is an explicit trusted-source feature, matching the existing design JSX
  // evaluator. It is not a security sandbox for third-party code.
  // eslint-disable-next-line typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', '__h', '__Fragment', transformed)(
    moduleRecord,
    moduleRecord.moduleExports,
    requireModule,
    React.createElement,
    React.Fragment
  )

  const Component = componentExport(moduleRecord.moduleExports, options.componentName)
  const componentName = componentNameFor(Component)
  const rendered = React.createElement(Component, null)
  return {
    children: normalizeChildren([rendered]),
    componentName,
    states: context.states,
    warnings: [...new Set(context.warnings)]
  }
}
