import {
  evaluateReactSource,
  type EvaluateReactSourceOptions,
  type ReactSourceElement,
  type ReactSourceNode
} from '@open-pencil/core/design-jsx'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneGraph, VariableType, VariableValue } from '@open-pencil/scene-graph'

import {
  interactionsFromProps,
  propsToAttrs,
  sourceIdFromProps,
  stateBindingsFromProps,
  styleToDeclaration,
  type JSXElementProps
} from './jsx/core'
import { createCSSRuntime } from './runtime'
import { refreshSourceBaselines, sourceStateBindingsForNode } from './source-metadata'
import { designDocumentToSceneGraph, type ToSceneGraphOptions } from './to-scene-graph'
import type { CSSComputeOptions, CSSRuntime, DesignDocument, DesignNode, DesignText } from './types'

export interface ReactSourceToDesignDocumentOptions extends EvaluateReactSourceOptions {
  cssText?: string
  runtime?: CSSRuntime
  compute?: CSSComputeOptions
}

export interface ReactSourceToSceneGraphOptions
  extends ReactSourceToDesignDocumentOptions, ToSceneGraphOptions {}

function sourceIdFor(element: ReactSourceElement, path: string): string {
  return sourceIdFromProps(element.props as JSXElementProps) ?? path
}

function nodePath(parentPath: string, element: ReactSourceElement, index: number): string {
  const component = element.componentName ? `${element.componentName}/` : ''
  return `${parentPath}/${component}${element.tagName}[${index}]`
}

function coalesceTextNodes(nodes: DesignNode[]): DesignNode[] {
  const result: DesignNode[] = []
  for (const node of nodes) {
    const previous = result.at(-1)
    if (node.type === 'text' && previous?.type === 'text') {
      previous.text += node.text
      continue
    }
    result.push(node)
  }
  return result
}

function toDesignNode(node: ReactSourceNode, path: string, index: number): DesignNode | null {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (Array.isArray(node)) {
    throw new TypeError('Nested React arrays must be normalized before DesignDOM conversion')
  }
  if (typeof node === 'string' || typeof node === 'number') {
    const text: DesignText = {
      type: 'text',
      text: String(node),
      sourceId: `${path}/text[${index}]`
    }
    return text
  }

  const elementPath = nodePath(path, node, index)
  const props = node.props as JSXElementProps
  const children = coalesceTextNodes(
    node.children.flatMap((child, childIndex) => {
      if (Array.isArray(child)) {
        return child.flatMap((nestedChild, nestedIndex) => {
          const result = toDesignNode(
            nestedChild,
            `${elementPath}/array[${childIndex}]`,
            nestedIndex
          )
          return result ? [result] : []
        })
      }
      const result = toDesignNode(child, elementPath, childIndex)
      return result ? [result] : []
    })
  )

  return {
    type: 'element',
    tagName: node.tagName,
    attrs: propsToAttrs(props),
    children,
    inlineStyle: styleToDeclaration(props.style),
    interactions: interactionsFromProps(props),
    sourceComponent: node.componentName ?? undefined,
    sourceId: sourceIdFor(node, elementPath),
    stateBindings: stateBindingsFromProps(props)
  }
}

function primitiveVariable(value: unknown): { type: VariableType; value: VariableValue } | null {
  if (typeof value === 'number' && Number.isFinite(value)) return { type: 'FLOAT', value }
  if (typeof value === 'string') return { type: 'STRING', value }
  if (typeof value === 'boolean') return { type: 'BOOLEAN', value }
  return null
}

function addReactStateVariables(graph: SceneGraph, document: DesignDocument): void {
  const states = document.source?.states ?? []
  const supported = states.flatMap((state) => {
    const variable = primitiveVariable(state.value)
    return variable ? [{ state, variable }] : []
  })
  if (supported.length === 0) return

  const collection = graph.createCollection('React state')
  const variableIds = new Map<number, string>()
  for (const { state, variable } of supported) {
    const created = graph.createVariable(
      `React state ${state.index + 1}`,
      variable.type,
      collection.id,
      variable.value
    )
    variableIds.set(state.index, created.id)
  }

  for (const node of graph.getAllNodes()) {
    for (const binding of sourceStateBindingsForNode(node)) {
      const variableId = variableIds.get(binding.stateIndex)
      if (variableId) graph.bindVariable(node.id, binding.field, variableId)
    }
  }
}

export async function reactSourceToDesignDocument(
  source: string,
  options: ReactSourceToDesignDocumentOptions = {}
): Promise<DesignDocument> {
  const evaluation = evaluateReactSource(source, options)
  const generatedSourceIds: string[] = []
  const children = evaluation.children.flatMap((child, index) => {
    const result = toDesignNode(child, evaluation.componentName, index)
    if (!result) return []
    if (result.type === 'element' && !sourceIdFromProps((child as ReactSourceElement).props)) {
      generatedSourceIds.push(result.sourceId ?? '')
    }
    return [result]
  })
  const warnings = [...evaluation.warnings]
  if (generatedSourceIds.length > 0) {
    warnings.push(
      'Some React layers use structural source IDs; add data-open-pencil-source-id or stable React keys before reordering siblings.'
    )
  }
  const document: DesignDocument = {
    type: 'document',
    children,
    source: {
      kind: 'react',
      code: source,
      cssText: options.cssText,
      componentName: evaluation.componentName,
      states: evaluation.states,
      warnings
    }
  }

  if (!options.cssText && !options.runtime && !options.compute) return document
  const runtime = options.runtime ?? createCSSRuntime()
  return runtime.computeStyles(document, options.cssText, options.compute)
}

export async function reactSourceToSceneGraph(
  source: string,
  options: ReactSourceToSceneGraphOptions = {}
): Promise<SceneGraph> {
  const document = await reactSourceToDesignDocument(source, options)
  const graph = designDocumentToSceneGraph(document, options)
  for (const page of graph.getPages()) computeAllLayouts(graph, page.id)
  addReactStateVariables(graph, document)
  refreshSourceBaselines(graph)
  return graph
}
