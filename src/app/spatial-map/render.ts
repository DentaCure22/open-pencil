import type { EvidenceManifestItem } from '@/app/workspace'

import type { SpatialMapLayoutNode, SpatialMapRenderState } from './types'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function stableSourceHash(source: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return `fnv1a-${(value >>> 0).toString(16).padStart(8, '0')}`
}

function truth(item: EvidenceManifestItem): string {
  return `${item.truthScope} · ${item.freshness}`
}

function artifactMetadata(state: SpatialMapRenderState) {
  const source = JSON.stringify({
    evidenceManifest: { id: state.evidence.id, revision: state.evidence.revision },
    graphEdges: state.graphEdges.map((edge) => ({ id: edge.id, revision: edge.revision })),
    graphNodes: state.graphNodes.map((node) => ({ id: node.id, revision: node.revision })),
    intent: { id: state.intent.id, revision: state.intent.revision },
    spec: state.spec,
    surface: { id: state.surface.id, revision: state.surface.revision }
  })
  return {
    artifactId: state.surface.id,
    diagramType: 'dependency',
    editingModel: 'typed-host-events',
    kind: 'spatial-map-surface',
    renderFormat: 'html-css-js',
    renderer: state.surface.rendererId,
    source,
    sourceHash: stableSourceHash(source),
    title: state.spec.title
  }
}

function nodeClass(state: SpatialMapRenderState, node: SpatialMapLayoutNode): string {
  const classes = ['map-node', `kind-${node.kind}`, `status-${node.status}`]
  if (node.id === state.model.focusedNodeId) classes.push('is-focused')
  if (state.model.criticalPathNodeIds.includes(node.id)) classes.push('is-critical')
  return classes.join(' ')
}

function graph(state: SpatialMapRenderState): string {
  const nodesById = new Map(state.model.nodes.map((node) => [node.id, node]))
  const criticalPairs = new Set(
    state.model.criticalPathNodeIds.slice(0, -1).map((id, index) => {
      const next = state.model.criticalPathNodeIds[index + 1] ?? ''
      return `${id}:${next}`
    })
  )
  const edges = state.model.edges
    .map((edge) => {
      const source = nodesById.get(edge.sourceId)
      const target = nodesById.get(edge.targetId)
      const labelX = source && target ? (source.x + target.x + 158) / 2 : 0
      const labelY = source && target ? (source.y + target.y + 108) / 2 - 7 : 0
      const critical = criticalPairs.has(`${edge.sourceId}:${edge.targetId}`)
      return `<g class="map-edge ${critical ? 'is-critical' : ''}" data-map-edge="${escapeHtml(edge.id)}"><path d="${edge.path}"/><circle cx="${target?.x ?? 0}" cy="${(target?.y ?? 0) + 54}" r="3"/><foreignObject x="${labelX - 48}" y="${labelY - 10}" width="96" height="20"><span>${escapeHtml(edge.label)}</span></foreignObject></g>`
    })
    .join('')
  const nodes = state.model.nodes
    .map(
      (node) =>
        `<button type="button" class="${nodeClass(state, node)}" style="left:${node.x}px;top:${node.y}px" data-map-node="${escapeHtml(node.id)}"><span>${escapeHtml(node.kind)} · ${escapeHtml(node.status)}</span><h2>${escapeHtml(node.label)}</h2><p>${escapeHtml(node.summary)}</p><small>${node.evidenceItemIds.length} evidence link${node.evidenceItemIds.length === 1 ? '' : 's'}</small></button>`
    )
    .join('')
  return `<div class="graph-stage"><svg viewBox="0 0 1080 730" aria-label="Dependency relationships"><defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z"/></marker></defs>${edges}</svg>${nodes}</div>`
}

function evidenceList(state: SpatialMapRenderState, node: SpatialMapLayoutNode): string {
  const evidence = state.evidence.items.filter((item) => node.evidenceItemIds.includes(item.id))
  if (evidence.length === 0) return '<p class="empty">This input node is the stated intent.</p>'
  return evidence
    .map(
      (item) =>
        `<article><small>${escapeHtml(truth(item))}</small><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.summary)}</p><code>${escapeHtml(item.sourceRef)}</code></article>`
    )
    .join('')
}

function inspector(state: SpatialMapRenderState): string {
  const focused =
    state.model.nodes.find((node) => node.id === state.model.focusedNodeId) ?? state.model.nodes[0]
  if (!focused) return ''
  const inbound = state.model.edges.filter((edge) => edge.targetId === focused.id)
  const outbound = state.model.edges.filter((edge) => edge.sourceId === focused.id)
  return `<aside class="inspector"><div class="inspector-head"><span>Selected relationship object</span><b>${escapeHtml(focused.workspaceObjectId)}</b></div><div class="focus-copy"><small>${escapeHtml(focused.kind)} · ${escapeHtml(focused.status)}</small><h2 data-detail-title>${escapeHtml(focused.label)}</h2><p data-detail-summary>${escapeHtml(focused.summary)}</p></div><dl><div><dt>Depends on</dt><dd>${inbound.length}</dd></div><div><dt>Enables</dt><dd>${outbound.length}</dd></div><div><dt>Object revision</dt><dd>1</dd></div><div><dt>Truth</dt><dd>${focused.evidenceItemIds.length ? 'Evidence-linked' : 'Intent input'}</dd></div></dl><div class="evidence"><span>Evidence behind this node</span><div data-detail-evidence>${evidenceList(state, focused)}</div></div><div class="boundary"><b>Capability boundary</b><p>No network, external, or source writes. Inspecting a node only records focus in this run.</p></div></aside>`
}

function mapView(state: SpatialMapRenderState): string {
  return `<section class="view is-active" data-view="map"><div class="map-column"><header class="map-heading"><div><span>Relationship answer · Dependency map</span><h1>${escapeHtml(state.spec.question)}</h1></div><p>${escapeHtml(state.spec.insight)}</p></header>${graph(state)}<footer><span>${state.model.rootNodeIds.length} roots</span><span>${state.model.edges.length} typed relationships</span><span>${state.model.leafNodeIds.length} outcomes</span><span>Critical path: ${state.model.criticalPathNodeIds.map((id) => escapeHtml(state.model.nodes.find((node) => node.id === id)?.label ?? id)).join(' → ')}</span></footer></div>${inspector(state)}</section>`
}

function reviewView(state: SpatialMapRenderState): string {
  const decided = state.surface.status === 'decided'
  return `<section class="view" data-view="review"><div class="review"><article><span>Review the relationship model</span><h1>${decided ? 'Map recorded as shared knowledge' : 'Approve what depends on what'}</h1><p>${escapeHtml(state.spec.insight)}</p><div class="review-grid"><div><small>Intent</small><b>${escapeHtml(state.intent.id)} · r${state.intent.revision}</b></div><div><small>Evidence</small><b>${escapeHtml(state.evidence.id)} · r${state.evidence.revision}</b></div><div><small>Graph identity</small><b>${state.graphNodes.length} nodes · ${state.graphEdges.length} edges</b></div><div><small>Artifact</small><b>${escapeHtml(state.surface.artifact.boardId)} · r${state.artifactRevision}</b></div></div></article><aside><span>Exact outcome receipt</span><b>${escapeHtml(state.receipt?.id ?? 'Created only after approval')}</b><p>Approval records the exact intent, evidence, typed graph, focused-node corrections, surface revision, and HTML artifact.</p><button type="button" data-action="approve" ${decided ? 'disabled' : ''}>${decided ? 'Map approved' : 'Approve relationship map'}</button><small>Source unchanged · approval does not execute work</small></aside></div></section>`
}

export function renderSpatialMap(state: SpatialMapRenderState): {
  css: string
  html: string
  js: string
  sourceHash: string
} {
  const artifact = artifactMetadata(state)
  const safeArtifact = JSON.stringify(artifact).replaceAll('<', '\\u003c')
  const basis = escapeHtml(
    JSON.stringify({
      artifactRevision: state.artifactRevision,
      surfaceRevision: state.surface.revision,
      workspaceRevision: state.workspaceRevision
    })
  )
  const nodeData = JSON.stringify(
    Object.fromEntries(
      state.model.nodes.map((node) => [
        node.id,
        {
          evidence: state.evidence.items
            .filter((item) => node.evidenceItemIds.includes(item.id))
            .map((item) => ({
              sourceRef: item.sourceRef,
              summary: item.summary,
              title: item.title,
              truth: truth(item)
            })),
          kind: node.kind,
          label: node.label,
          status: node.status,
          summary: node.summary
        }
      ])
    )
  ).replaceAll('<', '\\u003c')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; navigate-to 'none'; base-uri 'none'; object-src 'none'"><script type="application/json" data-openpencil-artifact>${safeArtifact}</script></head><body><main class="spatial-map" data-openpencil-width="1500" data-openpencil-height="960" data-surface-id="${escapeHtml(state.surface.id)}" data-focused-node="${escapeHtml(state.model.focusedNodeId)}" data-basis="${basis}"><header class="top"><div class="identity"><i>OP</i><div><b>OpenPencil</b><small>Executable knowledge</small></div></div><div><span>Chosen form</span><b>Map · relationships</b></div><nav><button type="button" class="is-active" data-view-target="map">Map</button><button type="button" data-view-target="review">Review</button></nav><div class="status"><span>${escapeHtml(state.surface.status)}</span><b>r${state.surface.revision}</b></div></header><div class="views">${mapView(state)}${reviewView(state)}</div><div class="toast" role="status"></div></main></body></html>`
  const css = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#20211d;background:#eeece5}*{box-sizing:border-box}body{margin:0}.spatial-map{position:relative;width:1500px;height:960px;overflow:hidden;background:#eeece5}.top{display:grid;grid-template-columns:310px 250px 1fr 150px;align-items:center;height:66px;border-bottom:1px solid #cfccc2;padding:0 26px;background:#f5f3ed}.identity{display:flex;align-items:center;gap:10px}.identity i{display:grid;place-items:center;width:32px;height:32px;border:1px solid #34352f;border-radius:9px;font-size:10px;font-style:normal}.identity div,.top>div:nth-child(2){display:grid;gap:2px}.identity b,.top>div:nth-child(2)>b{font-size:11px}.identity small,.top>div:nth-child(2)>span{color:#817e75;font-size:8px;text-transform:uppercase}.top nav{display:flex;justify-content:center;height:66px}.top nav button{position:relative;border:0;background:none;padding:0 18px;color:#88847a;font:inherit;font-size:10px;cursor:pointer}.top nav button.is-active{color:#272823}.top nav button.is-active:after{position:absolute;right:15px;bottom:0;left:15px;height:2px;background:#6b55cd;content:""}.status{display:flex;justify-content:flex-end;gap:9px;font-size:9px}.status span{border:1px solid #c0bbaf;border-radius:99px;padding:5px 8px;text-transform:capitalize}.views{height:894px}.view{display:none;height:894px}.view.is-active{display:grid}.view[data-view="map"]{grid-template-columns:1140px 360px}.map-column{display:grid;grid-template-rows:106px 730px 58px;border-right:1px solid #cfccc2}.map-heading{display:flex;align-items:end;justify-content:space-between;padding:23px 30px 18px}.map-heading span,.review article>span,.review aside>span,.inspector-head>span,.evidence>span{color:#6954c5;font-size:8px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.map-heading h1{margin:8px 0 0;font:500 27px/1.1 Georgia,serif;letter-spacing:-.02em}.map-heading>p{max-width:430px;margin:0;color:#66635b;font:11px/1.45 Georgia,serif;text-align:right}.graph-stage{position:relative;width:1080px;height:730px;margin:0 30px;overflow:hidden;border:1px solid #d0ccc1;border-radius:12px;background-color:#f8f6f0;background-image:linear-gradient(#dedbd2 1px,transparent 1px),linear-gradient(90deg,#dedbd2 1px,transparent 1px);background-size:24px 24px}.graph-stage svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.map-edge path{fill:none;stroke:#9f9a8e;stroke-width:1.2;marker-end:url(#arrow)}.map-edge circle{fill:#9f9a8e}.map-edge foreignObject{overflow:visible}.map-edge span{display:block;border:1px solid #d0ccc1;border-radius:99px;background:#f8f6f0;padding:3px 6px;color:#777268;font-size:7px;text-align:center}.map-edge.is-critical path{stroke:#6954c5;stroke-width:1.7}.map-edge.is-critical circle,#arrow path{fill:#6954c5}.map-node{position:absolute;width:158px;height:108px;overflow:hidden;border:1px solid #c6c2b8;border-radius:9px;background:#fdfbf6;padding:12px;text-align:left;color:#242520;box-shadow:0 7px 18px rgba(50,47,40,.05);cursor:pointer}.map-node>span{display:block;color:#837f75;font-size:7px;text-transform:uppercase}.map-node h2{margin:8px 0 5px;font:600 12px/1.1 inherit}.map-node p{display:-webkit-box;overflow:hidden;margin:0;color:#67645c;font-size:8px;line-height:1.4;-webkit-box-orient:vertical;-webkit-line-clamp:3}.map-node small{position:absolute;bottom:9px;left:12px;color:#989388;font-size:7px}.map-node.kind-constraint{border-style:dashed;background:#f3f0e8}.map-node.kind-outcome{background:#eeece3}.map-node.status-missing:after,.map-node.status-partial:after,.map-node.status-proven:after{position:absolute;top:11px;right:11px;width:6px;height:6px;border-radius:50%;content:""}.map-node.status-proven:after{background:#4e9068}.map-node.status-partial:after{background:#c78b31}.map-node.status-missing:after{background:#9b968b}.map-node.is-critical{border-color:#9584df}.map-node.is-focused{outline:3px solid rgba(105,84,197,.16);border-color:#6954c5}.map-column footer{display:flex;align-items:center;gap:18px;padding:0 30px;color:#777269;font-size:8px}.map-column footer span:last-child{margin-left:auto;max-width:580px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.inspector{overflow:auto;padding:26px 24px;background:#f5f3ed}.inspector-head{display:grid;gap:7px;border-bottom:1px solid #d0ccc2;padding-bottom:17px}.inspector-head b{overflow-wrap:anywhere;color:#777269;font:8px/1.4 ui-monospace,monospace}.focus-copy{padding:24px 0}.focus-copy small{color:#8a857b;font-size:8px;text-transform:uppercase}.focus-copy h2{margin:10px 0;font:500 29px/1.05 Georgia,serif}.focus-copy p{color:#625f57;font:12px/1.55 Georgia,serif}.inspector dl{margin:0 0 24px}.inspector dl div{display:flex;justify-content:space-between;border-top:1px solid #d4d0c6;padding:10px 0;font-size:8px}.inspector dd{margin:0}.evidence{display:grid;gap:10px}.evidence article{display:grid;gap:6px;border:1px solid #d0ccc1;border-radius:8px;background:#faf8f2;padding:12px}.evidence article small{color:#6b55cd;font-size:7px;text-transform:uppercase}.evidence article b{font-size:9px}.evidence article p,.empty{margin:0;color:#6d695f;font-size:8px;line-height:1.45}.evidence article code{overflow-wrap:anywhere;color:#8e897e;font-size:7px}.boundary{margin-top:18px;border-top:2px solid #34352f;padding-top:14px}.boundary b{font-size:9px}.boundary p{color:#747066;font-size:8px;line-height:1.5}.review{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:70px;align-items:center;width:1180px;margin:auto}.review article h1{max-width:720px;margin:18px 0;font:500 54px/1.03 Georgia,serif;letter-spacing:-.035em}.review article>p{max-width:760px;color:#605d55;font:17px/1.55 Georgia,serif}.review-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:40px}.review-grid>div{display:grid;gap:8px;border-top:1px solid #bdb8ad;padding:14px 0}.review-grid small{color:#8c877d;font-size:8px;text-transform:uppercase}.review-grid b{overflow-wrap:anywhere;font:10px/1.5 ui-monospace,monospace}.review aside{display:grid;gap:16px;border:1px solid #c8c3b7;background:#f8f6ef;padding:26px}.review aside>b{overflow-wrap:anywhere;font:500 18px/1.35 Georgia,serif}.review aside>p{color:#666259;font-size:10px;line-height:1.55}.review aside button{border:0;border-radius:7px;background:#6954c5;padding:14px;color:#fff;font:inherit;font-size:10px;font-weight:700;cursor:pointer}.review aside button:disabled{background:#9d988e}.review aside>small{color:#817c72;font-size:8px;text-align:center}.toast{position:absolute;right:26px;bottom:24px;border-radius:7px;background:#292a25;padding:11px 14px;color:#fff;font-size:9px;opacity:0;transform:translateY(6px);transition:.18s}.toast.is-visible{opacity:1;transform:none}`
  const js = `(() => {
  const root = document.querySelector('[data-surface-id]')
  if (!root) return
  const basis = JSON.parse(root.dataset.basis || '{}')
  const nodes = ${nodeData}
  let pending = null
  const toast = document.querySelector('.toast')
  const announce = (message) => {
    if (!toast) return
    toast.textContent = message
    toast.classList.add('is-visible')
    setTimeout(() => toast.classList.remove('is-visible'), 1800)
  }
  const showView = (view) => {
    document.querySelectorAll('[data-view]').forEach((node) => node.classList.toggle('is-active', node.dataset.view === view))
    document.querySelectorAll('[data-view-target]').forEach((node) => node.classList.toggle('is-active', node.dataset.viewTarget === view))
  }
  const send = (detail) => {
    if (pending) return
    pending = detail
    document.dispatchEvent(new CustomEvent('openpencil:surface-event', { detail }))
  }
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!button) return
    if (button.dataset.viewTarget) return showView(button.dataset.viewTarget)
    if (button.dataset.mapNode) {
      const nodeId = button.dataset.mapNode
      const detail = nodes[nodeId]
      if (!detail) return
      document.querySelectorAll('[data-map-node]').forEach((node) => node.classList.toggle('is-focused', node.dataset.mapNode === nodeId))
      const title = document.querySelector('[data-detail-title]')
      const summary = document.querySelector('[data-detail-summary]')
      if (title) title.textContent = detail.label
      if (summary) summary.textContent = detail.summary
      send({ action: 'focus-node', eventId: 'spatial-map-focus-' + nodeId + '-' + Date.now(), expected: basis, nodeId, surfaceRunId: root.dataset.surfaceId })
      return
    }
    if (button.dataset.action === 'approve') {
      send({ action: 'approve', eventId: 'spatial-map-approve-' + Date.now(), expected: basis, surfaceRunId: root.dataset.surfaceId })
      announce('Recording exact map receipt…')
    }
  })
  document.addEventListener('openpencil:surface-event-result', (event) => {
    const result = event.detail
    if (!pending || !result || result.eventId !== pending.eventId) return
    pending = null
    announce(result.status === 'rejected' ? (result.error || 'Map event rejected') : 'Map event recorded')
  })
})()`
  return { css, html, js, sourceHash: artifact.sourceHash }
}
