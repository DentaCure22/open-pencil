const STORAGE_KEY = "open-pencil-live-workspace-v1";

const seedState = {
  selectedId: "production-header",
  objects: [
    { id: "production-header", type: "production", zone: "production", title: "Patient Header", subtitle: "Dental Chart · Production", status: "Production", sourceId: null, modified: false, note: "Canonical live application container", updated: "Source v42" },
    { id: "draft-compact", type: "draft", zone: "exploring", title: "Compact Patient Header", subtitle: "Draft · Branched from production", status: "Draft", sourceId: "production-header", modified: true, note: "Reduce visual weight and keep identity scannable.", updated: "Unsaved changes" },
    { id: "variant-calm", type: "variant", zone: "exploring", title: "Calm Header", subtitle: "Variant A", status: "Variant", sourceId: "production-header", modified: false, note: "More space around clinical alerts.", updated: "Saved" },
    { id: "variant-dense", type: "variant", zone: "exploring", title: "Dense Header", subtitle: "Variant B · Preferred", status: "Preferred", sourceId: "production-header", modified: false, note: "Information-forward layout for desktop workflows.", updated: "Saved" },
    { id: "flow-search", type: "flow", zone: "flows", title: "Patient Search", subtitle: "New Patient Exam · Step 1", status: "Flow", sourceId: null, modified: false, note: "Entry into the exam workflow.", updated: "Connected" },
    { id: "flow-history", type: "flow", zone: "flows", title: "Medical History", subtitle: "New Patient Exam · Step 2", status: "Flow", sourceId: "flow-search", modified: false, note: "Review conditions and allergies.", updated: "Connected" },
    { id: "review-header", type: "review", zone: "review", title: "Mobile Header Review", subtitle: "2 open comments", status: "In Review", sourceId: "variant-dense", modified: false, note: "Confirm 320px behavior and allergy visibility.", updated: "Waiting on review" },
    { id: "change-set-42", type: "change-set", zone: "approved", title: "Compact Header", subtitle: "Change Set CS-42", status: "Approved", sourceId: "variant-dense", modified: false, note: "4 component changes · 3 token updates", updated: "Ready to implement" },
    { id: "archive-old", type: "archived", zone: "archived", title: "Floating Identity Card", subtitle: "Archived direction", status: "Archived", sourceId: "production-header", modified: false, note: "Rejected because it separated clinical alerts from identity.", updated: "Archived" },
  ],
  events: [
    { text: "Workspace created from Dental Chart production page", time: "Today" },
    { text: "Dense Header marked as preferred", time: "Today" },
  ],
};

const treeModel = [
  { label: "Pages", tone: "green", children: ["Dental Chart", "Patient Profile", "Scheduling"] },
  { label: "Assets", tone: "blue", children: ["Components", "Patterns", "Icons", "Tokens"] },
  { label: "Workspaces", tone: "purple", open: true, children: ["Dental Chart Improvements", "New Patient Experience"] },
  { label: "Change Sets", tone: "orange", open: true, children: ["Proposed", "Approved", "Implementing", "Applied"] },
];

const componentAssets = [
  { id: "patient-header", name: "Patient Header", category: "Clinical", family: "Composite", source: "features/dental-chart/patient-header", description: "Identity, coverage, and clinical context rendered as one production container.", tokens: ["surface-panel", "space-4", "radius-lg"], specimen: "patient-header" },
  { id: "clinical-alert", name: "Clinical Alert", category: "Clinical", family: "Feedback", source: "components/clinical/clinical-alert", description: "Persistent high-signal warning with an inline action.", tokens: ["status-danger", "space-3", "radius-md"], specimen: "clinical-alert" },
  { id: "patient-avatar", name: "Patient Avatar", category: "Clinical", family: "Identity", source: "components/patient/patient-avatar", description: "Patient identity avatar with presence state and initials fallback.", tokens: ["avatar-md", "surface-raised"], specimen: "patient-avatar" },
  { id: "primary-button", name: "Primary Button", category: "Actions", family: "Button", source: "components/ui/button", description: "Primary action with native hover, focus, and disabled states.", tokens: ["action-primary", "radius-md", "space-3"], specimen: "primary-button" },
  { id: "button-group", name: "Button Group", category: "Actions", family: "Button", source: "components/ui/button-group", description: "Related actions grouped into one native control surface.", tokens: ["surface-raised", "border-subtle"], specimen: "button-group" },
  { id: "search-field", name: "Search Field", category: "Inputs", family: "Field", source: "components/ui/search-field", description: "Search input with label, shortcut hint, and clear affordance.", tokens: ["field-default", "focus-ring"], specimen: "search-field" },
  { id: "segmented-control", name: "Segmented Control", category: "Inputs", family: "Selection", source: "components/ui/segmented-control", description: "Single-choice view switcher with a persistent selected state.", tokens: ["surface-sunken", "action-selected"], specimen: "segmented-control" },
  { id: "status-badge", name: "Status Badge", category: "Feedback", family: "Badge", source: "components/ui/status-badge", description: "Compact semantic status indicator with token-driven tones.", tokens: ["status-success", "status-warning"], specimen: "status-badge" },
  { id: "card-surface", name: "Card Surface", category: "Surfaces", family: "Container", source: "components/ui/card", description: "Native content container with header, body, and action regions.", tokens: ["surface-card", "border-subtle", "radius-lg"], specimen: "card-surface" },
  { id: "empty-state", name: "Empty State", category: "Surfaces", family: "Message", source: "components/ui/empty-state", description: "Guided empty state with a clear next action.", tokens: ["text-muted", "space-6"], specimen: "empty-state" },
];

let state = loadState();
let dialogAction = null;
let activeSurface = "workspace";
let selectedAssetId = componentAssets[0].id;
let assetQuery = "";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : structuredClone(seedState);
  } catch {
    return structuredClone(seedState);
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  $("#saveState").textContent = "Saved locally";
}

function render() {
  renderTree();
  renderStage();
  renderInspector();
  renderWorkspaceTitle();
  persist();
}

function renderTree(query = $("#treeSearch").value.toLowerCase()) {
  const tree = $("#projectTree");
  tree.replaceChildren();
  treeModel.forEach((group) => {
    const matches = group.children.filter((child) => !query || child.toLowerCase().includes(query) || group.label.toLowerCase().includes(query));
    if (query && !matches.length) return;
    const section = document.createElement("section");
    section.className = "tree-group";
    section.innerHTML = `<button class="tree-heading"><span class="chevron">⌄</span><span class="folder-dot ${group.tone}"></span><strong>${group.label}</strong><small>${group.children.length}</small></button>`;
    const children = document.createElement("div");
    children.className = "tree-children";
    matches.forEach((label) => {
      const button = document.createElement("button");
      const isActive = activeSurface === "components" ? label === "Components" : label === "Dental Chart Improvements";
      button.className = `tree-item${isActive ? " active" : ""}`;
      button.innerHTML = `<span>⌗</span><span>${label}</span>`;
      button.addEventListener("click", () => {
        if (group.label === "Assets" && label === "Components") activeSurface = "components";
        else if (group.label === "Workspaces" || group.label === "Pages") activeSurface = "workspace";
        else return showToast(`${label} registry is next`);
        render();
      });
      children.append(button);
    });
    section.append(children);
    tree.append(section);
  });
}

function renderStage() {
  const stage = $("#stage");
  if (activeSurface === "components") return renderComponentAssets();
  stage.innerHTML = `<div class="canvas-toolbar">
      <div class="tool-group"><button class="tool active" aria-label="Select">↖</button><button class="tool" aria-label="Pan">✋</button><button class="tool" aria-label="Connect">⌁</button><button class="tool" aria-label="Add note">T</button></div>
      <div class="canvas-summary"><span id="objectCount">0 objects</span><span>·</span><span>All workspace objects</span></div>
      <div class="tool-group"><button class="tool">−</button><span class="zoom">24%</span><button class="tool">+</button></div>
    </div>
    <div class="canvas-scroll"><div id="canvas" class="canvas" aria-label="Spatial live app workspace">
      <section class="zone production-zone"><header><div><span>01</span><strong>Production</strong><small>Source of truth</small></div></header><div class="zone-body" data-drop-zone="production"></div></section>
      <section class="zone exploring-zone"><header><div><span>02</span><strong>Exploring</strong><small>Drafts and variants</small></div></header><div class="zone-body" data-drop-zone="exploring"></div></section>
      <section class="zone flow-zone"><header><div><span>03</span><strong>Flows</strong><small>Connected experience states</small></div></header><div class="zone-body" data-drop-zone="flows"></div></section>
      <section class="zone review-zone"><header><div><span>04</span><strong>Review</strong><small>Feedback and decisions</small></div></header><div class="zone-body" data-drop-zone="review"></div></section>
      <section class="zone approved-zone"><header><div><span>05</span><strong>Approved</strong><small>Ready for implementation</small></div></header><div class="zone-body" data-drop-zone="approved"></div></section>
      <section class="zone archived-zone"><header><div><span>06</span><strong>Archived</strong><small>Preserved history</small></div></header><div class="zone-body" data-drop-zone="archived"></div></section>
    </div></div>`;
  renderCanvas();
}

function renderCanvas() {
  $$('[data-drop-zone]').forEach((zone) => zone.replaceChildren());
  const visible = state.objects;
  visible.forEach((object) => {
    const host = $(`[data-drop-zone="${object.zone}"]`);
    if (host) host.append(createCard(object));
  });
  $("#objectCount").textContent = `${visible.length} objects`;
}

function renderComponentAssets() {
  const stage = $("#stage");
  const matches = componentAssets.filter((asset) => `${asset.name} ${asset.category} ${asset.family}`.toLowerCase().includes(assetQuery.toLowerCase()));
  const categories = [...new Set(matches.map((asset) => asset.category))];
  stage.innerHTML = `<div class="asset-toolbar">
      <div><span class="eyebrow">Native component registry</span><strong>${matches.length} rendered assets</strong></div>
      <label class="asset-search"><span>⌕</span><input id="assetSearch" type="search" value="${escapeHtml(assetQuery)}" placeholder="Search components" /></label>
      <button id="syncAssets" class="button ghost">Sync registry</button>
    </div>
    <div class="asset-scroll"><div class="asset-library">
      <header class="asset-hero"><div><span class="native-pill"><i></i> Live DOM previews</span><h1>Components</h1><p>Reusable components rendered natively in Open Pencil. Select one to inspect its source target, tokens, and states.</p></div><div class="asset-stat"><strong>${componentAssets.length}</strong><span>native now</span></div></header>
      ${categories.map((category) => `<section class="asset-section"><header><div><h2>${category}</h2><span>${matches.filter((asset) => asset.category === category).length} components</span></div></header><div class="asset-grid">${matches.filter((asset) => asset.category === category).map(assetCard).join("")}</div></section>`).join("") || `<div class="asset-empty"><strong>No components found</strong><span>Try a broader component or category name.</span></div>`}
    </div></div>`;
  $("#assetSearch").addEventListener("input", (event) => {
    assetQuery = event.target.value;
    renderComponentAssets();
    const input = $("#assetSearch");
    input.focus();
    input.setSelectionRange(assetQuery.length, assetQuery.length);
  });
  $("#syncAssets").addEventListener("click", () => showToast("Registry sync hook is ready for the source inventory"));
  $$(".asset-card").forEach((card) => card.addEventListener("click", () => { selectedAssetId = card.dataset.assetId; render(); }));
}

function assetCard(asset) {
  return `<article class="asset-card${asset.id === selectedAssetId ? " selected" : ""}" data-asset-id="${asset.id}" tabindex="0">
    <div class="asset-card-meta"><div><strong>${asset.name}</strong><span>${asset.family}</span></div><span class="native-label">Native</span></div>
    <div class="asset-specimen" data-native-preview="${asset.id}">${nativeSpecimen(asset)}</div>
    <footer><span>${asset.source}</span><span>↗</span></footer>
  </article>`;
}

function nativeSpecimen(asset) {
  const specimens = {
    "patient-header": `<div class="native-patient"><span class="native-avatar">SJ</span><div><strong>Sarah Johnson</strong><small>34y · Female · #051621</small></div><span class="native-badge neutral">INS</span><span class="native-badge violet">PAT</span><p><span>⚠ Penicillin allergy</span><span>Next · May 20</span></p></div>`,
    "clinical-alert": `<div class="native-alert"><span>!</span><div><strong>Penicillin allergy</strong><small>Recorded reaction · Hives</small></div><button>Review</button></div>`,
    "patient-avatar": `<div class="avatar-row"><span class="native-avatar large">SJ<i></i></span><span class="native-avatar image">AR<i></i></span><span class="native-avatar muted">+3</span></div>`,
    "primary-button": `<div class="button-row"><button class="native-button primary">Save changes</button><button class="native-button primary" disabled>Saving…</button></div>`,
    "button-group": `<div class="native-button-group"><button class="active">Day</button><button>Week</button><button>Month</button></div>`,
    "search-field": `<label class="native-field"><span>Patient search</span><div><b>⌕</b><input value="Sarah" aria-label="Patient search specimen" /><kbd>⌘ K</kbd></div></label>`,
    "segmented-control": `<div class="native-segments"><button class="active">Overview</button><button>History</button><button>Notes</button></div>`,
    "status-badge": `<div class="badge-row"><span class="native-badge success">Active</span><span class="native-badge warning">Pending</span><span class="native-badge danger">Alert</span></div>`,
    "card-surface": `<div class="native-card"><header><div><strong>Upcoming visit</strong><small>Tomorrow · 10:30 AM</small></div><button>•••</button></header><p>Periodic exam · Dr. Rivera</p></div>`,
    "empty-state": `<div class="native-empty"><span>＋</span><strong>No treatment plans yet</strong><small>Create a plan to begin documenting care.</small><button class="native-button primary">Create plan</button></div>`,
  };
  return specimens[asset.specimen];
}

function createCard(object) {
  const card = document.createElement("article");
  card.className = `object-card ${object.type}${object.id === state.selectedId ? " selected" : ""}`;
  card.dataset.id = object.id;
  card.tabIndex = 0;
  const source = object.sourceId ? state.objects.find((item) => item.id === object.sourceId) : null;
  card.innerHTML = `
    <header class="object-header">
      <div class="object-title"><span class="object-icon">${iconFor(object.type)}</span><div><strong>${object.title}</strong><small>${object.subtitle}</small></div></div>
      <span class="status ${statusClass(object)}">${object.modified ? "Unsaved" : object.status}</span>
    </header>
    ${object.type === "production" || ["draft", "variant"].includes(object.type) ? patientPreview(object) : objectPreview(object)}
    <footer><span>${source ? `Branched from ${source.title}` : object.updated}</span><button class="card-menu" aria-label="Object actions">•••</button></footer>`;
  card.addEventListener("click", (event) => {
    if (event.target.closest(".card-menu")) return openObjectMenu(event.target, object);
    state.selectedId = object.id;
    render();
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { state.selectedId = object.id; render(); }
  });
  return card;
}

function patientPreview(object) {
  const compact = object.id === "draft-compact";
  return `<div class="patient-preview${compact ? " compact" : ""}">
    <div class="avatar">SJ</div><div class="patient"><strong>Sarah Johnson</strong><span>34y · Female · #051621</span></div>
    <span class="chip">INS</span><span class="chip violet">PAT</span>
    <div class="clinical"><span>Penicillin allergy</span><span>Next · May 20</span></div>
  </div>`;
}

function objectPreview(object) {
  if (object.type === "asset-instance") return `<div class="instance-preview">${nativeSpecimen(componentAssets.find((asset) => asset.id === object.assetId))}</div>`;
  if (object.type === "flow") return `<div class="flow-preview"><span class="flow-number">${object.title === "Patient Search" ? "1" : "2"}</span><div><strong>${object.title}</strong><small>${object.note}</small></div><span class="flow-arrow">→</span></div>`;
  if (object.type === "review") return `<div class="review-preview"><blockquote>“Keep the allergy warning visible at mobile width.”</blockquote><span>Clinical design review</span></div>`;
  if (object.type === "change-set") return `<div class="change-preview"><div><span>Components</span><strong>4</strong></div><div><span>Tokens</span><strong>3</strong></div><div><span>Comments</span><strong>0</strong></div></div>`;
  return `<div class="archive-preview"><span>Historical reference</span><p>${object.note}</p></div>`;
}

function renderInspector() {
  if (activeSurface === "components") return renderAssetInspector();
  const object = selected();
  if (!object) return;
  const container = $("#inspectorContent");
  container.innerHTML = `
    <section class="selection-heading">
      <span class="eyebrow">Selected container</span>
      <div><h2>${object.title}</h2><span class="status ${statusClass(object)}">${object.modified ? "Unsaved" : object.status}</span></div>
      <p>${object.note}</p>
    </section>
    <section class="action-section"><h3>State controls</h3><div id="stateActions" class="state-actions"></div></section>
    ${["production", "draft", "variant"].includes(object.type) ? designControls(object) : relationshipPanel(object)}
    <section class="relationship"><h3>Relationship</h3><dl><div><dt>Location</dt><dd>${folderFor(object)}</dd></div><div><dt>Source</dt><dd>${sourceName(object)}</dd></div><div><dt>Updated</dt><dd>${object.updated}</dd></div></dl></section>
    <section class="activity"><h3>Recent activity</h3><ol>${state.events.slice(0, 4).map((event) => `<li>${event.text}<time>${event.time}</time></li>`).join("")}</ol></section>`;
  renderStateActions(object);
  bindDesignControls(object);
}

function renderAssetInspector() {
  const asset = componentAssets.find((item) => item.id === selectedAssetId) || componentAssets[0];
  const container = $("#inspectorContent");
  container.innerHTML = `<section class="selection-heading"><span class="eyebrow">Native component</span><div><h2>${asset.name}</h2><span class="status asset-instance">Live</span></div><p>${asset.description}</p></section>
    <section class="asset-inspector-preview"><h3>Rendered specimen</h3><div class="asset-specimen large">${nativeSpecimen(asset)}</div></section>
    <section class="action-section"><h3>Asset actions</h3><div class="state-actions"><button id="placeAsset" class="button primary">Place on canvas</button><button id="copyAssetPath" class="button ghost">Copy source</button></div></section>
    <section class="relationship"><h3>Registry</h3><dl><div><dt>Category</dt><dd>${asset.category}</dd></div><div><dt>Family</dt><dd>${asset.family}</dd></div><div><dt>Render</dt><dd>Native DOM</dd></div><div><dt>Source</dt><dd class="source-path">${asset.source}</dd></div></dl></section>
    <section class="asset-tokens"><h3>Bound tokens</h3><div>${asset.tokens.map((token) => `<span>${token}</span>`).join("")}</div></section>`;
  $("#placeAsset").addEventListener("click", () => placeAssetOnCanvas(asset));
  $("#copyAssetPath").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(asset.source); showToast("Source target copied"); }
    catch { showToast(asset.source); }
  });
}

function placeAssetOnCanvas(asset) {
  const object = { id: `asset-${Date.now()}`, type: "asset-instance", zone: "exploring", title: asset.name, subtitle: `Asset instance · ${asset.category}`, status: "Linked", sourceId: null, assetId: asset.id, modified: false, note: `Native instance linked to ${asset.source}.`, updated: "Placed just now" };
  state.objects.push(object);
  state.selectedId = object.id;
  activeSurface = "workspace";
  addEvent(`${asset.name} placed from Assets`);
  render();
  showToast(`${asset.name} placed on the canvas`);
}

function renderWorkspaceTitle() {
  $(".crumb").textContent = activeSurface === "components" ? "Assets / Components" : "Workspaces / Dental Chart Improvements";
  $(".workspace-title strong").textContent = activeSurface === "components" ? "Native component library" : "Patient header exploration";
}

function renderStateActions(object) {
  const host = $("#stateActions");
  actionsFor(object).forEach((action) => {
    const button = document.createElement("button");
    button.className = `button ${action.primary ? "primary" : "ghost"}`;
    button.textContent = action.label;
    button.addEventListener("click", (event) => runAction(action.command, object, event.currentTarget));
    host.append(button);
  });
}

function actionsFor(object) {
  if (object.type === "asset-instance") return [{ label: "View asset", command: "view-asset" }, { label: "Save as Variant", command: "save-menu", primary: true }];
  if (object.type === "production") return [{ label: "Compare", command: "compare" }, { label: "Branch to Edit", command: "branch", primary: true }];
  if (object.type === "review") return [{ label: "Request changes", command: "request-changes" }, { label: "Approve", command: "approve", primary: true }];
  if (object.type === "change-set") return [{ label: "Compare", command: "compare" }, { label: "Start implementation", command: "implement", primary: true }];
  if (object.type === "archived") return [{ label: "Restore", command: "restore", primary: true }];
  if (object.type === "flow") return [{ label: "Add state", command: "add-flow-state" }, { label: "Send to Review", command: "send-review", primary: true }];
  return [{ label: "Undo", command: "undo" }, { label: "Compare", command: "compare" }, { label: object.modified ? "Save Draft ▾" : "Save ▾", command: "save-menu", primary: true }];
}

function designControls(object) {
  return `<section class="design-controls"><h3>Container design</h3>
    <label><span>Layout density</span><select id="density"><option>Comfortable</option><option ${object.id === "draft-compact" ? "selected" : ""}>Compact</option><option>Dense</option></select></label>
    <label><span>Spacing token</span><select id="spacing"><option>space-3 · 12px</option><option selected>space-4 · 16px</option><option>space-6 · 24px</option></select></label>
    <label><span>Radius token</span><select id="radius"><option>radius-md · 8px</option><option selected>radius-lg · 12px</option></select></label>
    <label class="switch-row"><span>Show clinical alerts</span><input id="alerts" type="checkbox" checked /></label>
  </section>`;
}

function relationshipPanel(object) {
  return `<section class="design-controls"><h3>${object.type === "change-set" ? "Implementation scope" : "Decision context"}</h3><p class="muted-copy">${object.note}</p></section>`;
}

function bindDesignControls(object) {
  $$(".design-controls select, .design-controls input").forEach((control) => control.addEventListener("change", () => {
    if (object.type === "production") {
      showToast("Branch production before editing");
      renderInspector();
      return;
    }
    object.modified = true;
    object.updated = "Unsaved changes";
    addEvent(`${object.title} design properties changed`);
    render();
  }));
}

function runAction(command, object, anchor) {
  const simple = {
    compare: `Comparing ${object.title} with its production source`,
    undo: `Undid the latest change to ${object.title}`,
    implement: `${object.title} moved into implementation`,
  };
  if (simple[command]) { addEvent(simple[command]); showToast(simple[command]); return render(); }
  if (command === "view-asset") { selectedAssetId = object.assetId; activeSurface = "components"; return render(); }
  if (command === "branch") return openDialog("branch", object);
  if (command === "save-menu") return openMenu(anchor, object, ["Save Draft", "Save as Variant", "Add to Flow", "Send to Review", "Create Change Set"]);
  if (command === "approve") return transition(object, "approved", "Approved", "Proposal approved and ready for a change set");
  if (command === "request-changes") return transition(object, "exploring", "Draft", "Review returned to exploration with requested changes");
  if (command === "send-review") return transition(object, "review", "In Review", `${object.title} sent to review`);
  if (command === "restore") return transition(object, "exploring", "Draft", `${object.title} restored from archive`);
  if (command === "add-flow-state") return openDialog("flow-state", object);
}

function openObjectMenu(anchor, object) {
  const labels = object.type === "production" ? ["Branch to Edit", "Compare", "Copy reference"] : ["Duplicate", "Save as Variant", "Add to Flow", "Send to Review", "---", object.zone === "archived" ? "Restore" : "Archive", "Delete"];
  openMenu(anchor, object, labels);
}

function openMenu(anchor, object, labels) {
  const menu = $("#menu");
  menu.replaceChildren();
  labels.forEach((label) => {
    if (label === "---") { const hr = document.createElement("div"); hr.className = "menu-separator"; return menu.append(hr); }
    const button = document.createElement("button");
    button.textContent = label;
    if (["Delete", "Archive"].includes(label)) button.className = "danger";
    button.addEventListener("click", () => { menu.hidden = true; handleMenuChoice(label, object); });
    menu.append(button);
  });
  const rect = anchor.getBoundingClientRect();
  menu.hidden = false;
  menu.style.left = `${Math.min(rect.left, innerWidth - 230)}px`;
  menu.style.top = `${Math.min(rect.bottom + 6, innerHeight - menu.offsetHeight - 12)}px`;
}

function handleMenuChoice(label, object) {
  const dialogs = { "Branch to Edit": "branch", "Save as Variant": "variant", "Add to Flow": "flow", "Create Change Set": "change-set", "Duplicate": "duplicate" };
  if (dialogs[label]) return openDialog(dialogs[label], object);
  if (label === "Save Draft") { object.modified = false; object.updated = "Saved just now"; addEvent(`${object.title} draft saved`); showToast("Draft saved locally"); return render(); }
  if (label === "Send to Review") return transition(object, "review", "In Review", `${object.title} sent to review`);
  if (label === "Archive") return transition(object, "archived", "Archived", `${object.title} archived`);
  if (label === "Restore") return transition(object, "exploring", "Draft", `${object.title} restored`);
  if (label === "Delete") { state.objects = state.objects.filter((item) => item.id !== object.id); state.selectedId = "production-header"; addEvent(`${object.title} moved to trash`); return render(); }
  showToast(`${label} selected`);
}

function openDialog(action, source) {
  const config = {
    branch: ["Create safe branch", "Draft name", `Edit of ${source.title}`, "Create draft"],
    variant: ["Preserve an alternative", "Variant name", `${source.title} alternative`, "Save variant"],
    flow: ["Add to connected experience", "Flow step name", source.title, "Add to flow"],
    "flow-state": ["Add interaction state", "State name", "Success state", "Add state"],
    "change-set": ["Prepare for implementation", "Change set name", source.title, "Create change set"],
    duplicate: ["Duplicate object", "Copy name", `${source.title} copy`, "Duplicate"],
  }[action];
  dialogAction = { action, sourceId: source.id };
  $("#dialogEyebrow").textContent = config[0];
  $("#dialogTitle").textContent = config[1];
  $("#dialogFields").innerHTML = `<label class="dialog-field"><span>${config[1]}</span><input id="dialogName" required value="${config[2]}" /></label><label class="dialog-field"><span>Intent or note</span><textarea id="dialogNote" rows="3" placeholder="Why are we creating this state?">${source.note || ""}</textarea></label>`;
  $("#dialogSubmit").textContent = config[3];
  $("#dialogBackdrop").hidden = false;
  setTimeout(() => $("#dialogName").select(), 0);
}

function submitDialog(event) {
  event.preventDefault();
  const { action, sourceId } = dialogAction;
  const source = state.objects.find((item) => item.id === sourceId);
  const title = $("#dialogName").value.trim();
  const note = $("#dialogNote").value.trim();
  const mapping = {
    branch: ["draft", "exploring", "Draft", "Draft"],
    variant: ["variant", "exploring", "Variant", "Variant"],
    duplicate: [source.type, source.zone, source.status, source.subtitle],
    flow: ["flow", "flows", "Flow", "Connected flow state"],
    "flow-state": ["flow", "flows", "Flow", "Connected interaction state"],
    "change-set": ["change-set", "approved", "Proposed", "Proposed Change Set"],
  }[action];
  const object = { id: `${mapping[0]}-${Date.now()}`, type: mapping[0], zone: mapping[1], title, subtitle: mapping[3], status: mapping[2], sourceId: source.id, modified: action === "branch", note, updated: action === "branch" ? "Unsaved changes" : "Saved just now" };
  state.objects.push(object);
  state.selectedId = object.id;
  addEvent(`${title} created as ${mapping[0]}`);
  closeDialog();
  showToast(`${title} created`);
  render();
}

function transition(object, zone, status, message) {
  object.zone = zone;
  object.status = status;
  object.type = zone === "approved" ? "change-set" : zone === "review" ? "review" : zone === "archived" ? "archived" : object.type;
  object.modified = false;
  object.updated = "Updated just now";
  addEvent(message);
  showToast(message);
  render();
}

function addEvent(text) { state.events.unshift({ text, time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }); }
function escapeHtml(value) { return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function selected() { return state.objects.find((object) => object.id === state.selectedId) || state.objects[0]; }
function sourceName(object) { return object.sourceId ? state.objects.find((item) => item.id === object.sourceId)?.title || "Original source" : "Live application"; }
function folderFor(object) { return object.zone === "production" ? "Pages / Dental Chart" : object.zone === "approved" ? "Change Sets / Approved" : `Workspaces / Dental Chart Improvements / ${object.zone[0].toUpperCase() + object.zone.slice(1)}`; }
function iconFor(type) { return ({ production: "◫", draft: "◩", variant: "◇", flow: "→", review: "◉", "change-set": "✓", archived: "□", "asset-instance": "◆" })[type] || "◇"; }
function statusClass(object) { return object.modified ? "unsaved" : object.type.replace("change-set", "approved"); }

function closeDialog() { $("#dialogBackdrop").hidden = true; dialogAction = null; }
let toastTimer;
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("visible"), 1800); }

$("#treeSearch").addEventListener("input", () => renderTree());
$("#dialog").addEventListener("submit", submitDialog);
$$('[data-close-dialog]').forEach((button) => button.addEventListener("click", closeDialog));
$("#dialogBackdrop").addEventListener("click", (event) => { if (event.target === $("#dialogBackdrop")) closeDialog(); });
document.addEventListener("click", (event) => { if (!event.target.closest("#menu") && !event.target.closest(".card-menu") && !event.target.closest(".state-actions")) $("#menu").hidden = true; });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { $("#menu").hidden = true; closeDialog(); } });
$$('[data-command]').forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.command === "reset-demo") { localStorage.removeItem(STORAGE_KEY); state = structuredClone(seedState); render(); showToast("Demo workspace restored"); }
  if (button.dataset.command === "new-draft") openDialog("branch", state.objects.find((item) => item.type === "production"));
}));

render();
