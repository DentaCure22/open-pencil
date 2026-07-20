import { colorToCSS } from '@open-pencil/core/color'

import type { EvidenceManifestItem } from '@/app/workspace'

import type { EvidenceBriefRenderState, EvidenceBriefView } from './types'

const PAPER_SHADOW = colorToCSS({ a: 0.08, b: 40 / 255, g: 47 / 255, r: 50 / 255 })
const POPOVER_SHADOW = colorToCSS({ a: 0.2, b: 33 / 255, g: 38 / 255, r: 40 / 255 })

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

function providerRun(state: EvidenceBriefRenderState, item: EvidenceManifestItem) {
  return state.evidence.collectionReceipt?.providerRuns.find((run) => run.id === item.providerRunId)
}

function artifactMetadata(state: EvidenceBriefRenderState) {
  const source = JSON.stringify({
    evidenceManifest: { id: state.evidence.id, revision: state.evidence.revision },
    intent: { id: state.intent.id, revision: state.intent.revision },
    spec: state.spec,
    surface: { id: state.surface.id, revision: state.surface.revision }
  })
  return {
    artifactId: state.surface.id,
    diagramType: 'evidence-brief',
    editingModel: 'typed-host-events',
    kind: 'evidence-brief-surface',
    renderFormat: 'html-css-js',
    renderer: state.surface.rendererId,
    source,
    sourceHash: stableSourceHash(source),
    title: state.spec.title
  }
}

function viewTabs(state: EvidenceBriefRenderState): string {
  const labels: Record<EvidenceBriefView, string> = {
    focus: 'Brief',
    overview: 'Overview',
    review: 'Review',
    sources: 'Sources'
  }
  return state.spec.views
    .map(
      (view, index) =>
        `<button type="button" data-view-target="${view}" class="${index === 1 ? 'is-active' : ''}">${labels[view]}</button>`
    )
    .join('')
}

function overview(state: EvidenceBriefRenderState): string {
  const providerCount = state.evidence.collectionReceipt?.providerRuns.length ?? 0
  const formMeaning = state.spec.sharedLineage
    ? 'Companion view over the primary intent and evidence'
    : 'Chosen because the job is explanation'
  return `<section class="view" data-view="overview"><div class="overview-shell"><div class="eyebrow">Shared model</div><h1>${escapeHtml(state.spec.title)}</h1><p class="lead">${escapeHtml(state.spec.takeaway)}</p><div class="model-row"><article><span>01</span><b>Intent</b><small>${escapeHtml(state.intent.desiredOutcome)}</small></article><i>→</i><article><span>02</span><b>Evidence</b><small>${state.evidence.items.length} sources · ${providerCount} provider runs</small></article><i>→</i><article><span>03</span><b>Brief</b><small>${formMeaning}</small></article><i>→</i><article><span>04</span><b>Receipt</b><small>${state.receipt ? 'Recorded' : 'Created after review'}</small></article></div><div class="boundary"><b>Capability boundary</b><span>Knowledge approval only · no network · no external writes · source unchanged</span></div></div></section>`
}

function focus(state: EvidenceBriefRenderState): string {
  const collectionId =
    state.evidence.collectionReceipt?.id ?? 'Legacy manifest · no provider receipt'
  const lineage = state.spec.sharedLineage ? 'Shared with primary' : 'Standalone'
  return `<section class="view is-active" data-view="focus"><div class="brief-grid"><aside class="outline"><div class="eyebrow">In this brief</div>${state.spec.sections.map((section, index) => `<a href="#${escapeHtml(section.id)}"><span>0${index + 1}</span>${escapeHtml(section.title)}</a>`).join('')}<div class="intent-card"><span>Intent</span><p>${escapeHtml(state.intent.statement)}</p></div></aside><article class="paper"><header><span>${state.spec.sharedLineage ? 'Companion brief · shared lineage' : 'Evidence brief'} · r${state.surface.revision}</span><h1>${escapeHtml(state.spec.title)}</h1><p>${escapeHtml(state.spec.takeaway)}</p></header>${state.spec.sections.map((section, index) => `<section id="${escapeHtml(section.id)}"><small>0${index + 1}</small><div><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p><div class="citations">${section.evidenceItemIds.map((id) => `<button type="button" data-evidence-id="${escapeHtml(id)}">Inspect source</button>`).join('')}</div></div></section>`).join('')}</article><aside class="margin"><div class="eyebrow">Truth and scope</div><dl><div><dt>Form</dt><dd>Brief</dd></div><div><dt>Lineage</dt><dd>${lineage}</dd></div><div><dt>Renderer</dt><dd>${escapeHtml(state.surface.rendererId)}</dd></div><div><dt>Evidence</dt><dd>${state.evidence.items.length} items</dd></div><div><dt>Collection</dt><dd>${escapeHtml(collectionId)}</dd></div><div><dt>Status</dt><dd>${escapeHtml(state.surface.status)}</dd></div></dl><div class="questions"><span>Open questions</span>${state.spec.openQuestions.map((question) => `<p>${escapeHtml(question)}</p>`).join('')}</div></aside></div></section>`
}

function sources(state: EvidenceBriefRenderState): string {
  return `<section class="view" data-view="sources"><div class="view-heading"><div><span>Evidence manifest</span><h1>Sources behind the brief</h1></div><p>Truth, provider, permission, and capability receipts show what every source can actually support.</p></div><div class="source-grid">${state.evidence.items
    .map((item, index) => {
      const run = providerRun(state, item)
      return `<button type="button" class="source-card" data-evidence-id="${escapeHtml(item.id)}"><span>0${index + 1}</span><div><small>${escapeHtml(truth(item))}</small><em>${escapeHtml(run ? `${run.providerId} · ${run.status}` : 'legacy evidence · provider unknown')}</em><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.summary)}</p><div class="scope-line"><b>Granted scopes</b><span>${escapeHtml(run?.grantedScopes.join(', ') || 'not recorded')}</span></div><div class="scope-line"><b>Writes</b><span>${run ? 'source denied · external denied' : 'not recorded'}</span></div><code>${escapeHtml(item.sourceRef)}</code></div></button>`
    })
    .join('')}</div></section>`
}

function review(state: EvidenceBriefRenderState): string {
  const decided = state.surface.status === 'decided'
  const providerRuns = state.evidence.collectionReceipt?.providerRuns.length ?? 0
  return `<section class="view" data-view="review"><div class="review-grid"><article><span class="eyebrow">Review contract</span><h1>${decided ? 'Knowledge recorded' : 'Approve this brief as shared knowledge'}</h1><p>${escapeHtml(state.spec.takeaway)}</p><div class="review-points"><div><b>What approval means</b><span>The brief and its exact evidence basis become reconstructable knowledge.</span></div><div><b>What approval does not mean</b><span>No source code, external system, or production runtime changes.</span></div></div></article><aside><span>Receipt</span><b>${state.receipt?.id ?? 'Created after approval'}</b><dl><div><dt>Intent revision</dt><dd>${state.intent.revision}</dd></div><div><dt>Evidence sources</dt><dd>${state.evidence.items.length}</dd></div><div><dt>Provider runs</dt><dd>${providerRuns}</dd></div><div><dt>Surface revision</dt><dd>${state.surface.revision}</dd></div><div><dt>Artifact revision</dt><dd>${state.artifactRevision}</dd></div></dl><button type="button" data-action="approve" ${decided ? 'disabled' : ''}>${decided ? 'Brief approved' : 'Approve brief'}</button><small>Source unchanged · approval is reversible only through a new reviewed revision.</small></aside></div></section>`
}

export function renderEvidenceBrief(state: EvidenceBriefRenderState): {
  css: string
  html: string
  js: string
  sourceHash: string
} {
  const artifact = artifactMetadata(state)
  const safeArtifact = JSON.stringify(artifact).replaceAll('<', '\\u003c')
  const basis = JSON.stringify({
    artifactRevision: state.artifactRevision,
    surfaceRevision: state.surface.revision,
    workspaceRevision: state.workspaceRevision
  }).replaceAll('"', '&quot;')
  const evidence = JSON.stringify(
    Object.fromEntries(
      state.evidence.items.map((item) => [
        item.id,
        { source: item.sourceRef, summary: item.summary, title: item.title, truth: truth(item) }
      ])
    )
  ).replaceAll('<', '\\u003c')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; navigate-to 'none'; base-uri 'none'; object-src 'none'"><script type="application/json" data-openpencil-artifact>${safeArtifact}</script></head><body><main class="brief" data-openpencil-width="1500" data-openpencil-height="960" data-surface-id="${escapeHtml(state.surface.id)}" data-basis="${basis}"><header class="top"><div class="brand"><i>OP</i><div><b>OpenPencil</b><small>Intent-to-Experience OS</small></div></div><nav>${viewTabs(state)}</nav><div class="status"><span>${state.spec.sharedLineage ? 'Shared intent + evidence' : 'Captured + derived'}</span><b>${escapeHtml(state.surface.status)}</b></div></header><div class="views">${overview(state)}${focus(state)}${sources(state)}${review(state)}</div><div class="popover" hidden><button type="button" aria-label="Close source">×</button><small></small><h3></h3><p></p><code></code></div><div class="toast" role="status"></div></main></body></html>`
  const css = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#262722;background:#ebe9e2}*{box-sizing:border-box}body{margin:0}.brief{position:relative;width:1500px;height:960px;overflow:hidden;background:#ebe9e2}.top{display:grid;grid-template-columns:350px 1fr 350px;align-items:center;height:68px;border-bottom:1px solid #d4d0c5;padding:0 28px;background:#f2f0e9}.brand{display:flex;align-items:center;gap:10px}.brand i{display:grid;place-items:center;width:34px;height:34px;border:1px solid #403f39;border-radius:50%;font-style:normal;font-size:11px}.brand div{display:grid}.brand b{font-size:13px}.brand small{color:#7b786f;font-size:9px}.top nav{display:flex;justify-content:center;height:100%}.top nav button{position:relative;border:0;background:none;padding:0 18px;color:#858178;font:inherit;font-size:11px;cursor:pointer}.top nav button.is-active{color:#23241f}.top nav button.is-active:after{position:absolute;right:14px;bottom:0;left:14px;height:2px;background:#6e56cf;content:""}.status{display:flex;justify-content:flex-end;align-items:center;gap:12px;font-size:9px;text-transform:capitalize}.status span{border:1px solid #bbb5a7;border-radius:99px;padding:5px 8px;color:#706b61}.views,.view{height:892px}.view{display:none;padding:34px 40px}.view.is-active{display:block}.eyebrow,.view-heading span,.questions>span,.review-grid aside>span{color:#7561c9;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.overview-shell{display:flex;flex-direction:column;justify-content:center;height:100%;max-width:1240px;margin:auto}.overview-shell h1{max-width:820px;margin:15px 0 12px;font:500 58px/1.02 Georgia,serif;letter-spacing:-.04em}.lead{max-width:830px;color:#626056;font:20px/1.55 Georgia,serif}.model-row{display:grid;grid-template-columns:repeat(7,auto);align-items:center;gap:18px;margin-top:70px}.model-row article{display:grid;gap:8px;width:235px;border-top:2px solid #3e3d37;padding-top:15px}.model-row article span{color:#8a8579;font-size:9px}.model-row article b{font:500 24px Georgia,serif}.model-row article small{color:#706d64;font-size:10px;line-height:1.5}.model-row>i{color:#918b7e;font-style:normal}.boundary{display:flex;justify-content:space-between;margin-top:64px;border:1px solid #cbc6b9;padding:18px 20px;font-size:10px}.boundary span{color:#706c62}.brief-grid{display:grid;grid-template-columns:225px minmax(0,1fr) 275px;gap:30px;height:824px}.outline{padding:18px 8px}.outline>a{display:flex;gap:12px;border-bottom:1px solid #cbc7bc;padding:16px 0;color:#3f403a;text-decoration:none;font-size:11px}.outline>a span{color:#9a958a}.intent-card{margin-top:28px;border:1px solid #c8c3b7;border-radius:8px;padding:16px}.intent-card span{font-size:8px;text-transform:uppercase}.intent-card p{color:#66635b;font:12px/1.55 Georgia,serif}.paper{height:824px;overflow:auto;border:1px solid #d2cec3;background:#faf8f2;padding:58px 70px;box-shadow:0 20px 60px ${PAPER_SHADOW}}.paper header{border-bottom:1px solid #d8d3c7;padding-bottom:42px}.paper header>span{color:#89857b;font-size:9px;text-transform:uppercase}.paper h1{max-width:730px;margin:16px 0;font:500 48px/1.05 Georgia,serif;letter-spacing:-.035em}.paper header p{max-width:760px;color:#5b5a53;font:17px/1.55 Georgia,serif}.paper>section{display:grid;grid-template-columns:42px 1fr;gap:20px;border-bottom:1px solid #ddd8cc;padding:38px 0}.paper>section>small{color:#8e897e}.paper h2{margin:0 0 12px;font:500 26px Georgia,serif}.paper section p{margin:0;color:#56564f;font:14px/1.75 Georgia,serif}.citations{display:flex;gap:8px;margin-top:17px}.citations button{border:1px solid #cbc6ba;border-radius:99px;background:none;padding:7px 10px;color:#6655b5;font:inherit;font-size:9px;cursor:pointer}.margin{padding:18px 0}.margin dl{margin:18px 0 28px}.margin dl div{display:flex;justify-content:space-between;border-top:1px solid #cbc7bc;padding:11px 0;font-size:9px}.margin dt{color:#858177}.margin dd{margin:0;max-width:150px;text-align:right}.questions{display:grid;gap:10px;border:1px solid #cac5b9;border-radius:8px;padding:16px}.questions p{margin:0;border-top:1px solid #d5d0c4;padding-top:10px;color:#67645c;font:11px/1.5 Georgia,serif}.view-heading{display:flex;align-items:end;justify-content:space-between;max-width:1240px;margin:20px auto 34px}.view-heading h1{margin:8px 0 0;font:500 44px Georgia,serif}.view-heading p{max-width:440px;color:#716d64;font-size:11px;text-align:right}.source-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;max-width:1240px;margin:auto}.source-card{display:grid;grid-template-columns:36px 1fr;gap:16px;min-height:360px;border:1px solid #cbc6b9;background:#f7f5ee;padding:24px;text-align:left;color:#292a25;cursor:pointer}.source-card>span{color:#9d978b;font-size:10px}.source-card small{color:#7561c9;font-size:8px;text-transform:uppercase}.source-card em{display:block;margin-top:5px;color:#8a857a;font-size:8px;font-style:normal}.source-card h2{margin:16px 0 12px;font:500 26px Georgia,serif}.source-card p{color:#66635c;font:12px/1.6 Georgia,serif}.scope-line{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #dad5c9;padding:8px 0;color:#777269;font-size:8px}.scope-line span{text-align:right}.source-card code{display:block;margin-top:18px;color:#888378;font-size:8px;overflow-wrap:anywhere}.review-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:36px;max-width:1180px;height:100%;margin:auto;align-items:center}.review-grid>article{padding:30px}.review-grid h1{max-width:750px;margin:18px 0;font:500 56px/1.05 Georgia,serif}.review-grid article>p{max-width:770px;color:#5e5b53;font:18px/1.55 Georgia,serif}.review-points{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:42px}.review-points>div{display:grid;gap:8px;border-top:1px solid #bbb6a9;padding-top:16px}.review-points span{color:#706d64;font-size:10px;line-height:1.5}.review-grid aside{display:grid;gap:12px;border:1px solid #c8c2b5;background:#f7f5ee;padding:24px}.review-grid aside>b{overflow-wrap:anywhere;font:500 17px Georgia,serif}.review-grid aside dl{margin:8px 0}.review-grid aside dl div{display:flex;justify-content:space-between;border-top:1px solid #d7d2c7;padding:10px 0;font-size:9px}.review-grid aside dd{margin:0}.review-grid aside button{border:0;border-radius:6px;background:#6751c7;padding:13px;color:white;font:inherit;font-size:10px;font-weight:700;cursor:pointer}.review-grid aside button:disabled{background:#aaa59a}.review-grid aside>small{color:#78746a;font-size:8px;line-height:1.5;text-align:center}.popover{position:absolute;right:36px;bottom:34px;width:360px;border:1px solid #c4beb1;background:#fbf9f3;padding:22px;box-shadow:0 20px 60px ${POPOVER_SHADOW}}.popover button{float:right;border:0;background:none;font-size:18px}.popover small{color:#7561c9;font-size:8px;text-transform:uppercase}.popover h3{margin:13px 0 9px;font:500 21px Georgia,serif}.popover p{color:#66635b;font-size:10px;line-height:1.55}.popover code{font-size:8px;overflow-wrap:anywhere}.toast{position:absolute;right:30px;bottom:26px;border-radius:6px;background:#292a25;padding:10px 13px;color:white;font-size:9px;opacity:0;transform:translateY(6px);transition:.18s}.toast.is-visible{opacity:1;transform:none}@media(max-width:1050px){.brief{width:100vw;height:auto;min-height:100vh}.top{grid-template-columns:1fr auto;height:auto;min-height:68px}.top nav{grid-row:2;grid-column:1/-1;height:42px}.status{display:none}.views,.view{height:auto}.brief-grid,.review-grid{grid-template-columns:1fr;height:auto}.outline,.margin{display:none}.paper{height:auto;min-height:700px;padding:40px}.source-grid{grid-template-columns:1fr}.model-row{grid-template-columns:1fr}.model-row>i{display:none}}`
  const js = `(() => {
  const root = document.querySelector('[data-surface-id]')
  if (!root) return
  const basis = JSON.parse(root.dataset.basis || '{}')
  const evidence = ${evidence}
  let pending = null
  const toast = document.querySelector('.toast')
  const announce = (message) => {
    if (!toast) return
    toast.textContent = message
    toast.classList.add('is-visible')
    setTimeout(() => toast.classList.remove('is-visible'), 2200)
  }
  const showView = (view) => {
    document.querySelectorAll('[data-view]').forEach((node) => node.classList.toggle('is-active', node.dataset.view === view))
    document.querySelectorAll('[data-view-target]').forEach((node) => node.classList.toggle('is-active', node.dataset.viewTarget === view))
  }
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!button) return
    if (button.dataset.viewTarget) return showView(button.dataset.viewTarget)
    if (button.dataset.evidenceId) {
      const detail = evidence[button.dataset.evidenceId]
      const popover = document.querySelector('.popover')
      if (!detail || !popover) return
      popover.hidden = false
      popover.querySelector('small').textContent = detail.truth
      popover.querySelector('h3').textContent = detail.title
      popover.querySelector('p').textContent = detail.summary
      popover.querySelector('code').textContent = detail.source
      return
    }
    if (button.closest('.popover')) {
      const popover = document.querySelector('.popover')
      if (popover) popover.hidden = true
      return
    }
    if (button.dataset.action === 'approve' && !pending) {
      pending = { action: 'approve', eventId: 'evidence-brief-' + Date.now(), expected: basis, surfaceRunId: root.dataset.surfaceId }
      document.dispatchEvent(new CustomEvent('openpencil:surface-event', { detail: pending }))
      announce('Recording approval…')
    }
  })
  document.addEventListener('openpencil:surface-event-result', (event) => {
    const result = event.detail
    if (!pending || !result || result.eventId !== pending.eventId) return
    pending = null
    announce(result.status === 'rejected' ? (result.error || 'Approval rejected') : 'Approval recorded')
  })
})()`
  return { css, html, js, sourceHash: artifact.sourceHash }
}
