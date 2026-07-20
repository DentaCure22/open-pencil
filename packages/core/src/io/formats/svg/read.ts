import { SceneGraph } from '@open-pencil/scene-graph'

import { FigmaAPI } from '#core/figma-api'
import {
  CONTENT_SOURCE_REVISION,
  mergeContentSourcePluginData,
  mergeSourceReconciliationPluginData,
  sourceSceneSignature
} from '#core/io/content-source'
import { importSvg } from '#core/tools/create/svg'

const SVG_MIME_TYPE = 'image/svg+xml'

export interface SVGReadOptions {
  color?: string
  fileName?: string
  mimeType?: string
  name?: string
}

interface ImportSvgSuccess {
  id: string
}

function documentName(options: SVGReadOptions): string {
  return options.name || options.fileName?.replace(/\.svg$/i, '') || 'SVG'
}

function importedFrameId(result: unknown): string {
  if (!result || typeof result !== 'object') throw new Error('SVG import returned no artifact')
  if ('error' in result && typeof result.error === 'string') throw new Error(result.error)
  if (!('id' in result) || typeof result.id !== 'string') {
    throw new Error('SVG import returned no artifact')
  }
  return (result as ImportSvgSuccess).id
}

export async function svgToSceneGraph(
  source: string,
  options: SVGReadOptions = {}
): Promise<SceneGraph> {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const name = documentName(options)
  page.name = name

  const result = await importSvg.execute(new FigmaAPI(graph), {
    svg: source,
    name,
    color: options.color
  })
  const frameId = importedFrameId(result)
  const frame = graph.getNode(frameId)
  if (!frame) throw new Error('SVG import returned an unknown artifact')

  const sourceMetadata = mergeContentSourcePluginData(frame.pluginData, {
    format: 'svg',
    mimeType: options.mimeType ?? SVG_MIME_TYPE,
    fileName: options.fileName ?? null,
    revision: CONTENT_SOURCE_REVISION,
    source
  })
  const baseline = sourceSceneSignature(graph, frame.id)
  graph.updateNode(frame.id, {
    pluginData: mergeSourceReconciliationPluginData(sourceMetadata, {
      status: 'current',
      message: 'Source matches the imported SVG projection.',
      baseline,
      revision: CONTENT_SOURCE_REVISION
    })
  })

  return graph
}

export async function readSVGFile(
  data: Uint8Array,
  options: SVGReadOptions = {}
): Promise<SceneGraph> {
  return svgToSceneGraph(new TextDecoder().decode(data), options)
}
