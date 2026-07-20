import type { EvidenceManifestItem } from '@/app/workspace'

import type { FlowStudioOption, FlowStudioRenderState, FlowStudioView } from './types'

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

function truthLabel(item: EvidenceManifestItem): string {
  return `${item.truthScope} · ${item.freshness}`
}

function optionFor(state: FlowStudioRenderState, optionId: string): FlowStudioOption {
  return state.spec.options.find((option) => option.id === optionId) ?? state.spec.options[0]!
}

function formFields(option: FlowStudioOption, compact = false): string {
  return option.fieldGroups
    .map(
      (group, index) => `<section class="form-group ${compact ? 'is-compact' : ''}">
  <div class="form-group-heading"><span>${String(index + 1).padStart(2, '0')}</span><h4>${escapeHtml(group.title)}</h4></div>
  <div class="field-grid">${group.fields
    .map(
      (field) =>
        `<label><span>${escapeHtml(field)}</span><i>${field.includes('Name') ? 'Jordan Lee' : field.includes('birth') || field === 'DOB' ? '04 / 12 / 1990' : field.includes('Phone') ? '(555) 867-5309' : 'Fixture value'}</i></label>`
    )
    .join('')}</div>
</section>`
    )
    .join('')
}

function intakePreview(input: {
  badge: string
  mode: 'compact' | 'guided' | 'source'
  option?: FlowStudioOption
  title: string
}): string {
  const steps = ['Patient info', 'Insurance', 'Medical history', 'Review']
  const option = input.option
  const fields = option
    ? formFields(option, input.mode === 'compact')
    : `<section class="source-progress"><div><b>68%</b><span>Profile complete</span></div><p>Required fields and validation appear across one long form without a clear recovery path.</p></section>
       <section class="form-group"><div class="form-group-heading"><span>01</span><h4>Patient information</h4></div><div class="field-grid"><label><span>First name</span><i>Jordan</i></label><label><span>Last name</span><i>Lee</i></label><label><span>Date of birth</span><i>04 / 12 / 1990</i></label><label><span>Phone</span><i>(555) 867-5309</i></label></div></section>`
  return `<article class="product-preview is-${input.mode}">
  <header><div><span class="product-mark">S</span><b>Smylr Intake</b></div><span class="truth-badge is-illustrative">${escapeHtml(input.badge)}</span></header>
  <div class="product-body"><aside><b>Intake</b><span>Patients</span><span>Appointments</span><span>Forms</span><span>Settings</span></aside><div class="form-canvas">
    <div class="form-title"><div><small>Synthetic fixture</small><h3>${escapeHtml(input.title)}</h3></div><button type="button">Save draft</button></div>
    <div class="stepper">${steps.map((step, index) => `<span class="${index === 0 ? 'is-current' : ''}"><i>${index + 1}</i>${escapeHtml(step)}</span>`).join('')}</div>
    <div class="form-scroll">${fields}</div>
    <footer><button type="button" class="quiet">Cancel</button><button type="button" class="primary">Next <span>→</span></button></footer>
  </div></div>
</article>`
}

function artifactMetadata(state: FlowStudioRenderState) {
  const source = JSON.stringify({
    evidenceManifest: { id: state.evidence.id, revision: state.evidence.revision },
    intent: { id: state.intent.id, revision: state.intent.revision },
    objectRefs: state.objectRefs,
    recommendations: state.options,
    spec: state.spec,
    surface: { id: state.surface.id, revision: state.surface.revision }
  })
  return {
    artifactId: state.surface.id,
    diagramType: 'experience-workspace',
    editingModel: 'typed-host-events',
    kind: 'flow-studio-surface',
    renderFormat: 'html-css-js',
    renderer: state.surface.rendererId,
    source,
    sourceHash: stableSourceHash(source),
    title: state.spec.title
  }
}

function viewTabs(state: FlowStudioRenderState): string {
  const labels: Record<FlowStudioView, string> = {
    compare: 'Compare',
    focus: 'Focus',
    overview: 'Overview',
    review: 'Review'
  }
  return state.spec.views
    .map(
      (view) =>
        `<button type="button" data-view-target="${view}" class="${view === 'focus' ? 'is-active' : ''}">${labels[view]}</button>`
    )
    .join('')
}

function evidenceRows(state: FlowStudioRenderState, limit = 3): string {
  return state.evidence.items
    .slice(0, limit)
    .map(
      (
        item
      ) => `<button type="button" class="evidence-row" data-evidence-id="${escapeHtml(item.id)}">
  <span class="truth-badge ${item.freshness === 'stale' ? 'is-stale' : ''}">${escapeHtml(truthLabel(item))}</span>
  <b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.summary)}</small>
</button>`
    )
    .join('')
}

function overviewView(state: FlowStudioRenderState): string {
  const preferred = state.options.find((option) => option.status === 'preferred')
  const stages = [
    ['01', 'Intent', 'Human goal', state.intent.id],
    ['02', 'Evidence', `${state.evidence.items.length} labeled sources`, state.evidence.id],
    ['03', 'Chosen form', 'Compare · explicit recipe', state.surface.rendererId],
    ['04', 'Interactive work', `${state.options.length} safe alternatives`, state.surface.id],
    [
      '05',
      'Decision',
      preferred ? preferred.title : 'Awaiting preference',
      preferred?.id ?? 'open'
    ],
    [
      '06',
      'Learning',
      state.receipt ? 'Exact receipt recorded' : 'Receipt follows approval',
      state.receipt?.id ?? 'pending'
    ]
  ]
  return `<section class="view overview-view" data-view="overview">
  <div class="view-heading"><div><span>Run overview</span><h2>${escapeHtml(state.spec.subject)}</h2></div><p>One shared identity moves through evidence, interaction, decision, and learning.</p></div>
  <div class="overview-grid"><div class="run-map">${stages
    .map(
      (
        [index, title, detail, id],
        ordinal
      ) => `<article class="run-stage ${ordinal === 3 ? 'is-current' : ''}">
      <span>${index}</span><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p><small>${escapeHtml(id)}</small></div>
    </article>${ordinal < stages.length - 1 ? '<i class="run-arrow">→</i>' : ''}`
    )
    .join('')}</div>
    <aside class="overview-rail"><div class="rail-title"><span>Evidence readiness</span><b>${state.evidence.status}</b></div>${evidenceRows(state)}<button type="button" class="text-link" data-view-target="focus">Open the working surface →</button></aside>
  </div>
</section>`
}

function focusView(state: FlowStudioRenderState): string {
  const firstOption = optionFor(state, state.options[0]?.id ?? '')
  return `<section class="view focus-view is-active" data-view="focus">
  <div class="view-heading"><div><span>Suggested: Compare · medium confidence</span><h2>${escapeHtml(state.intent.desiredOutcome)}</h2></div><p>Two plausible structures and a human decision make comparison more useful than prose.</p></div>
  <div class="focus-grid"><aside class="context-peek">
    <div class="context-block"><span>Intent</span><p>${escapeHtml(state.intent.statement)}</p></div>
    <div class="context-block"><span>Conversation</span>${state.spec.conversation.map((message) => `<blockquote><b>${message.author}</b>${escapeHtml(message.body)}</blockquote>`).join('')}</div>
    <div class="context-block"><span>Current decision</span><p>${escapeHtml(state.spec.decision.body)}</p><small>${state.spec.decision.status}</small></div>
  </aside>
  <div class="artifact-stage"><div class="stage-toolbar"><div><span class="truth-badge is-illustrative">Illustrative preview</span><b>Source unchanged</b></div><div><button type="button">Select</button><button type="button" class="is-active">Interact</button></div></div>${intakePreview({ badge: 'Illustrative · synthetic', mode: 'guided', option: firstOption, title: 'New patient registration' })}</div>
  <aside class="evidence-peek"><div class="rail-title"><span>Relevant evidence</span><b>3 of ${state.evidence.items.length}</b></div>${evidenceRows(state)}<div class="signal-list"><span>Selected signals</span>${state.spec.signals.map((signal) => `<div><b>${escapeHtml(signal.label)}</b><small>${escapeHtml(signal.truth)} · ${escapeHtml(signal.value)}</small></div>`).join('')}</div><button type="button" class="text-link" data-view-target="compare">Compare alternatives →</button></aside>
  </div>
</section>`
}

function compareView(state: FlowStudioRenderState): string {
  const preferredId = state.options.find((option) => option.status === 'preferred')?.id
  const selectedId = preferredId ?? state.options[0]?.id ?? ''
  const selected = optionFor(state, selectedId)
  return `<section class="view compare-view" data-view="compare">
  <div class="view-heading"><div><span>Source vs selected alternative</span><h2>Make the differences visible</h2></div><p>Only the selected alternative is expanded. The second option remains a tab.</p></div>
  <div class="variant-tabs"><button type="button" data-option-target="source">Source</button>${state.spec.options.map((option) => `<button type="button" data-option-target="${escapeHtml(option.id)}" class="${option.id === selectedId ? 'is-active' : ''}">${escapeHtml(option.label)} · ${escapeHtml(option.title)}</button>`).join('')}</div>
  <div class="compare-grid"><div class="compare-pane"><div class="pane-heading"><div><span>Reference</span><h3>Current intake structure</h3></div><span class="truth-badge is-illustrative">Illustrative</span></div>${intakePreview({ badge: 'Illustrative source reference', mode: 'source', title: 'Current intake form' })}</div>
  <div class="compare-pane variant-pane" data-active-option="${escapeHtml(selectedId)}"><div class="pane-heading"><div><span>Preview branch</span><h3 data-option-title>${escapeHtml(selected.title)}</h3></div><span class="truth-badge is-preview">Preview · source unchanged</span></div>${state.spec.options.map((option) => `<div class="option-preview ${option.id === selectedId ? 'is-visible' : ''}" data-option-panel="${escapeHtml(option.id)}">${intakePreview({ badge: 'Preview branch · synthetic', mode: option.id.includes('compact') ? 'compact' : 'guided', option, title: option.title })}</div>`).join('')}</div>
  <aside class="diff-rail"><div class="rail-title"><span>Visible differences</span><b>3</b></div><ol><li><b>Progress</b><span>Four named steps replace an ambiguous percentage.</span></li><li><b>Density</b><span>Field groups change visibly between guided and compact options.</span></li><li><b>Recovery</b><span>Insurance validation becomes an explicit step and risk.</span></li></ol><div class="preference-actions">${preferredId ? `<button type="button" data-action="unprefer" data-recommendation-id="${escapeHtml(preferredId)}">Clear preference</button>` : ''}<button type="button" class="primary-action" data-action="prefer" data-selected-option="${escapeHtml(selectedId)}">${preferredId ? 'Update preference' : 'Prefer selected option'}</button></div></aside></div>
</section>`
}

function reviewView(state: FlowStudioRenderState): string {
  const preferred = state.options.find((option) => option.status === 'preferred')
  const selected = optionFor(state, preferred?.id ?? state.options[0]?.id ?? '')
  const decided = state.surface.status === 'decided'
  return `<section class="view review-view" data-view="review">
  <div class="review-contract"><div><span>Feedback wanted</span><b>Structure, clarity, and visible recovery</b></div><div><span>Not evaluating</span><b>Production implementation or live patient data</b></div><span class="truth-badge is-preview">Source unchanged</span></div>
  <div class="review-grid"><div class="review-artifact"><div class="pane-heading"><div><span>${preferred ? 'Preferred alternative' : 'No preference yet'}</span><h2>${escapeHtml(selected.title)}</h2></div><span class="truth-badge is-illustrative">Illustrative preview</span></div>${intakePreview({ badge: 'Preview branch · synthetic', mode: selected.id.includes('compact') ? 'compact' : 'guided', option: selected, title: selected.title })}</div>
  <aside class="decision-rail"><div class="decision-state"><span>Decision</span><h3>${decided ? 'Recorded' : preferred ? 'Ready for approval' : 'Choose an option in Compare'}</h3><p>${escapeHtml(preferred?.rationale ?? 'A preference is required before approval.')}</p></div><dl><div><dt>Intent</dt><dd>${state.intent.revision}</dd></div><div><dt>Evidence</dt><dd>${state.evidence.items.length} sources</dd></div><div><dt>Surface</dt><dd>r${state.surface.revision}</dd></div><div><dt>Artifact</dt><dd>r${state.artifactRevision}</dd></div></dl><div class="receipt-box"><span>${state.receipt ? 'Decision receipt' : 'Receipt preview'}</span><b>${state.receipt?.id ?? 'Created only after approval'}</b><small>${state.surface.interactions.length} structured interaction${state.surface.interactions.length === 1 ? '' : 's'}</small></div><button type="button" class="approve-action" data-action="approve" ${!preferred || decided ? 'disabled' : ''}>${decided ? 'Decision recorded' : 'Approve decision'}</button><small class="source-note">Approval records knowledge only. Source and external systems remain unchanged.</small></aside></div>
</section>`
}

export function renderFlowStudioSurface(state: FlowStudioRenderState): {
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; navigate-to 'none'; base-uri 'none'; object-src 'none'"><script type="application/json" data-openpencil-artifact>${safeArtifact}</script></head><body><main class="experience" data-openpencil-width="1600" data-openpencil-height="1000" data-surface-id="${escapeHtml(state.surface.id)}" data-basis="${basis}">
  <header class="experience-header"><div class="brand"><span>OP</span><div><b>OpenPencil</b><small>Reusable Experience Setup · ${escapeHtml(state.surface.rendererId)}</small></div></div><nav aria-label="Experience views">${viewTabs(state)}</nav><div class="run-state"><span class="truth-badge is-illustrative">Illustrative example</span><b>${state.surface.status}</b></div></header>
  <div class="view-stack">${overviewView(state)}${focusView(state)}${compareView(state)}${reviewView(state)}</div>
  <div class="evidence-popover" hidden><button type="button" aria-label="Close evidence">×</button><span></span><h3></h3><p></p><small></small></div><div class="toast" role="status"></div>
</main></body></html>`
  const css = `:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:#111318;color:#f1f1f3}*{box-sizing:border-box}body{margin:0;background:#111318}.experience{width:1600px;height:1000px;display:grid;grid-template-rows:72px 1fr;overflow:hidden;background:radial-gradient(circle at 52% 12%,rgba(109,82,219,.1),transparent 38%),#15161a}.experience-header{display:grid;grid-template-columns:380px 1fr 380px;align-items:center;border-bottom:1px solid rgba(255,255,255,.08);padding:0 28px;background:rgba(13,14,17,.9)}.brand,.brand>div,.run-state{display:flex;align-items:center}.brand{gap:12px}.brand>span{display:grid;place-items:center;width:36px;height:36px;border:1px solid #9b82f3;border-radius:10px;color:#c7a9ff;font-weight:800}.brand>div{align-items:flex-start;flex-direction:column;gap:2px}.brand b{font-size:15px}.brand small{color:#8e919b;font-size:10px}.experience-header nav{display:flex;justify-content:center;height:100%;gap:6px}.experience-header nav button{position:relative;border:0;background:transparent;padding:0 22px;color:#8f929c;font:inherit;font-size:12px;cursor:pointer}.experience-header nav button:hover,.experience-header nav button.is-active{color:#fff}.experience-header nav button.is-active:after{position:absolute;right:14px;bottom:0;left:14px;height:2px;background:#9b82f3;content:""}.run-state{justify-content:flex-end;gap:12px;color:#9da0aa;font-size:11px}.run-state>b{text-transform:capitalize}.view-stack{min-height:0}.view{display:none;height:928px;padding:26px 32px 30px}.view.is-active{display:block}.view-heading{display:flex;align-items:flex-end;justify-content:space-between;min-height:66px;margin-bottom:20px}.view-heading>div>span,.pane-heading span,.rail-title span,.context-block>span,.signal-list>span,.decision-state>span,.review-contract span{color:#a69bcf;font-size:9px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.view-heading h2{margin:6px 0 0;font-size:28px;line-height:1.05;letter-spacing:-.03em}.view-heading>p{max-width:430px;margin:0;color:#9b9ea8;font-size:12px;line-height:1.5;text-align:right}.truth-badge{display:inline-flex;align-items:center;width:max-content;border:1px solid rgba(255,255,255,.12);border-radius:99px;padding:5px 8px;color:#b8bac3;font-size:8px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.truth-badge.is-illustrative,.truth-badge.is-stale{border-color:rgba(225,169,85,.38);color:#e1b270}.truth-badge.is-preview{border-color:rgba(155,130,243,.45);color:#c7b7ff}.overview-grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:24px;height:790px}.run-map{display:grid;grid-template-columns:1fr 34px 1fr 34px 1fr;align-content:center;gap:16px;padding:54px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:#1b1d22}.run-stage{display:flex;gap:14px;min-height:142px;border-top:1px solid rgba(255,255,255,.12);padding:22px 4px}.run-stage.is-current{border-color:#9b82f3}.run-stage>span{color:#716f79;font:500 22px Georgia,serif}.run-stage h3{margin:0;font-size:16px}.run-stage p{margin:9px 0;color:#b4b6be;font-size:11px;line-height:1.4}.run-stage small{color:#747781;font-size:8px}.run-arrow{align-self:center;color:#5d5f68;text-align:center}.overview-rail,.evidence-peek,.context-peek,.decision-rail,.diff-rail{border:1px solid rgba(255,255,255,.08);border-radius:14px;background:#1b1d22;padding:20px}.rail-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.rail-title b{color:#9dc9ad;font-size:10px;text-transform:capitalize}.evidence-row{display:grid;gap:7px;width:100%;border:0;border-top:1px solid rgba(255,255,255,.07);background:none;padding:14px 0;text-align:left;color:#fff;cursor:pointer}.evidence-row b{font-size:11px}.evidence-row small{display:-webkit-box;overflow:hidden;color:#8f929c;font-size:9px;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:2}.text-link{border:0;background:none;padding:18px 0;color:#bba8ff;font:inherit;font-size:10px;cursor:pointer}.focus-grid{display:grid;grid-template-columns:250px minmax(0,1fr) 300px;gap:22px;height:790px}.context-peek{overflow:auto}.context-block{padding:4px 0 18px;border-bottom:1px solid rgba(255,255,255,.07);margin-bottom:18px}.context-block p{margin:10px 0 0;color:#c9cad0;font-size:11px;line-height:1.55}.context-block small{color:#8cad98;font-size:9px}.context-block blockquote{margin:10px 0 0;border-left:2px solid rgba(155,130,243,.45);padding:2px 0 2px 10px;color:#aaaeb8;font-size:10px;line-height:1.5}.context-block blockquote b{display:block;margin-bottom:2px;color:#d6d7dc;font-size:8px;text-transform:uppercase}.artifact-stage{display:grid;grid-template-rows:44px minmax(0,1fr);min-width:0;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:#0d0e11;overflow:hidden}.stage-toolbar{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08);padding:0 14px}.stage-toolbar>div{display:flex;align-items:center;gap:10px}.stage-toolbar b{color:#92959e;font-size:9px}.stage-toolbar button{border:0;border-radius:6px;background:transparent;padding:6px 9px;color:#8f929b;font:inherit;font-size:9px}.stage-toolbar button.is-active{background:#9b82f3;color:white}.product-preview{display:grid;grid-template-rows:42px 1fr;min-width:0;height:100%;background:#f6f7fa;color:#20232a;overflow:hidden}.product-preview>header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dedfe4;padding:0 14px;background:#191b22;color:#f4f4f6}.product-preview>header>div{display:flex;align-items:center;gap:8px;font-size:11px}.product-mark{display:grid;place-items:center;width:23px;height:23px;border-radius:6px;background:#7658df;color:white;font-weight:800}.product-body{display:grid;grid-template-columns:112px minmax(0,1fr);min-height:0}.product-body>aside{display:flex;flex-direction:column;gap:8px;border-right:1px solid #dedfe4;padding:18px 12px;background:#22252d;color:#aaadb6;font-size:8px}.product-body>aside b{border-radius:5px;background:#6d50d1;padding:8px;color:white}.product-body>aside span{padding:6px}.form-canvas{display:grid;grid-template-rows:auto auto minmax(0,1fr) 48px;min-height:0;background:#f7f8fb}.form-title{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 10px}.form-title small{color:#80838d;font-size:7px;text-transform:uppercase}.form-title h3{margin:3px 0 0;font-size:15px}.form-title button,.product-preview footer button{border:1px solid #d7d8dd;border-radius:5px;background:white;padding:7px 10px;color:#4b4e57;font:inherit;font-size:8px}.stepper{display:grid;grid-template-columns:repeat(4,1fr);border-block:1px solid #e0e1e5;padding:10px 20px}.stepper span{display:flex;align-items:center;gap:6px;color:#8a8d96;font-size:7px}.stepper i{display:grid;place-items:center;width:17px;height:17px;border:1px solid #c8cad1;border-radius:50%;font-style:normal}.stepper span.is-current{color:#6648ca}.stepper span.is-current i{border-color:#7556dc;background:#7556dc;color:white}.form-scroll{overflow:auto;padding:12px 20px}.form-group{padding:10px 0 14px;border-bottom:1px solid #e1e2e6}.form-group.is-compact{padding:6px 0}.form-group-heading{display:flex;align-items:center;gap:8px;margin-bottom:8px}.form-group-heading>span{color:#8b8e97;font-size:7px}.form-group h4{margin:0;font-size:10px}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.is-compact .field-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.field-grid label{display:grid;gap:4px;color:#737680;font-size:7px}.field-grid i{display:block;min-height:26px;border:1px solid #d7d8dd;border-radius:4px;background:white;padding:7px;color:#454851;font-style:normal}.source-progress{display:grid;grid-template-columns:120px 1fr;gap:12px;border:1px solid #e0d4b8;border-radius:7px;background:#fffaf0;padding:12px;color:#5f5540}.source-progress>div{display:grid}.source-progress b{font-size:20px}.source-progress span,.source-progress p{font-size:8px}.product-preview footer{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #dedfe4;padding:0 20px;background:white}.product-preview footer .primary{border-color:#7556dc;background:#7556dc;color:white}.signal-list{display:grid;gap:10px;margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,.07)}.signal-list>div{display:grid;gap:3px}.signal-list b{font-size:9px}.signal-list small{color:#868994;font-size:8px}.variant-tabs{display:flex;gap:8px;height:38px;margin-bottom:14px}.variant-tabs button{border:1px solid rgba(255,255,255,.1);border-radius:8px;background:#1b1d22;padding:0 13px;color:#858892;font:inherit;font-size:9px;cursor:pointer}.variant-tabs button.is-active{border-color:#9b82f3;color:#d6ccff}.compare-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 276px;gap:18px;height:724px}.compare-pane{display:grid;grid-template-rows:54px minmax(0,1fr);min-width:0;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:#1b1d22;padding:10px;overflow:hidden}.pane-heading{display:flex;align-items:center;justify-content:space-between;padding:0 5px 9px}.pane-heading h3,.pane-heading h2{margin:4px 0 0;font-size:13px}.compare-pane .product-preview{border-radius:9px}.option-preview{display:none;min-height:0}.option-preview.is-visible{display:block;height:100%}.diff-rail ol{display:grid;gap:16px;margin:0;padding:0;list-style:none}.diff-rail li{display:grid;gap:4px;border-top:1px solid rgba(255,255,255,.07);padding-top:13px}.diff-rail li b{font-size:10px}.diff-rail li span{color:#92959f;font-size:9px;line-height:1.5}.preference-actions{display:grid;gap:8px;margin-top:24px}.preference-actions button,.primary-action,.approve-action{border:1px solid rgba(255,255,255,.14);border-radius:8px;background:transparent;padding:11px;color:#c8cad1;font:inherit;font-size:10px;cursor:pointer}.preference-actions .primary-action,.approve-action{border-color:#8d72ee;background:#7658df;color:white;font-weight:700}.review-contract{display:grid;grid-template-columns:1fr 1fr auto;align-items:center;gap:24px;height:74px;margin-bottom:18px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:#1b1d22;padding:0 20px}.review-contract>div{display:grid;gap:5px}.review-contract b{font-size:10px}.review-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:22px;height:784px}.review-artifact{display:grid;grid-template-rows:54px minmax(0,1fr);min-width:0;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:#1b1d22;padding:10px;overflow:hidden}.review-artifact .product-preview{border-radius:9px}.decision-rail{display:flex;flex-direction:column}.decision-state h3{margin:8px 0;font-size:18px}.decision-state p{color:#9a9da7;font-size:10px;line-height:1.5}.decision-rail dl{margin:16px 0}.decision-rail dl div{display:flex;justify-content:space-between;border-top:1px solid rgba(255,255,255,.07);padding:10px 0;font-size:9px}.decision-rail dt{color:#7e818c}.decision-rail dd{margin:0}.receipt-box{display:grid;gap:5px;border:1px solid rgba(155,130,243,.24);border-radius:10px;background:rgba(155,130,243,.08);padding:14px}.receipt-box span{color:#a79dcd;font-size:8px;text-transform:uppercase}.receipt-box b{overflow-wrap:anywhere;font-size:10px}.receipt-box small,.source-note{color:#8f929c;font-size:8px;line-height:1.45}.approve-action{margin-top:auto}.approve-action:disabled{border-color:rgba(255,255,255,.1);background:#34363c;color:#898c95;cursor:default}.source-note{margin-top:10px;text-align:center}.evidence-popover{position:absolute;right:34px;bottom:34px;width:340px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#23252b;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.45)}.evidence-popover button{float:right;border:0;background:none;color:#aaa;font-size:18px}.evidence-popover h3{margin:12px 0 8px;font-size:15px}.evidence-popover p,.evidence-popover small{color:#9a9da6;font-size:10px;line-height:1.5}.toast{position:absolute;right:32px;bottom:28px;border-radius:8px;background:#f4f4f5;padding:10px 14px;color:#202126;font-size:10px;opacity:0;transform:translateY(6px);transition:.18s;pointer-events:none}.toast.is-visible{opacity:1;transform:none}@media(max-width:1100px){.experience{width:100vw;height:auto;min-height:100vh}.experience-header{grid-template-columns:1fr auto}.experience-header nav{grid-row:2;grid-column:1/-1;height:42px}.run-state{display:none}.view{height:auto;min-height:calc(100vh - 114px)}.focus-grid,.compare-grid,.review-grid,.overview-grid{grid-template-columns:1fr;height:auto}.context-peek,.evidence-peek,.diff-rail,.decision-rail{max-height:none}.compare-pane{min-height:620px}.review-artifact{min-height:650px}.product-body{grid-template-columns:82px}.is-compact .field-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`
  const evidence = JSON.stringify(
    Object.fromEntries(
      state.evidence.items.map((item) => [
        item.id,
        {
          source: item.sourceRef,
          summary: item.summary,
          title: item.title,
          truth: truthLabel(item)
        }
      ])
    )
  ).replaceAll('<', '\\u003c')
  const js = `(() => {
  const root = document.querySelector('[data-surface-id]')
  if (!root) return
  const basis = JSON.parse(root.dataset.basis || '{}')
  const evidence = ${evidence}
  let pending = null
  let counter = 0
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
  const selectedOption = () => document.querySelector('.variant-tabs [data-option-target].is-active')?.dataset.optionTarget || '${escapeHtml(state.options[0]?.id ?? '')}'
  const selectOption = (id) => {
    if (id === 'source') return
    document.querySelectorAll('[data-option-target]').forEach((node) => node.classList.toggle('is-active', node.dataset.optionTarget === id))
    document.querySelectorAll('[data-option-panel]').forEach((node) => node.classList.toggle('is-visible', node.dataset.optionPanel === id))
    const action = document.querySelector('[data-action="prefer"]')
    if (action) action.dataset.selectedOption = id
  }
  const emit = (action, recommendationId) => {
    if (pending) return
    counter += 1
    pending = { action, eventId: 'flow-studio-' + Date.now() + '-' + counter, expected: basis, recommendationId, surfaceRunId: root.dataset.surfaceId }
    document.dispatchEvent(new CustomEvent('openpencil:surface-event', { detail: pending }))
    announce('Recording ' + action + '…')
  }
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!button) return
    if (button.dataset.viewTarget) return showView(button.dataset.viewTarget)
    if (button.dataset.optionTarget) return selectOption(button.dataset.optionTarget)
    if (button.dataset.evidenceId) {
      const detail = evidence[button.dataset.evidenceId]
      const popover = document.querySelector('.evidence-popover')
      if (!detail || !popover) return
      popover.hidden = false
      popover.querySelector('span').textContent = detail.truth
      popover.querySelector('h3').textContent = detail.title
      popover.querySelector('p').textContent = detail.summary
      popover.querySelector('small').textContent = detail.source
      return
    }
    if (button.closest('.evidence-popover')) {
      const popover = document.querySelector('.evidence-popover')
      if (popover) popover.hidden = true
      return
    }
    if (button.dataset.action === 'prefer') return emit('prefer', button.dataset.selectedOption || selectedOption())
    if (button.dataset.action === 'unprefer') return emit('unprefer', button.dataset.recommendationId)
    if (button.dataset.action === 'approve') return emit('approve')
  })
  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey)) return
    const views = ['overview', 'focus', 'compare', 'review']
    const index = Number(event.key) - 1
    if (index >= 0 && index < views.length) { event.preventDefault(); showView(views[index]) }
  })
  document.addEventListener('openpencil:surface-event-result', (event) => {
    const result = event.detail
    if (!pending || !result || result.eventId !== pending.eventId) return
    pending = null
    announce(result.status === 'rejected' ? (result.error || 'Change rejected') : 'Change recorded')
  })
})()`
  return { css, html, js, sourceHash: artifact.sourceHash }
}
