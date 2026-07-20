import type {
  CollectionProperty,
  CollectionRecord,
  EvidenceManifestItem,
  WorkspacePropertyValue
} from '@/app/workspace'

import { recordExplorerRecordId, recordExplorerSavedViewId } from './model'
import type { RecordExplorerRenderState } from './types'

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

function artifactMetadata(state: RecordExplorerRenderState) {
  const source = JSON.stringify({
    activeViewId: state.activeView.id,
    collectionId: state.collectionId,
    evidenceManifest: { id: state.evidence.id, revision: state.evidence.revision },
    focusedRecordId: state.focusedRecordId,
    intent: { id: state.intent.id, revision: state.intent.revision },
    spec: state.spec,
    surface: { id: state.surface.id, revision: state.surface.revision }
  })
  return {
    artifactId: state.surface.id,
    diagramType: 'record-explorer',
    editingModel: 'typed-saved-view-events',
    kind: 'record-explorer-surface',
    renderFormat: 'html-css-js',
    renderer: state.surface.rendererId,
    source,
    sourceHash: stableSourceHash(source),
    title: state.spec.title
  }
}

function fieldFor(state: RecordExplorerRenderState, id: string): CollectionProperty | undefined {
  return state.spec.fields.find((field) => field.id === id)
}

function displayValue(
  field: CollectionProperty | undefined,
  value: WorkspacePropertyValue
): string {
  if (value === null) return '—'
  if (Array.isArray(value)) return value.map((item) => displayValue(field, item)).join(', ')
  if ((field?.type === 'select' || field?.type === 'status') && typeof value === 'string') {
    return field.options?.find((option) => option.id === value)?.label ?? value
  }
  if (field?.type === 'checkbox') return value ? 'Yes' : 'No'
  return String(value)
}

function fieldValue(
  state: RecordExplorerRenderState,
  record: CollectionRecord,
  propertyId: string
): string {
  return displayValue(fieldFor(state, propertyId), record.properties[propertyId] ?? null)
}

function statusClass(field: CollectionProperty | undefined): string {
  return field?.type === 'status' || field?.type === 'select' ? 'is-status' : ''
}

function viewButtons(state: RecordExplorerRenderState): string {
  return state.spec.views
    .map((view) => {
      const savedViewId = recordExplorerSavedViewId(state.spec.id, view.id)
      return `<button type="button" data-saved-view-id="${escapeHtml(savedViewId)}" class="${savedViewId === state.activeView.id ? 'is-active' : ''}">
  <span>${escapeHtml(view.kind)}</span><b>${escapeHtml(view.label)}</b>
</button>`
    })
    .join('')
}

function recordButton(
  state: RecordExplorerRenderState,
  record: CollectionRecord,
  content: string
): string {
  return `<button type="button" class="record ${record.id === state.focusedRecordId ? 'is-focused' : ''}" data-record-id="${escapeHtml(record.id)}">${content}</button>`
}

function tableView(state: RecordExplorerRenderState): string {
  const properties = state.activeView.visiblePropertyIds
  return `<div class="table-view" style="--columns:${properties.length}"><div class="table-head"><span>Record</span>${properties
    .map(
      (propertyId) => `<span>${escapeHtml(fieldFor(state, propertyId)?.label ?? propertyId)}</span>`
    )
    .join('')}</div><div class="table-body">${state.records
    .map((record) =>
      recordButton(
        state,
        record,
        `<b>${escapeHtml(record.title)}</b>${properties
          .map((propertyId) => {
            const field = fieldFor(state, propertyId)
            return `<span class="${statusClass(field)}">${escapeHtml(fieldValue(state, record, propertyId))}</span>`
          })
          .join('')}`
      )
    )
    .join('')}</div></div>`
}

function listView(state: RecordExplorerRenderState): string {
  const properties = state.activeView.visiblePropertyIds.slice(0, 3)
  return `<div class="list-view">${state.records
    .map((record) =>
      recordButton(
        state,
        record,
        `<div><b>${escapeHtml(record.title)}</b><small>${properties
          .map(
            (propertyId) =>
              `${escapeHtml(fieldFor(state, propertyId)?.label ?? propertyId)} · ${escapeHtml(fieldValue(state, record, propertyId))}`
          )
          .join(' &nbsp; ')}</small></div><span>Inspect →</span>`
      )
    )
    .join('')}</div>`
}

function boardView(state: RecordExplorerRenderState): string {
  const groupId = state.activeView.groupByPropertyId
  if (!groupId) return listView(state)
  const groups = new Map<string, CollectionRecord[]>()
  for (const record of state.records) {
    const key = fieldValue(state, record, groupId)
    groups.set(key, [...(groups.get(key) ?? []), record])
  }
  return `<div class="board-view">${[...groups.entries()]
    .map(
      ([label, records]) =>
        `<section><header><b>${escapeHtml(label)}</b><span>${records.length}</span></header><div>${records
          .map((record) =>
            recordButton(
              state,
              record,
              `<b>${escapeHtml(record.title)}</b><small>${state.activeView.visiblePropertyIds
                .filter((id) => id !== groupId)
                .slice(0, 2)
                .map(
                  (id) =>
                    `${escapeHtml(fieldFor(state, id)?.label ?? id)} · ${escapeHtml(fieldValue(state, record, id))}`
                )
                .join('<br>')}</small>`
            )
          )
          .join('')}</div></section>`
    )
    .join('')}</div>`
}

function ledger(state: RecordExplorerRenderState): string {
  if (state.activeView.viewKind === 'board') return boardView(state)
  if (state.activeView.viewKind === 'list') return listView(state)
  return tableView(state)
}

function focusedRecord(state: RecordExplorerRenderState): CollectionRecord | undefined {
  return state.records.find((record) => record.id === state.focusedRecordId)
}

function detailRail(state: RecordExplorerRenderState): string {
  const record = focusedRecord(state)
  if (!record) {
    return `<aside class="detail empty"><span>Record detail</span><h2>Select one signal</h2><p>Open one record without losing the surrounding triage view.</p></aside>`
  }
  const definition = state.spec.records.find(
    (item) => recordExplorerRecordId(state.spec.id, item.id) === record.id
  )
  return `<aside class="detail"><span>Focused record</span><h2>${escapeHtml(record.title)}</h2><dl>${state.spec.fields
    .filter((field) => Object.hasOwn(record.properties, field.id))
    .map(
      (field) =>
        `<div><dt>${escapeHtml(field.label)}</dt><dd class="${statusClass(field)}">${escapeHtml(fieldValue(state, record, field.id))}</dd></div>`
    )
    .join(
      ''
    )}</dl><div class="evidence-stamp"><small>Evidence binding</small><b>${definition?.evidenceItemIds?.length ?? 0} source${(definition?.evidenceItemIds?.length ?? 0) === 1 ? '' : 's'}</b></div></aside>`
}

function overview(state: RecordExplorerRenderState): string {
  const grouped = state.spec.fields.find((field) => field.id === state.activeView.groupByPropertyId)
  return `<section class="view overview" data-view="overview"><div class="overview-copy"><span class="eyebrow">Bounded record model</span><h1>${escapeHtml(state.spec.title)}</h1><p>${escapeHtml(state.spec.subtitle)}</p><blockquote>${escapeHtml(state.intent.statement)}</blockquote></div><div class="metrics"><article><span>Records in view</span><b>${state.records.length}</b><small>${escapeHtml(state.activeView.name)}</small></article><article><span>Saved views</span><b>${state.spec.views.length}</b><small>Same record identity</small></article><article><span>Evidence items</span><b>${state.evidence.items.length}</b><small>Captured and scoped</small></article><article><span>Grouping</span><b>${escapeHtml(grouped?.label ?? 'None')}</b><small>No hidden lifecycle change</small></article></div></section>`
}

function focus(state: RecordExplorerRenderState): string {
  return `<section class="view focus is-active" data-view="focus"><div class="focus-head"><div><span class="eyebrow">${escapeHtml(state.activeView.viewKind)} saved view</span><h1>${escapeHtml(state.activeView.name)}</h1><p>${escapeHtml(state.intent.desiredOutcome)}</p></div><div class="view-switch">${viewButtons(state)}</div></div><div class="focus-body"><div class="ledger"><div class="ledger-meta"><span>${state.records.length} matching records</span><b>Shared Collection identity · read-only surface</b></div>${ledger(state)}</div>${detailRail(state)}</div></section>`
}

function evidenceCard(item: EvidenceManifestItem): string {
  return `<article><span>${escapeHtml(item.truthScope)} · ${escapeHtml(item.freshness)}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.summary)}</p><code>${escapeHtml(item.sourceRef)}</code></article>`
}

function evidence(state: RecordExplorerRenderState): string {
  return `<section class="view evidence" data-view="evidence"><header><span class="eyebrow">Evidence</span><h1>What these records are allowed to claim</h1><p>Every row remains attached to captured or scoped evidence. This explorer does not fetch, infer, or write external data.</p></header><div>${state.evidence.items.map(evidenceCard).join('')}</div></section>`
}

function review(state: RecordExplorerRenderState): string {
  const record = focusedRecord(state)
  const decided = state.surface.status === 'decided'
  return `<section class="view review" data-view="review"><article><span class="eyebrow">Knowledge checkpoint</span><h1>${decided ? 'This triage focus is recorded.' : 'Record this triage focus?'}</h1><p>${record ? `Selected record: ${escapeHtml(record.title)}` : 'Select one record in Focus before recording a triage decision.'}</p><div class="review-result"><span>Active saved view</span><b>${escapeHtml(state.activeView.name)}</b><small>${state.records.length} matching records · ${state.activeView.sorts.length} declared sort${state.activeView.sorts.length === 1 ? '' : 's'}</small></div></article><aside><span>Exact basis</span><dl><div><dt>Collection</dt><dd>${escapeHtml(state.collectionId)}</dd></div><div><dt>View</dt><dd>${escapeHtml(state.activeView.id)}</dd></div><div><dt>Surface</dt><dd>${escapeHtml(state.surface.id)}@${state.surface.revision}</dd></div><div><dt>Capabilities</dt><dd>No writes</dd></div></dl><button type="button" data-action="approve" ${!record || decided ? 'disabled' : ''}>${decided ? 'Triage focus recorded' : 'Record triage knowledge'}</button><small>This creates a DecisionReceipt. It does not change a source record, status, or external system.</small></aside></section>`
}

export function renderRecordExplorer(state: RecordExplorerRenderState): {
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
  const commitEventId = state.surface.interactions.at(-1)?.id ?? ''
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; navigate-to 'none'; base-uri 'none'; object-src 'none'"><script type="application/json" data-openpencil-artifact>${safeArtifact}</script></head><body><main class="explorer" data-openpencil-width="1500" data-openpencil-height="940" data-surface-id="${escapeHtml(state.surface.id)}" data-basis="${basis}" data-commit-event-id="${escapeHtml(commitEventId)}"><header class="top"><div class="brand"><i>OP</i><div><b>OpenPencil</b><small>Executable record knowledge</small></div></div><nav><button data-view-target="overview">Overview</button><button class="is-active" data-view-target="focus">Focus</button><button data-view-target="evidence">Evidence</button><button data-view-target="review">Review</button></nav><div class="truth"><span>${escapeHtml(state.activeView.viewKind)}</span><b>${escapeHtml(state.surface.status)}</b></div></header><div class="views">${overview(state)}${focus(state)}${evidence(state)}${review(state)}</div><div class="toast" role="status" aria-live="polite"></div></main></body></html>`
  const css = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#f4f2ed;background:#101217}*{box-sizing:border-box}button{font:inherit}.explorer{position:relative;width:1500px;height:940px;overflow:hidden;background:#101217}.top{display:grid;grid-template-columns:340px 1fr 340px;align-items:center;height:72px;border-bottom:1px solid #2a2d34;padding:0 28px;background:#15171c}.brand{display:flex;align-items:center;gap:10px}.brand i{display:grid;place-items:center;width:34px;height:34px;border:1px solid #8f7af0;border-radius:9px;color:#baa9ff;font-style:normal;font-size:9px}.brand div{display:grid;gap:2px}.brand b{font-size:12px}.brand small{color:#858995;font-size:9px}.top nav{display:flex;justify-content:center;gap:6px}.top nav button{border:0;border-radius:6px;background:transparent;padding:8px 14px;color:#8d919c;font-size:10px;cursor:pointer}.top nav button.is-active{background:#292438;color:#c7b8ff}.truth{display:flex;justify-content:flex-end;align-items:center;gap:10px;text-transform:capitalize}.truth span{border:1px solid #3c4049;border-radius:99px;padding:5px 8px;color:#a7aab2;font-size:8px}.truth b{color:#bcaaff;font-size:9px}.views{height:868px}.view{display:none;height:100%}.view.is-active{display:block}.eyebrow{color:#9f8aff;font-size:8px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.overview{grid-template-columns:minmax(0,1fr) 560px;gap:64px;align-items:center;padding:76px 84px;background:#efede7;color:#20211e}.overview.is-active{display:grid}.overview-copy h1{max-width:720px;margin:18px 0 20px;font:500 64px/.98 Georgia,serif;letter-spacing:-.04em}.overview-copy>p{max-width:700px;color:#66635b;font:17px/1.55 Georgia,serif}.overview blockquote{margin:40px 0 0;border-left:2px solid #725ad7;padding:5px 0 5px 20px;color:#44433d;font:500 16px/1.5 Georgia,serif}.metrics{display:grid;grid-template-columns:repeat(2,1fr);border-top:1px solid #bbb7ae;border-left:1px solid #bbb7ae}.metrics article{display:grid;min-height:170px;border-right:1px solid #bbb7ae;border-bottom:1px solid #bbb7ae;padding:22px}.metrics span{color:#77736a;font-size:8px;text-transform:uppercase}.metrics b{align-self:end;font:500 38px/1 Georgia,serif}.metrics small{color:#77736a;font-size:9px}.focus.is-active{display:grid;grid-template-rows:128px minmax(0,1fr);background:#111318}.focus-head{display:flex;align-items:center;justify-content:space-between;gap:28px;border-bottom:1px solid #292d35;padding:22px 30px}.focus-head h1{margin:6px 0 4px;font-size:24px}.focus-head p{margin:0;color:#8e929d;font-size:10px}.view-switch{display:flex;gap:7px}.view-switch button{display:grid;gap:3px;min-width:104px;border:1px solid #343842;border-radius:7px;background:#191c22;padding:10px 12px;text-align:left;color:#8d919a;cursor:pointer}.view-switch button.is-active{border-color:#7966d2;background:#252132;color:#f1eff8}.view-switch span{font-size:7px;text-transform:uppercase}.view-switch b{font-size:9px}.focus-body{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:16px;min-height:0;padding:16px}.ledger{min-width:0;overflow:hidden;border:1px solid #2d3038;border-radius:9px;background:#16181e}.ledger-meta{display:flex;justify-content:space-between;border-bottom:1px solid #2d3038;padding:13px 16px;color:#888c96;font-size:8px}.ledger-meta b{color:#777b85;font-weight:500}.table-view{height:100%;overflow:auto}.table-head,.table-body .record{display:grid;grid-template-columns:minmax(220px,1.5fr) repeat(var(--columns),minmax(110px,1fr));align-items:center}.table-head{min-height:42px;border-bottom:1px solid #30333b;padding:0 14px;color:#747884;font-size:8px;text-transform:uppercase}.table-body .record{width:100%;min-height:56px;border:0;border-bottom:1px solid #292c33;background:transparent;padding:0 14px;text-align:left;color:#b7bac2;cursor:pointer}.table-body .record:hover,.table-body .record.is-focused{background:#211e2c}.table-body .record.is-focused{box-shadow:inset 2px 0 #9e86ff}.record b{overflow:hidden;color:#f0eef2;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.record span{font-size:9px}.record .is-status,.detail .is-status{color:#d1c3ff}.list-view{display:grid}.list-view .record{display:flex;align-items:center;justify-content:space-between;min-height:66px;border:0;border-bottom:1px solid #292c33;background:transparent;padding:12px 16px;text-align:left;color:#9296a0;cursor:pointer}.list-view .record:hover,.list-view .record.is-focused{background:#211e2c}.list-view .record div{display:grid;gap:6px}.list-view .record small{color:#7e828c;font-size:8px}.board-view{display:grid;grid-auto-columns:minmax(220px,1fr);grid-auto-flow:column;gap:10px;height:100%;overflow:auto;padding:12px}.board-view section{border-right:1px solid #2d3038}.board-view section>header{display:flex;justify-content:space-between;padding:4px 10px 12px;color:#c6c8ce;font-size:9px}.board-view section>header span{color:#7d818b}.board-view section>div{display:grid;gap:8px;padding-right:10px}.board-view .record{display:grid;gap:9px;border:1px solid #30333b;border-radius:7px;background:#1a1d23;padding:13px;text-align:left;color:#8c9099;cursor:pointer}.board-view .record:hover,.board-view .record.is-focused{border-color:#7966d2;background:#221f2c}.board-view .record small{font-size:8px;line-height:1.6}.detail{overflow:auto;border:1px solid #2d3038;border-radius:9px;background:#16181e;padding:22px}.detail>span{color:#9c87f3;font-size:8px;font-weight:800;text-transform:uppercase}.detail h2{margin:12px 0 22px;font:500 29px/1.05 Georgia,serif}.detail>p{color:#8a8e98;font-size:10px;line-height:1.6}.detail dl{margin:0}.detail dl div{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #2b2e35;padding:12px 0;font-size:9px}.detail dt{color:#777b85}.detail dd{margin:0;text-align:right}.evidence-stamp{display:flex;justify-content:space-between;margin-top:24px;border-top:1px solid #2b2e35;padding-top:15px}.evidence-stamp small{color:#777b85;font-size:8px}.evidence-stamp b{font-size:9px}.evidence.is-active{display:grid;grid-template-columns:460px minmax(0,1fr);gap:56px;overflow:auto;padding:64px 74px;background:#efede7;color:#20211e}.evidence header h1{margin:15px 0 20px;font:500 46px/1 Georgia,serif}.evidence header p{color:#6b685f;font:15px/1.55 Georgia,serif}.evidence>div{display:grid;align-content:start;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid #bbb7ae;border-left:1px solid #bbb7ae}.evidence article{min-height:180px;border-right:1px solid #bbb7ae;border-bottom:1px solid #bbb7ae;padding:20px}.evidence article span{color:#6e58cb;font-size:8px;text-transform:uppercase}.evidence article h2{margin:12px 0 10px;font:500 20px Georgia,serif}.evidence article p{color:#66635b;font-size:10px;line-height:1.55}.evidence article code{color:#7b776e;font-size:8px;overflow-wrap:anywhere}.review.is-active{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:56px;align-items:center;padding:70px 88px;background:#efede7;color:#20211e}.review article h1{max-width:780px;margin:18px 0 20px;font:500 58px/1 Georgia,serif}.review article>p{color:#66635b;font:17px/1.5 Georgia,serif}.review-result{display:grid;gap:9px;margin-top:42px;border-top:1px solid #aaa69c;border-bottom:1px solid #aaa69c;padding:18px 0}.review-result span,.review aside>span{color:#6e58cb;font-size:8px;font-weight:800;text-transform:uppercase}.review-result b{font:500 23px Georgia,serif}.review-result small{color:#77736b;font-size:9px}.review aside{border-left:1px solid #bdb9ae;padding-left:28px}.review aside dl div{display:flex;justify-content:space-between;border-top:1px solid #c7c2b8;padding:12px 0;font-size:9px}.review aside dt{color:#77736b}.review aside dd{margin:0}.review aside button{width:100%;border:0;border-radius:7px;background:#6f58cf;padding:13px;color:white;font-size:10px;font-weight:700;cursor:pointer}.review aside button:disabled{background:#aaa69c;cursor:default}.review aside>small{display:block;margin-top:12px;color:#77736b;font-size:8px;line-height:1.5}.toast{position:absolute;right:28px;bottom:24px;border-radius:6px;background:#292c34;padding:10px 13px;color:white;font-size:9px;opacity:0;transform:translateY(6px);transition:.18s}.toast.is-visible{opacity:1;transform:none}@media(max-width:1050px){.explorer{width:100vw;height:auto;min-height:100vh}.top{grid-template-columns:1fr auto}.top nav{display:none}.views{height:auto;min-height:calc(100vh - 72px)}.focus.is-active{grid-template-rows:auto minmax(700px,1fr)}.focus-head{align-items:flex-start;flex-direction:column}.focus-body{grid-template-columns:1fr}.detail{min-height:240px}.overview.is-active,.evidence.is-active,.review.is-active{grid-template-columns:1fr;padding:38px 28px}.table-view{overflow-x:auto}}`
  const js = `(() => {
  const root = document.querySelector('[data-surface-id]')
  if (!root) return
  const basis = JSON.parse(root.dataset.basis || '{}')
  const commitEventId = root.dataset.commitEventId || ''
  let pending = commitEventId ? { eventId: commitEventId } : null
  let reloadGuard = commitEventId ? setTimeout(() => releasePending('Saved'), 2500) : null
  const toast = document.querySelector('.toast')
  const announce = (message) => {
    if (!toast) return
    toast.textContent = message
    toast.classList.add('is-visible')
    setTimeout(() => toast.classList.remove('is-visible'), 1800)
  }
  const releasePending = (message) => {
    if (reloadGuard) clearTimeout(reloadGuard)
    reloadGuard = null
    pending = null
    announce(message)
  }
  const dispatch = (action, targetId) => {
    if (pending) return
    pending = { action, eventId: 'record-explorer-' + action + '-' + Date.now(), expected: basis, surfaceRunId: root.dataset.surfaceId, targetId }
    document.dispatchEvent(new CustomEvent('openpencil:surface-event', { detail: pending }))
    announce(action === 'approve' ? 'Recording triage knowledge…' : 'Saving focus…')
  }
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (!button) return
    if (button.dataset.viewTarget) {
      document.querySelectorAll('[data-view]').forEach((view) => view.classList.toggle('is-active', view.dataset.view === button.dataset.viewTarget))
      document.querySelectorAll('[data-view-target]').forEach((item) => item.classList.toggle('is-active', item === button))
      return
    }
    if (button.dataset.savedViewId) return dispatch('activate-view', button.dataset.savedViewId)
    if (button.dataset.recordId) return dispatch('focus-record', button.dataset.recordId)
    if (button.dataset.action === 'approve') return dispatch('approve')
  })
  document.addEventListener('openpencil:surface-event-result', (event) => {
    const result = event.detail
    if (!pending || !result || result.eventId !== pending.eventId) return
    releasePending(result.status === 'rejected' ? (result.error || 'Change rejected') : 'Saved')
  })
  document.addEventListener('openpencil:surface-state', (event) => {
    const state = event.detail
    if (!pending || !state || !state.surface) return
    if (state.artifactRevision !== basis.artifactRevision || state.surface.revision !== basis.surfaceRevision || state.workspaceRevision !== basis.workspaceRevision) return
    releasePending('Saved')
  })
})()`
  return { css, html, js, sourceHash: artifact.sourceHash }
}
