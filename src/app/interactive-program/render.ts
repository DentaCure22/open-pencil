import type { EvidenceManifestItem } from '@/app/workspace'

import type {
  InteractiveProgramRenderState,
  ProgramFormulaNode,
  ProgramFormulaOperand
} from './types'

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

function artifactMetadata(state: InteractiveProgramRenderState) {
  const source = JSON.stringify({
    evidenceManifest: { id: state.evidence.id, revision: state.evidence.revision },
    intent: { id: state.intent.id, revision: state.intent.revision },
    spec: state.spec,
    surface: { id: state.surface.id, revision: state.surface.revision }
  })
  return {
    artifactId: state.surface.id,
    diagramType: 'interactive-program',
    editingModel: 'declarative-model-host-events',
    kind: 'interactive-program-surface',
    renderFormat: 'html-css-js',
    renderer: state.surface.rendererId,
    source,
    sourceHash: stableSourceHash(source),
    title: state.spec.title
  }
}

function operandLabel(operand: ProgramFormulaOperand): string {
  if (operand.kind === 'constant') return String(operand.value)
  if (operand.kind === 'input') return operand.inputId
  if (operand.kind === 'metric') return operand.metricId
  return operand.nodeId
}

function nodeRule(node: ProgramFormulaNode): string {
  const symbol = {
    abs: 'absolute',
    add: '+',
    divide: '÷',
    max: 'maximum',
    min: 'minimum',
    multiply: '×',
    subtract: '−'
  }[node.op]
  return `${node.operands.map(operandLabel).join(` ${symbol} `)} → ${node.id}`
}

function modelRule(state: InteractiveProgramRenderState): string {
  const model = state.spec.model
  if (model.kind === 'weighted-priority')
    return 'Multiply each declared metric by its adjustable weight, add the results, and select the highest score.'
  if (model.kind === 'capacity-planner')
    return `Rank by ${model.valueMetricId} ÷ ${model.effortMetricId}, then greedily include work within ${model.capacityInputId}.`
  const selection =
    model.selection.kind === 'top-n'
      ? `select top ${model.selection.count}`
      : `select score ${model.selection.comparator === 'gte' ? '≥' : '≤'} ${model.selection.value}`
  return `${model.nodes.map(nodeRule).join(' · ')} · ${model.order === 'descending' ? 'higher first' : 'lower first'} · ${selection}.`
}

function evidenceTruth(item: EvidenceManifestItem): string {
  return `${item.truthScope} · ${item.freshness}`
}

function inputs(state: InteractiveProgramRenderState): string {
  return state.spec.inputs
    .map((input) => {
      const value = state.scenario[input.id]
      const id = escapeHtml(input.id)
      return `<div class="control" data-test-id="interactive-program-input-${id}"><div><label for="range-${id}">${escapeHtml(input.label)}</label><output data-output-for="${id}">${value}</output></div><div class="control-row"><input id="range-${id}" type="range" min="${input.min}" max="${input.max}" step="${input.step}" value="${value}" data-input-id="${id}"><input aria-label="Exact ${escapeHtml(input.label)}" type="number" min="${input.min}" max="${input.max}" step="${input.step}" value="${value}" data-input-id="${id}"></div><small>${escapeHtml(input.description)}${input.unit ? ` · ${escapeHtml(input.unit)}` : ''}</small></div>`
    })
    .join('')
}

function results(state: InteractiveProgramRenderState): string {
  const primary = state.results.find((result) => result.selected) ?? state.results[0]
  const ledger = state.results
    .filter((result) => result.itemId !== primary.itemId)
    .map(
      (result) =>
        `<article class="ledger-row ${result.selected ? 'is-selected' : ''}" data-result-id="${escapeHtml(result.itemId)}" data-test-id="interactive-program-result-${escapeHtml(result.itemId)}"><span>${String(result.rank).padStart(2, '0')}</span><div><b>${escapeHtml(result.label)}</b><small>${escapeHtml(result.explanation)}</small></div><strong>${result.score.toFixed(2)}</strong></article>`
    )
    .join('')
  return `<article class="primary-result" data-result-id="${escapeHtml(primary.itemId)}" data-test-id="interactive-program-primary-result"><div class="primary-meta"><span>Selected by the declared rule</span><b>${primary.score.toFixed(2)}</b></div><h2>${escapeHtml(primary.label)}</h2><p>${escapeHtml(primary.explanation)}</p><footer><span>${primary.evidenceItemIds.length} cited source${primary.evidenceItemIds.length === 1 ? '' : 's'}</span><span>Captured model · not objective truth</span></footer></article><div class="ledger"><div class="ledger-head"><b>Ranked ledger</b><span>${state.results.length} options</span></div>${ledger}</div>`
}

function overview(state: InteractiveProgramRenderState): string {
  return `<section class="view" data-view="overview" data-test-id="interactive-program-view-overview"><div class="hero"><span>Executable knowledge model</span><h1>${escapeHtml(state.spec.title)}</h1><p>${escapeHtml(state.spec.subtitle)}</p><div class="loop"><b>Human intent</b><i>→</i><b>Captured evidence</b><i>→</i><b>Interactive answer</b><i>→</i><b>Decision receipt</b></div><aside><b>What this proves</b><p>A person can author a bounded model as data, explore it as a live experience, and preserve the exact reasoning without granting code or system access.</p></aside></div></section>`
}

function explore(state: InteractiveProgramRenderState): string {
  return `<section class="view is-active" data-view="explore" data-test-id="interactive-program-view-explore"><div class="question-band"><div><span class="eyebrow">Question</span><h1>${escapeHtml(state.intent.statement)}</h1></div><div><span>Model</span><b>${escapeHtml(state.spec.model.kind)}</b><small>r${state.surface.revision} · ${escapeHtml(state.surface.status)}</small></div></div><div class="focus" data-test-id="interactive-program-focus"><aside class="controls"><span class="eyebrow">Scenario</span>${inputs(state)}<div class="boundary" data-test-id="interactive-program-capability-boundary"><b>Safe by construction</b><span>Captured evidence · deterministic host model · no network · no source or external writes</span></div></aside><div class="answer"><div class="rule" data-test-id="interactive-program-model-rule"><span>Declared rule</span><p>${escapeHtml(modelRule(state))}</p></div><div data-results>${results(state)}</div></div></div></section>`
}

function evidence(state: InteractiveProgramRenderState): string {
  return `<section class="view" data-view="evidence" data-test-id="interactive-program-view-evidence"><div class="evidence-head"><div><span class="eyebrow">Fixed snapshot</span><h1>Exact evidence behind this model</h1></div><p>Inputs change the calculation, never the evidence. Captured scores are assumptions unless a stronger source establishes them.</p></div><div class="evidence-grid">${state.evidence.items
    .map(
      (item, index) =>
        `<article><span>${String(index + 1).padStart(2, '0')}</span><small>${escapeHtml(evidenceTruth(item))}</small><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.summary)}</p><code>${escapeHtml(item.sourceRef)}</code></article>`
    )
    .join('')}</div></section>`
}

function review(state: InteractiveProgramRenderState): string {
  const decided = state.surface.status === 'decided'
  const selected = state.results.filter((result) => result.selected)
  return `<section class="view" data-view="review" data-test-id="interactive-program-view-review"><div class="review"><article><span class="eyebrow">Knowledge checkpoint</span><h1>${decided ? 'This scenario is recorded.' : 'Record this exact scenario?'}</h1><p>${escapeHtml(state.intent.desiredOutcome)}</p><div class="selected">${selected.map((result) => `<div><b>${escapeHtml(result.label)}</b><span>${escapeHtml(result.explanation)}</span></div>`).join('')}</div></article><aside data-test-id="interactive-program-exact-basis"><span>Exact basis</span><dl><div><dt>Model</dt><dd>${escapeHtml(state.spec.model.kind)}</dd></div><div><dt>Evidence</dt><dd>${state.evidence.id}@${state.evidence.revision}</dd></div><div><dt>Surface</dt><dd>${state.surface.id}@${state.surface.revision}</dd></div><div><dt>Adjustments</dt><dd>${state.surface.interactions.filter((item) => item.action === 'adjust').length}</dd></div></dl><button type="button" data-action="approve" data-test-id="interactive-program-approve" ${decided ? 'disabled' : ''}>${decided ? 'Scenario recorded' : 'Record decision knowledge'}</button><small>This creates a DecisionReceipt. It does not execute work, modify source, or change an external system.</small></aside></div></section>`
}

export function renderInteractiveProgram(state: InteractiveProgramRenderState): {
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; navigate-to 'none'; base-uri 'none'; object-src 'none'"><script type="application/json" data-openpencil-artifact>${safeArtifact}</script></head><body><main class="program" data-openpencil-width="1500" data-openpencil-height="940" data-surface-id="${escapeHtml(state.surface.id)}" data-basis="${basis}"><header class="top"><div class="brand"><i>OP</i><div><b>OpenPencil</b><small>Executable knowledge</small></div></div><nav><button data-view-target="overview">Overview</button><button class="is-active" data-view-target="explore">Focus</button><button data-view-target="evidence">Evidence</button><button data-view-target="review">Review</button></nav><div class="status"><span>${escapeHtml(state.spec.model.kind)}</span><b>${escapeHtml(state.surface.status)}</b></div></header><div class="views">${overview(state)}${explore(state)}${evidence(state)}${review(state)}</div><div class="toast" role="status"></div></main></body></html>`
  const css = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e9ebf2;background:#0a0d12}*{box-sizing:border-box}body{margin:0}.program{position:relative;width:1500px;height:940px;overflow:hidden;background:linear-gradient(145deg,#0b0f15 0,#0a1118 58%,#0c111a 100%)}.top{display:grid;grid-template-columns:330px 1fr 330px;align-items:center;height:68px;border-bottom:1px solid #222a34;background:#0b0f15f2;padding:0 30px}.brand{display:flex;align-items:center;gap:11px}.brand i{display:grid;place-items:center;width:34px;height:34px;border:1px solid #7561dc;border-radius:9px;color:#ae9cff;font-style:normal;font-size:9px}.brand div{display:grid}.brand b{font-size:13px}.brand small{color:#707a87;font-size:8px}.top nav{display:flex;justify-content:center;height:100%}.top nav button{position:relative;border:0;background:none;padding:0 19px;color:#79838f;font:inherit;font-size:10px;cursor:pointer}.top nav button.is-active{color:#f3f4f7}.top nav button.is-active:after{position:absolute;right:15px;bottom:0;left:15px;height:2px;background:#8a70ef;content:""}.status{display:flex;justify-content:flex-end;align-items:center;gap:12px;font-size:8px}.status span{color:#8893a0}.status b{border:1px solid #33413f;border-radius:99px;padding:5px 8px;color:#8edaae;text-transform:capitalize}.views,.view{height:872px}.view{display:none;padding:30px 40px}.view.is-active{display:block}.eyebrow,.hero>span{color:#a694f5;font-size:8px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.hero{display:flex;flex-direction:column;justify-content:center;max-width:1180px;height:100%;margin:auto}.hero h1{max-width:900px;margin:14px 0 12px;font-size:60px;line-height:1.02;letter-spacing:-.045em}.hero>p{max-width:760px;color:#919ba9;font-size:17px;line-height:1.6}.loop{display:flex;align-items:center;gap:22px;margin-top:52px;border-top:1px solid #28303a;border-bottom:1px solid #28303a;padding:23px 0}.loop b{font-size:12px}.loop i{color:#59636f;font-style:normal}.hero aside{max-width:560px;margin-top:38px;border-left:2px solid #8068e8;padding-left:18px}.hero aside p{color:#8994a1;font-size:10px;line-height:1.6}.question-band{display:grid;grid-template-columns:1fr 190px;align-items:end;min-height:116px;border-bottom:1px solid #242c35;padding:0 8px 22px}.question-band h1{max-width:980px;margin:8px 0 0;font-size:28px;line-height:1.15;letter-spacing:-.025em}.question-band>div:last-child{display:grid;justify-items:end;gap:4px;color:#76818f;font-size:8px}.question-band>div:last-child b{color:#b7a7ff;font-size:10px}.focus{display:grid;grid-template-columns:32% 1fr;gap:30px;height:688px;padding-top:26px}.controls{overflow:auto;border-right:1px solid #252e38;padding:8px 28px 0 8px}.control{display:grid;gap:10px;border-top:1px solid #252e38;padding:20px 0}.control:first-of-type{margin-top:18px}.control>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:16px}.control label{font-size:11px;font-weight:650}.control output{min-width:44px;border-radius:6px;background:#7861dc;padding:5px 8px;color:#fff;text-align:center;font-size:10px}.control-row{display:grid;grid-template-columns:1fr 70px;gap:12px}.control input[type=range]{width:100%;accent-color:#8c72ef}.control input[type=number]{width:70px;border:1px solid #303947;border-radius:5px;background:#0c1219;padding:5px 7px;color:#e9ebf2;font:inherit;font-size:9px}.control small{color:#77828f;font-size:8px;line-height:1.5}.boundary{display:grid;gap:7px;margin-top:22px;border-left:2px solid #7160c7;padding:8px 0 8px 14px}.boundary b{font-size:9px}.boundary span{color:#737e8b;font-size:8px;line-height:1.55}.answer{overflow:auto;padding:4px 8px 0 0}.rule{display:grid;grid-template-columns:100px 1fr;gap:16px;border-bottom:1px solid #252e38;padding:0 0 18px}.rule span{color:#a692f4;font-size:8px;font-weight:700;text-transform:uppercase}.rule p{margin:0;color:#8c96a3;font-size:9px;line-height:1.6}.primary-result{margin-top:24px;border-left:3px solid #8469eb;background:linear-gradient(90deg,#181b2d 0,#101721 78%);padding:28px 30px 26px}.primary-meta{display:flex;justify-content:space-between;color:#a894ff;font-size:8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.primary-meta b{color:#c9bdff;font-size:24px;letter-spacing:-.04em}.primary-result h2{max-width:780px;margin:18px 0 12px;font-size:38px;line-height:1.04;letter-spacing:-.035em}.primary-result p{max-width:800px;margin:0;color:#929daa;font-size:11px;line-height:1.65}.primary-result footer{display:flex;gap:20px;margin-top:28px;border-top:1px solid #303747;padding-top:15px;color:#788390;font-size:8px}.ledger{margin-top:22px}.ledger-head{display:flex;justify-content:space-between;padding:0 4px 9px;color:#77828f;font-size:8px}.ledger-head b{color:#a5aeba;text-transform:uppercase}.ledger-row{display:grid;grid-template-columns:34px 1fr 70px;align-items:center;gap:16px;border-top:1px solid #252e38;padding:15px 4px}.ledger-row>span{color:#65707e;font-size:9px}.ledger-row div{display:grid;gap:5px}.ledger-row b{font-size:11px}.ledger-row small{color:#727e8c;font-size:8px}.ledger-row strong{color:#aba0db;font-size:12px;text-align:right}.ledger-row.is-selected b{color:#b9a9ff}.evidence-head{display:flex;align-items:end;justify-content:space-between;max-width:1220px;margin:22px auto 34px}.evidence-head h1{margin:8px 0 0;font-size:38px}.evidence-head p{max-width:470px;color:#84909d;font-size:9px;line-height:1.65;text-align:right}.evidence-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:1220px;margin:auto}.evidence-grid article{min-height:320px;border-top:2px solid #4a455f;background:#0e141c;padding:24px}.evidence-grid article>span{color:#626d7a;font-size:9px}.evidence-grid small{display:block;margin-top:20px;color:#a894f5;font-size:8px;text-transform:uppercase}.evidence-grid h2{margin:13px 0 10px;font-size:21px}.evidence-grid p{color:#828e9c;font-size:9px;line-height:1.65}.evidence-grid code{display:block;margin-top:38px;color:#66727f;font-size:8px;overflow-wrap:anywhere}.review{display:grid;grid-template-columns:1fr 360px;gap:50px;align-items:center;max-width:1160px;height:100%;margin:auto}.review h1{max-width:700px;margin:16px 0;font-size:50px;line-height:1.05}.review article>p{max-width:680px;color:#919ca9;font-size:15px;line-height:1.6}.selected{display:grid;gap:10px;margin-top:30px}.selected>div{display:grid;gap:5px;border-left:2px solid #8067e7;padding:10px 14px}.selected b{font-size:11px}.selected span{color:#7d8996;font-size:8px}.review aside{border:1px solid #2d3641;background:#0e151d;padding:24px}.review aside>span{color:#a590f4;font-size:8px;text-transform:uppercase}.review dl{margin:18px 0}.review dl div{display:flex;justify-content:space-between;border-top:1px solid #29323c;padding:11px 0;font-size:8px}.review dd{max-width:210px;margin:0;text-align:right;overflow-wrap:anywhere}.review button{width:100%;border:0;border-radius:6px;background:#7962dd;padding:13px;color:white;font:inherit;font-size:9px;font-weight:700;cursor:pointer}.review button:disabled{background:#39424d;color:#818b96}.review aside>small{display:block;margin-top:12px;color:#737e8b;font-size:8px;line-height:1.55;text-align:center}.toast{position:absolute;right:28px;bottom:24px;border-radius:7px;background:#e8ebf4;padding:10px 14px;color:#111923;font-size:9px;opacity:0;transform:translateY(5px);transition:.18s}.toast.is-visible{opacity:1;transform:none}@media(max-width:1000px){.program{width:100vw;height:auto;min-height:100vh}.top{grid-template-columns:1fr auto;height:auto;min-height:68px}.top nav{grid-row:2;grid-column:1/-1;height:42px}.status{display:none}.views,.view{height:auto}.question-band{grid-template-columns:1fr}.question-band>div:last-child{display:none}.focus,.review{grid-template-columns:1fr;height:auto}.controls{overflow:visible;border-right:0;border-bottom:1px solid #252e38;padding-right:8px;padding-bottom:24px}.answer{overflow:visible}.evidence-grid{grid-template-columns:1fr}}`
  const js = `(() => {
  const root = document.querySelector('[data-surface-id]')
  if (!root) return
  const basis = JSON.parse(root.dataset.basis || '{}')
  const toast = document.querySelector('.toast')
  const announce = (message) => { if (!toast) return; toast.textContent = message; toast.classList.add('is-visible'); setTimeout(() => toast.classList.remove('is-visible'), 1800) }
  const dispatch = (detail) => document.dispatchEvent(new CustomEvent('openpencil:surface-event', { detail: { ...detail, eventId: 'interactive-program-' + Date.now(), expected: basis, surfaceRunId: root.dataset.surfaceId } }))
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!button) return
    if (button.dataset.viewTarget) { document.querySelectorAll('[data-view]').forEach((node)=>node.classList.toggle('is-active',node.dataset.view===button.dataset.viewTarget)); document.querySelectorAll('[data-view-target]').forEach((node)=>node.classList.toggle('is-active',node===button)); return }
    if (button.dataset.action === 'approve') { dispatch({action:'approve'}); announce('Recording decision knowledge…') }
  })
  document.addEventListener('input', (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null
    if (!input?.dataset.inputId) return
    document.querySelectorAll('[data-input-id="'+input.dataset.inputId+'"]').forEach((node) => { if (node !== input) node.value = input.value })
    const output = document.querySelector('[data-output-for="'+input.dataset.inputId+'"]'); if(output) output.textContent=input.value
  })
  document.addEventListener('change', (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null
    if (!input?.dataset.inputId) return
    dispatch({action:'adjust',inputId:input.dataset.inputId,value:Number(input.value)})
    announce('Saving scenario input…')
  })
  document.addEventListener('openpencil:surface-event-result', (event) => { const result=event.detail; if(result?.status==='rejected') announce(result.error||'Change rejected') })
})()`
  return { css, html, js, sourceHash: artifact.sourceHash }
}
