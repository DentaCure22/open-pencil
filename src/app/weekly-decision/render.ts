import type { EvidenceManifestItem } from '@/app/workspace'

import type { WeeklyDecisionRenderState } from './types'

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
  if (item.freshness === 'stale') return `${item.truthScope} · stale`
  return `${item.truthScope} · ${item.freshness}`
}

function artifactMetadata(state: WeeklyDecisionRenderState) {
  const source = JSON.stringify({
    evidenceManifest: {
      id: state.evidence.id,
      items: state.evidence.items,
      revision: state.evidence.revision
    },
    intent: { id: state.intent.id, revision: state.intent.revision },
    recommendations: state.recommendations,
    surface: { id: state.surface.id, revision: state.surface.revision }
  })
  return {
    artifactId: state.surface.id,
    diagramType: 'ranked-decision-surface',
    editingModel: 'typed-host-events',
    kind: 'weekly-decision-surface',
    renderFormat: 'html-css-js',
    renderer: state.surface.rendererId,
    source,
    sourceHash: stableSourceHash(source),
    title: state.surface.name
  }
}

function recommendationMarkup(state: WeeklyDecisionRenderState): string {
  return state.recommendations
    .map((recommendation, index) => {
      const rejected = recommendation.status === 'rejected'
      const evidenceCount = recommendation.evidenceItemIds.length
      return `<article class="priority ${rejected ? 'is-rejected' : ''}" data-recommendation-id="${escapeHtml(recommendation.id)}">
  <div class="rank" aria-label="Priority ${index + 1}">${String(index + 1).padStart(2, '0')}</div>
  <div class="priority-copy">
    <div class="priority-heading">
      <h2>${escapeHtml(recommendation.title)}</h2>
      <button class="evidence-link" type="button" data-evidence-id="${escapeHtml(recommendation.evidenceItemIds[0] ?? '')}">${evidenceCount} evidence</button>
    </div>
    <p>${escapeHtml(recommendation.rationale)}</p>
    <details><summary>Tradeoff and uncertainty</summary><div class="detail-grid"><span>${escapeHtml(recommendation.tradeoff)}</span><span>${escapeHtml(recommendation.uncertainty)}</span></div></details>
    <div class="revise-row" hidden><input maxlength="180" aria-label="Revision note" value="${escapeHtml(recommendation.title)}"><button type="button" data-action="revise">Save revision</button></div>
  </div>
  <div class="row-actions">
    <button type="button" data-action="up" aria-label="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
    <button type="button" data-action="down" aria-label="Move down" ${index === state.recommendations.length - 1 ? 'disabled' : ''}>↓</button>
    <button type="button" data-action="edit">Revise</button>
    <button type="button" data-action="${rejected ? 'restore' : 'reject'}">${rejected ? 'Undo reject' : 'Reject'}</button>
  </div>
</article>`
    })
    .join('')
}

function comparisonMarkup(state: WeeklyDecisionRenderState): string {
  return state.recommendations
    .map((recommendation, index) => {
      const preferred = recommendation.status === 'preferred'
      const evidenceCount = recommendation.evidenceItemIds.length
      return `<article class="alternative ${preferred ? 'is-preferred' : ''}" data-recommendation-id="${escapeHtml(recommendation.id)}">
  <div class="alternative-heading"><span>Option ${String(index + 1).padStart(2, '0')}</span><span>${preferred ? 'Preferred' : 'Available'}</span></div>
  <h2>${escapeHtml(recommendation.title)}</h2>
  <p>${escapeHtml(recommendation.rationale)}</p>
  <div class="alternative-detail"><div><small>Tradeoff</small><span>${escapeHtml(recommendation.tradeoff)}</span></div><div><small>Uncertainty</small><span>${escapeHtml(recommendation.uncertainty)}</span></div></div>
  <div class="alternative-actions"><button class="evidence-link" type="button" data-evidence-id="${escapeHtml(recommendation.evidenceItemIds[0] ?? '')}">${evidenceCount} evidence</button><button class="option-action" type="button" data-action="${preferred ? 'unprefer' : 'prefer'}">${preferred ? 'Clear preference' : 'Prefer this option'}</button></div>
</article>`
    })
    .join('')
}

function evidenceMarkup(state: WeeklyDecisionRenderState): string {
  return state.evidence.items
    .map(
      (
        item,
        index
      ) => `<section class="evidence-item ${index === 0 ? 'is-visible' : ''}" data-evidence-panel="${escapeHtml(item.id)}">
  <div class="truth-row"><span class="truth ${item.freshness === 'stale' ? 'is-stale' : ''}">${escapeHtml(truthLabel(item))}</span><span>${escapeHtml(item.retrievedAt.slice(0, 10))}</span></div>
  <h3>${escapeHtml(item.title)}</h3>
  <p>${escapeHtml(item.summary)}</p>
  <dl><div><dt>Source</dt><dd>${escapeHtml(item.sourceRef)}</dd></div><div><dt>Access</dt><dd>${escapeHtml(item.access)}</dd></div></dl>
</section>`
    )
    .join('')
}

function evidenceIndexMarkup(state: WeeklyDecisionRenderState): string {
  return state.evidence.items
    .map(
      (item) =>
        `<button type="button" data-evidence-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.truthScope)}</span>${escapeHtml(item.title)}</button>`
    )
    .join('')
}

export function renderWeeklyDecisionSurface(state: WeeklyDecisionRenderState): {
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
  const decided = state.surface.status === 'decided'
  const comparing = state.surface.jobKind === 'compare'
  const preferred = state.recommendations.some(
    (recommendation) => recommendation.status === 'preferred'
  )
  let approvalLabel = 'Approve this order'
  if (comparing) approvalLabel = 'Approve preference'
  if (decided) approvalLabel = 'Decision recorded'
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; navigate-to 'none'; base-uri 'none'; object-src 'none'"><script type="application/json" data-openpencil-artifact>${safeArtifact}</script></head><body><main class="decision" data-openpencil-width="1440" data-openpencil-height="900" data-surface-id="${escapeHtml(state.surface.id)}" data-basis="${basis}">
  <header>
    <div><p class="eyebrow">${comparing ? 'Comparison workbench' : 'Decision workbench'} · ${escapeHtml(state.surface.rendererId)}</p><h1>${escapeHtml(state.intent.desiredOutcome)}</h1></div>
    <div class="trust-strip"><span>Intent <b>locked</b></span><span>Evidence <b>${escapeHtml(state.evidence.status)}</b></span><span>Surface <b>${escapeHtml(state.surface.status)}</b></span><span>Writes <b>none</b></span></div>
  </header>
  <div class="workspace">
    <section class="${comparing ? 'alternatives' : 'priorities'}" aria-label="${comparing ? 'Comparable alternatives' : 'Ranked priorities'}">${comparing ? comparisonMarkup(state) : recommendationMarkup(state)}</section>
    <aside class="evidence" aria-label="Evidence detail"><div class="aside-title"><span>Evidence peek</span><span>${state.evidence.items.length} sources</span></div>${evidenceMarkup(state)}<details class="source-index"><summary>Browse all evidence</summary><div>${evidenceIndexMarkup(state)}</div></details></aside>
  </div>
  <footer><div><strong>${state.surface.interactions.length} interaction${state.surface.interactions.length === 1 ? '' : 's'} recorded</strong><span>Every material choice is bound to exact workspace, surface, and artifact revisions.</span></div><button class="approve" type="button" data-action="approve" ${decided || (comparing && !preferred) ? 'disabled' : ''}>${approvalLabel}</button></footer>
  <div class="toast" role="status" aria-live="polite"></div>
</main></body></html>`

  const css = `:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#161816;background:#f4f4ef}*{box-sizing:border-box}body{margin:0}.decision{width:1440px;height:900px;display:grid;grid-template-rows:108px 1fr 84px;background:#f4f4ef;color:#171917;overflow:hidden}header{display:flex;justify-content:space-between;align-items:flex-end;padding:26px 34px 20px;border-bottom:1px solid #d9dad3;background:#f8f8f4}.eyebrow{margin:0 0 8px;color:#6c7068;font-size:11px;font-weight:750;letter-spacing:.13em;text-transform:uppercase}h1{margin:0;max-width:720px;font-family:Georgia,serif;font-size:30px;font-weight:500;letter-spacing:-.025em;line-height:1.08}.trust-strip{display:flex;gap:8px;align-items:center}.trust-strip span{display:flex;gap:5px;border:1px solid #d7d8d0;border-radius:999px;padding:6px 10px;color:#70746d;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.trust-strip b{color:#2f5e49}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 344px;min-height:0}.priorities,.alternatives{padding:20px 22px 18px 34px;overflow:auto}.priority{display:grid;grid-template-columns:48px minmax(0,1fr) 112px;gap:16px;min-height:176px;padding:23px 0;border-bottom:1px solid #d6d7d0;transition:opacity .18s}.priority:first-child{padding-top:8px}.priority.is-rejected{opacity:.42}.rank{font-family:Georgia,serif;color:#9b9d96;font-size:18px}.priority-heading{display:flex;align-items:baseline;justify-content:space-between;gap:16px}.priority h2{margin:0;font-family:Georgia,serif;font-size:27px;font-weight:500;letter-spacing:-.025em}.priority p{max-width:760px;margin:12px 0;color:#555a53;font-size:13px;line-height:1.55}.alternatives{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:center;gap:18px}.alternative{display:flex;flex-direction:column;min-height:470px;border:1px solid #d1d3cb;border-radius:12px;background:#fafaf6;padding:26px;transition:border-color .18s,box-shadow .18s}.alternative.is-preferred{border-color:#4d8068;box-shadow:0 0 0 2px #2e624a1f}.alternative-heading{display:flex;justify-content:space-between;color:#777c74;font-size:9px;font-weight:750;letter-spacing:.09em;text-transform:uppercase}.alternative.is-preferred .alternative-heading span:last-child{color:#1f6547}.alternative h2{margin:42px 0 14px;font-family:Georgia,serif;font-size:33px;font-weight:500;letter-spacing:-.03em}.alternative>p{margin:0;color:#555a53;font-size:13px;line-height:1.6}.alternative-detail{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:28px;border-top:1px solid #dcddd6;padding-top:18px}.alternative-detail>div{display:grid;gap:7px}.alternative-detail small{color:#797d76;font-size:9px;font-weight:750;text-transform:uppercase}.alternative-detail span{color:#555a53;font-size:11px;line-height:1.5}.alternative-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:auto;padding-top:24px}.option-action{border:0;border-radius:7px;background:#1f4d3a;padding:11px 14px;color:white;font:inherit;font-size:10px;font-weight:750;cursor:pointer}.is-preferred .option-action{border:1px solid #aeb8b1;background:transparent;color:#315943}.evidence-link,details summary{border:0;background:none;color:#285d46;font:inherit;font-size:11px;font-weight:700;cursor:pointer}.evidence-link{white-space:nowrap;text-decoration:underline;text-underline-offset:3px}details summary{display:inline-block}details .detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:9px;padding:12px 14px;border-left:2px solid #9eb6a9;color:#595d57;font-size:11px;line-height:1.45}.row-actions{display:flex;flex-wrap:wrap;align-content:flex-start;justify-content:flex-end;gap:5px}.row-actions button,.revise-row button{border:1px solid #cccec6;border-radius:6px;background:#fafaf6;padding:6px 8px;color:#50544e;font:inherit;font-size:10px;cursor:pointer}.row-actions button:disabled{opacity:.25;cursor:not-allowed}.revise-row{display:flex;gap:6px;margin-top:10px}.revise-row input{flex:1;border:1px solid #c9cbc3;border-radius:7px;background:white;padding:8px 10px;font:inherit;font-size:12px}.evidence{border-left:1px solid #d7d8d1;background:#e8ebe4;padding:20px 20px;overflow:auto}.aside-title{display:flex;justify-content:space-between;margin-bottom:24px;color:#646961;font-size:10px;font-weight:750;letter-spacing:.09em;text-transform:uppercase}.evidence-item{display:none}.evidence-item.is-visible{display:block}.truth-row{display:flex;justify-content:space-between;align-items:center;color:#777b75;font-size:10px}.truth{border:1px solid #93aa9e;border-radius:99px;padding:5px 8px;color:#285d46;font-weight:750;text-transform:uppercase}.truth.is-stale{border-color:#b89869;color:#7a5626}.evidence h3{margin:22px 0 10px;font-family:Georgia,serif;font-size:24px;font-weight:500;line-height:1.15}.evidence p{color:#555b54;font-size:12px;line-height:1.6}.evidence dl{margin-top:26px}.evidence dl div{display:grid;grid-template-columns:58px 1fr;gap:10px;padding:10px 0;border-top:1px solid #ced2c9;font-size:10px}.evidence dt{color:#777b75;text-transform:uppercase}.evidence dd{margin:0;overflow-wrap:anywhere;color:#363a35}.source-index{margin-top:28px;padding-top:14px;border-top:1px solid #c8cdc4}.source-index summary{text-transform:uppercase;letter-spacing:.07em}.source-index>div{display:grid;gap:4px;margin-top:10px}.source-index button{display:flex;gap:8px;width:100%;border:0;border-radius:6px;background:transparent;padding:6px;text-align:left;color:#4b5049;font:inherit;font-size:10px;line-height:1.25;cursor:pointer}.source-index button:hover{background:#dce1d8}.source-index button span{min-width:56px;color:#6f746c;font-size:8px;font-weight:750;text-transform:uppercase}footer{display:flex;align-items:center;justify-content:space-between;padding:16px 34px;border-top:1px solid #d6d7d0;background:#f8f8f4}footer div{display:flex;flex-direction:column;gap:4px}footer strong{font-size:12px}footer span{color:#6c706a;font-size:10px}.approve{min-width:170px;border:0;border-radius:8px;background:#1f4d3a;padding:13px 18px;color:white;font:inherit;font-size:12px;font-weight:750;cursor:pointer}.approve:disabled{background:#829088;cursor:default}.toast{position:fixed;right:24px;bottom:96px;max-width:340px;border-radius:8px;background:#202420;padding:10px 14px;color:white;font-size:11px;opacity:0;transform:translateY(6px);transition:.18s;pointer-events:none}.toast.is-visible{opacity:1;transform:none}@media(max-width:900px){.decision{width:100vw;height:auto;min-height:100vh;grid-template-rows:auto 1fr auto}header{align-items:flex-start;gap:18px}.trust-strip{flex-wrap:wrap}.workspace{grid-template-columns:1fr}.alternatives{grid-template-columns:1fr}.alternative{min-height:360px}.evidence{border-top:1px solid #d7d8d1;border-left:0}.priority{grid-template-columns:38px minmax(0,1fr)}.row-actions{grid-column:2;justify-content:flex-start}footer{gap:18px}}`

  const js = `(() => {
  const root = document.querySelector('[data-surface-id]')
  if (!root) return
  const basis = JSON.parse(root.dataset.basis || '{}')
  let counter = 0
  let pending = null
  const toast = document.querySelector('.toast')
  const announce = (message) => {
    if (!toast) return
    toast.textContent = message
    toast.classList.add('is-visible')
    setTimeout(() => toast.classList.remove('is-visible'), 2400)
  }
  const emit = (action, recommendationId, extra = {}) => {
    if (pending) return
    counter += 1
    pending = {
      action,
      eventId: 'weekly-decision-' + Date.now() + '-' + counter,
      expected: basis,
      recommendationId,
      surfaceRunId: root.dataset.surfaceId,
      ...extra
    }
    document.dispatchEvent(new CustomEvent('openpencil:surface-event', { detail: pending }))
    announce('Recording ' + action + '…')
  }
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!button) return
    const recommendation = button.closest('[data-recommendation-id]')
    const recommendationId = recommendation?.dataset.recommendationId
    const action = button.dataset.action
    if (button.dataset.evidenceId) {
      document.querySelectorAll('[data-evidence-panel]').forEach((panel) => panel.classList.toggle('is-visible', panel.getAttribute('data-evidence-panel') === button.dataset.evidenceId))
      return
    }
    if (action === 'edit') {
      const row = recommendation?.querySelector('.revise-row')
      if (row instanceof HTMLElement) row.hidden = !row.hidden
      return
    }
    if (action === 'revise') {
      const input = recommendation?.querySelector('input')
      if (input instanceof HTMLInputElement) emit('revise', recommendationId, { note: input.value })
      return
    }
    if (action === 'up' || action === 'down') {
      const rows = [...document.querySelectorAll('[data-recommendation-id]')]
      const index = rows.indexOf(recommendation)
      emit('reorder', recommendationId, { toIndex: action === 'up' ? index - 1 : index + 1 })
      return
    }
    if (action === 'prefer' || action === 'unprefer') {
      emit(action, recommendationId)
      return
    }
    if (action === 'reject' || action === 'restore') emit(action, recommendationId)
    if (action === 'approve') emit('approve')
  })
  document.addEventListener('keydown', (event) => {
    if (!(event.target instanceof Element) || !event.altKey) return
    const recommendation = event.target.closest('[data-recommendation-id]')
    if (!recommendation) return
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const rows = [...document.querySelectorAll('[data-recommendation-id]')]
      const index = rows.indexOf(recommendation)
      emit('reorder', recommendation.dataset.recommendationId, { toIndex: event.key === 'ArrowUp' ? index - 1 : index + 1 })
    }
  })
  document.addEventListener('openpencil:surface-event-result', (event) => {
    const result = event.detail
    if (!pending || !result || result.eventId !== pending.eventId) return
    pending = null
    announce(result.status === 'rejected' ? (result.error || 'Change rejected') : 'Change recorded')
  })
})()`
  const comparisonDensityCss = `.alternative{min-height:400px}.alternative h2{margin-top:30px}.alternative-detail{margin-top:24px}.alternative-actions{padding-top:20px}@media(max-width:900px){.alternative{min-height:360px}}`
  return { css: `${css}${comparisonDensityCss}`, html, js, sourceHash: artifact.sourceHash }
}
