import {
  MERMAID_DIAGRAM_REVISION,
  MERMAID_SVG_PARSER,
  type MermaidAppearance,
  type MermaidDiagram
} from '@open-pencil/core/diagram'

const DEFAULT_WIDTH = 720
const DEFAULT_HEIGHT = 480

let renderQueue: Promise<void> = Promise.resolve()

function positive(value: string | null, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function svgSize(root: SVGSVGElement): { height: number; width: number } {
  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/u)
    .map(Number)
  const viewBoxWidth = viewBox?.length === 4 ? viewBox[2] : undefined
  const viewBoxHeight = viewBox?.length === 4 ? viewBox[3] : undefined
  return {
    width:
      typeof viewBoxWidth === 'number' && Number.isFinite(viewBoxWidth) && viewBoxWidth > 0
        ? viewBoxWidth
        : positive(root.getAttribute('width'), DEFAULT_WIDTH),
    height:
      typeof viewBoxHeight === 'number' && Number.isFinite(viewBoxHeight) && viewBoxHeight > 0
        ? viewBoxHeight
        : positive(root.getAttribute('height'), DEFAULT_HEIGHT)
  }
}

async function render(source: string, appearance: MermaidAppearance): Promise<MermaidDiagram> {
  const definition = source.trim()
  if (!definition) throw new Error('Paste a Mermaid definition first.')
  if (typeof document === 'undefined') throw new Error('Mermaid SVG rendering requires a browser.')

  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: appearance === 'light' ? 'default' : 'dark'
  })

  const host = document.createElement('div')
  host.style.cssText =
    'opacity:0;position:fixed;z-index:-1;left:-99999px;top:-99999px;width:720px;height:480px;pointer-events:none'
  document.body.appendChild(host)
  try {
    const id = `open-pencil-mermaid-svg-${crypto.randomUUID()}`
    const rendered = await mermaid.render(id, definition, host)
    const parsed = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml')
    const root = parsed.documentElement
    if (!(root instanceof SVGSVGElement)) throw new Error('Mermaid returned no SVG diagram.')
    const { height, width } = svgSize(root)
    if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${width} ${height}`)
    root.setAttribute('width', '100%')
    root.setAttribute('height', '100%')
    root.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    root.setAttribute('role', 'img')
    root.setAttribute('aria-label', 'Mermaid diagram')
    root.style.maxWidth = 'none'
    root.style.background = 'transparent'
    return {
      appearance,
      source: definition,
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      height,
      svg: new XMLSerializer().serializeToString(root),
      width
    }
  } finally {
    host.remove()
  }
}

export function renderMermaidSvgInBrowser(
  source: string,
  appearance: MermaidAppearance
): Promise<MermaidDiagram> {
  const task = renderQueue.then(() => render(source, appearance))
  renderQueue = task.then(
    () => undefined,
    () => undefined
  )
  return task
}
