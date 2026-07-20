import type { EvidenceManifestItem } from '@/app/workspace'

import type { SequentialPresentationRenderState, SequentialPresentationSlide } from './types'

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

function artifactMetadata(state: SequentialPresentationRenderState) {
  const source = JSON.stringify({
    activeSlideId: state.activeSlideId,
    evidenceManifest: {
      id: state.evidence.id,
      revision: state.evidence.revision
    },
    intent: { id: state.intent.id, revision: state.intent.revision },
    spec: state.spec,
    surface: { id: state.surface.id, revision: state.surface.revision }
  })
  return {
    artifactId: state.surface.id,
    diagramType: 'sequential-presentation',
    editingModel: 'typed-navigation-events',
    kind: 'sequential-presentation-surface',
    renderFormat: 'html-css-js',
    renderer: state.surface.rendererId,
    source,
    sourceHash: stableSourceHash(source),
    title: state.spec.title
  }
}

function evidenceButtons(
  state: SequentialPresentationRenderState,
  slide: SequentialPresentationSlide
): string {
  return slide.evidenceItemIds
    .flatMap((id) => {
      const item = state.evidence.items.find((candidate) => candidate.id === id)
      return item ? [item] : []
    })
    .map(
      (
        item
      ) => `<button type="button" class="evidence-link" data-evidence-id="${escapeHtml(item.id)}">
  <span>${escapeHtml(truth(item))}</span>
  <b>${escapeHtml(item.title)}</b>
  <small>Inspect source</small>
</button>`
    )
    .join('')
}

function points(slide: SequentialPresentationSlide): string {
  if (!slide.points?.length) return ''
  if (slide.layout === 'sequence') {
    return `<ol class="sequence">${slide.points
      .map(
        (point, index) =>
          `<li><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(point)}</b></li>`
      )
      .join('')}</ol>`
  }
  return `<ul class="points">${slide.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>`
}

function slideMarkup(
  state: SequentialPresentationRenderState,
  slide: SequentialPresentationSlide,
  index: number
): string {
  const active = slide.id === state.activeSlideId
  const closing = slide.layout === 'closing'
  const decided = state.surface.status === 'decided'
  return `<section class="slide layout-${slide.layout} ${active ? 'is-active' : ''}" data-slide="${escapeHtml(slide.id)}">
  <div class="slide-index">${String(index + 1).padStart(2, '0')}</div>
  <article class="story">
    <span class="eyebrow">${escapeHtml(slide.eyebrow)}</span>
    <h1>${escapeHtml(slide.title)}</h1>
    <p>${escapeHtml(slide.body)}</p>
    ${points(slide)}
  </article>
  <aside class="evidence-pane">
    <div class="pane-heading"><span>Evidence for this step</span><b>${slide.evidenceItemIds.length}</b></div>
    <div class="evidence-list">${evidenceButtons(state, slide)}</div>
    ${
      closing
        ? `<div class="review-contract"><div><span>Approval means</span><p>${escapeHtml(state.spec.review.approvalMeaning)}</p></div><div><span>It does not mean</span><p>${escapeHtml(state.spec.review.approvalNotMeaning)}</p></div><button type="button" data-action="approve" ${decided ? 'disabled' : ''}>${decided ? 'Sequence approved' : escapeHtml(state.spec.review.approvalLabel)}</button></div>`
        : ''
    }
  </aside>
</section>`
}

function footerNavigation(state: SequentialPresentationRenderState): string {
  const currentIndex = state.spec.slides.findIndex((slide) => slide.id === state.activeSlideId)
  const previous = currentIndex > 0 ? state.spec.slides[currentIndex - 1] : undefined
  const next =
    currentIndex >= 0 && currentIndex < state.spec.slides.length - 1
      ? state.spec.slides[currentIndex + 1]
      : undefined
  return `<footer>
  <button type="button" class="direction" data-slide-id="${escapeHtml(previous?.id ?? '')}" ${previous ? '' : 'disabled'}>← Previous</button>
  <div class="steps" aria-label="Presentation progress">${state.spec.slides
    .map(
      (slide, index) =>
        `<button type="button" data-slide-id="${escapeHtml(slide.id)}" class="${slide.id === state.activeSlideId ? 'is-active' : ''}" aria-label="Open slide ${index + 1}"><span>${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(slide.eyebrow.replace(/^\d+\s*·\s*/, ''))}</b></button>`
    )
    .join('')}</div>
  <button type="button" class="direction" data-slide-id="${escapeHtml(next?.id ?? '')}" ${next ? '' : 'disabled'}>Next →</button>
</footer>`
}

export function renderSequentialPresentation(state: SequentialPresentationRenderState): {
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
        {
          source: item.sourceRef,
          summary: item.summary,
          title: item.title,
          truth: truth(item)
        }
      ])
    )
  ).replaceAll('<', '\\u003c')
  const slideIds = JSON.stringify(state.spec.slides.map((slide) => slide.id)).replaceAll(
    '<',
    '\\u003c'
  )
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; navigate-to 'none'; base-uri 'none'; object-src 'none'"><script type="application/json" data-openpencil-artifact>${safeArtifact}</script></head><body><main class="presentation" data-openpencil-width="1500" data-openpencil-height="960" data-surface-id="${escapeHtml(state.surface.id)}" data-active-slide-id="${escapeHtml(state.activeSlideId)}" data-basis="${basis}">
  <header><div class="brand"><i>OP</i><div><b>OpenPencil</b><small>Sequential answer · ${escapeHtml(state.surface.rendererId)}</small></div></div><div class="title"><span>${escapeHtml(state.spec.subject)}</span><b>${escapeHtml(state.spec.title)}</b></div><div class="truth"><span>Captured + derived</span><b>${escapeHtml(state.surface.status)}</b></div></header>
  <div class="slides">${state.spec.slides.map((slide, index) => slideMarkup(state, slide, index)).join('')}</div>
  ${footerNavigation(state)}
  <div class="source-popover" hidden><button type="button" data-close aria-label="Close source">×</button><small></small><h2></h2><p></p><code></code></div>
  <div class="toast" role="status" aria-live="polite"></div>
</main></body></html>`
  const css = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#f3f1ea;background:#111318}*{box-sizing:border-box}body{margin:0}.presentation{position:relative;width:1500px;height:960px;display:grid;grid-template-rows:72px minmax(0,1fr) 112px;overflow:hidden;background:#111318}.presentation>header{display:grid;grid-template-columns:320px 1fr 320px;align-items:center;border-bottom:1px solid rgba(255,255,255,.1);padding:0 28px;background:#15171d}.brand{display:flex;align-items:center;gap:10px}.brand i{display:grid;place-items:center;width:34px;height:34px;border:1px solid #8f7af0;border-radius:10px;color:#baa9ff;font-style:normal;font-size:10px}.brand div{display:grid;gap:2px}.brand b{font-size:12px}.brand small{color:#8d909a;font-size:9px}.title{display:grid;gap:4px;text-align:center}.title span{color:#8d909a;font-size:8px;letter-spacing:.12em;text-transform:uppercase}.title b{font-size:13px}.truth{display:flex;justify-content:flex-end;align-items:center;gap:12px;font-size:9px;text-transform:capitalize}.truth span{border:1px solid #545965;border-radius:99px;padding:5px 8px;color:#aeb2bb}.truth b{color:#bcaaff}.slides{min-height:0}.slide{display:none;grid-template-columns:72px minmax(0,1fr) 340px;gap:34px;height:100%;padding:46px 54px 38px;background:#efede6;color:#20211e}.slide.is-active{display:grid}.slide-index{color:#9b978c;font:500 18px Georgia,serif}.story{display:flex;flex-direction:column;justify-content:center;min-width:0}.eyebrow{color:#6b56ca;font-size:9px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.story h1{max-width:850px;margin:18px 0 22px;font:500 58px/1.02 Georgia,serif;letter-spacing:-.04em}.story>p{max-width:800px;margin:0;color:#5f5d55;font:18px/1.58 Georgia,serif}.sequence{display:grid;grid-auto-columns:minmax(0,1fr);grid-auto-flow:column;gap:0;margin:46px 0 0;padding:0;list-style:none}.sequence li{display:grid;gap:10px;border-top:2px solid #2f302c;padding:14px 14px 0 0}.sequence li+li{margin-left:10px}.sequence span{color:#918d82;font-size:8px}.sequence b{font-size:10px}.points{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:38px 0 0;padding:0;list-style:none}.points li{border-top:1px solid #bdb8ac;padding:13px 0;color:#44443f;font-size:11px}.evidence-pane{display:flex;flex-direction:column;justify-content:center;border-left:1px solid #c6c1b6;padding-left:26px}.pane-heading{display:flex;justify-content:space-between;color:#77736b;font-size:8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.evidence-list{display:grid;gap:9px;margin-top:18px}.evidence-link{display:grid;gap:7px;width:100%;border:1px solid #c7c1b5;background:#f7f5ef;padding:14px;text-align:left;color:#272824;cursor:pointer}.evidence-link:hover{border-color:#7d6ad4}.evidence-link span{color:#6b56ca;font-size:7px;font-weight:800;text-transform:uppercase}.evidence-link b{font:500 14px/1.25 Georgia,serif}.evidence-link small{color:#777269;font-size:8px}.review-contract{display:grid;gap:14px;margin-top:22px;border-top:1px solid #c4beb2;padding-top:18px}.review-contract>div{display:grid;gap:5px}.review-contract span{color:#6b56ca;font-size:8px;font-weight:800;text-transform:uppercase}.review-contract p{margin:0;color:#656159;font-size:9px;line-height:1.5}.review-contract button{border:0;border-radius:7px;background:#6b56ca;padding:12px;color:white;font:inherit;font-size:10px;font-weight:700;cursor:pointer}.review-contract button:disabled{background:#aaa59b;cursor:default}.layout-statement .story h1{max-width:920px;font-size:72px}.layout-evidence .story h1,.layout-closing .story h1{font-size:62px}footer{display:grid;grid-template-columns:120px minmax(0,1fr) 120px;align-items:center;gap:20px;border-top:1px solid rgba(255,255,255,.1);padding:14px 24px;background:#15171d}.direction{border:0;background:none;color:#b5b8c0;font:inherit;font-size:10px;cursor:pointer}.direction:disabled{opacity:.22;cursor:default}.steps{display:grid;grid-auto-columns:minmax(0,1fr);grid-auto-flow:column;gap:6px}.steps button{display:grid;grid-template-columns:24px 1fr;align-items:center;gap:6px;border:1px solid transparent;border-radius:7px;background:transparent;padding:9px 8px;text-align:left;color:#777b85;cursor:pointer}.steps button:hover{background:rgba(255,255,255,.05)}.steps button.is-active{border-color:rgba(155,130,243,.45);background:rgba(155,130,243,.12);color:#f1eff8}.steps span{font-size:8px}.steps b{font-size:8px;font-weight:600}.source-popover{position:absolute;right:34px;bottom:132px;width:370px;border:1px solid #555965;background:#1d2027;padding:22px;color:#f1f1f3;box-shadow:0 20px 60px rgba(0,0,0,.45)}.source-popover button{float:right;border:0;background:none;color:#b9bdc6;font-size:18px;cursor:pointer}.source-popover small{color:#bcaaff;font-size:8px;text-transform:uppercase}.source-popover h2{margin:14px 0 10px;font:500 22px Georgia,serif}.source-popover p{color:#a7aab2;font-size:10px;line-height:1.6}.source-popover code{display:block;color:#858994;font-size:8px;overflow-wrap:anywhere}.toast{position:absolute;right:28px;bottom:126px;border-radius:6px;background:#272a31;padding:10px 13px;color:white;font-size:9px;opacity:0;transform:translateY(6px);transition:.18s}.toast.is-visible{opacity:1;transform:none}@media(max-width:1050px){.presentation{width:100vw;height:auto;min-height:100vh;grid-template-rows:auto minmax(680px,1fr) auto}.presentation>header{grid-template-columns:1fr auto;min-height:72px}.title{display:none}.slide{grid-template-columns:42px minmax(0,1fr);height:auto;min-height:680px;padding:34px 28px}.evidence-pane{grid-column:2;border-top:1px solid #c6c1b6;border-left:0;padding:22px 0 0}.story h1,.layout-statement .story h1,.layout-evidence .story h1,.layout-closing .story h1{font-size:46px}.sequence{grid-auto-columns:auto;grid-auto-flow:row}.steps b{display:none}footer{grid-template-columns:80px minmax(0,1fr) 80px}.source-popover{right:20px;bottom:118px;left:20px;width:auto}}`
  const js = `(() => {
  const root = document.querySelector('[data-surface-id]')
  if (!root) return
  const basis = JSON.parse(root.dataset.basis || '{}')
  const evidence = ${evidence}
  const slideIds = ${slideIds}
  let pending = null
  const toast = document.querySelector('.toast')
  const announce = (message) => {
    if (!toast) return
    toast.textContent = message
    toast.classList.add('is-visible')
    setTimeout(() => toast.classList.remove('is-visible'), 1800)
  }
  const dispatch = (action, targetSlideId) => {
    if (pending) return
    if (action === 'navigate' && targetSlideId === root.dataset.activeSlideId) return
    pending = {
      action,
      eventId: 'presentation-' + action + '-' + Date.now(),
      expected: basis,
      surfaceRunId: root.dataset.surfaceId,
      targetSlideId
    }
    document.dispatchEvent(new CustomEvent('openpencil:surface-event', { detail: pending }))
    announce(action === 'approve' ? 'Recording approval…' : 'Saving position…')
  }
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!button) return
    if (button.dataset.slideId) return dispatch('navigate', button.dataset.slideId)
    if (button.dataset.action === 'approve') return dispatch('approve')
    if (button.dataset.evidenceId) {
      const detail = evidence[button.dataset.evidenceId]
      const popover = document.querySelector('.source-popover')
      if (!detail || !popover) return
      popover.hidden = false
      popover.querySelector('small').textContent = detail.truth
      popover.querySelector('h2').textContent = detail.title
      popover.querySelector('p').textContent = detail.summary
      popover.querySelector('code').textContent = detail.source
      return
    }
    if (button.dataset.close !== undefined) {
      const popover = document.querySelector('.source-popover')
      if (popover) popover.hidden = true
    }
  })
  document.addEventListener('keydown', (event) => {
    if (pending || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    const index = slideIds.indexOf(root.dataset.activeSlideId)
    const target = slideIds[index + (event.key === 'ArrowRight' ? 1 : -1)]
    if (target) dispatch('navigate', target)
  })
  document.addEventListener('openpencil:surface-event-result', (event) => {
    const result = event.detail
    if (!pending || !result || result.eventId !== pending.eventId) return
    pending = null
    announce(result.status === 'rejected' ? (result.error || 'Change rejected') : 'Saved')
  })
})()`
  return { css, html, js, sourceHash: artifact.sourceHash }
}
