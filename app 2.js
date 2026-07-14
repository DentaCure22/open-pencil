const stateConfig = {
  production: {
    badge: "Production",
    source: "Pages / Dental Chart / Patient Header",
    actions: [
      { label: "Compare", action: "compare" },
      { label: "Branch to Edit", action: "branch", primary: true },
      { label: "•••", action: "more", title: "More actions" },
    ],
  },
  draft: {
    badge: "Draft · Unsaved",
    source: "Workspaces / Dental Chart Improvements / Drafts",
    actions: [
      { label: "Undo", action: "undo" },
      { label: "Reset", action: "reset" },
      { label: "Save Draft ▾", action: "save", primary: true },
      { label: "•••", action: "more", title: "More actions" },
    ],
  },
  variant: {
    badge: "Variant B · Saved",
    source: "Workspaces / Dental Chart Improvements / Variants / Patient Header",
    actions: [
      { label: "Undo", action: "undo" },
      { label: "Compare", action: "compare" },
      { label: "Save ▾", action: "save", primary: true },
      { label: "•••", action: "more", title: "More actions" },
    ],
  },
  review: {
    badge: "In Review",
    source: "Workspaces / Dental Chart Improvements / Review",
    actions: [
      { label: "Compare", action: "compare" },
      { label: "View Review", action: "review", primary: true },
      { label: "•••", action: "more", title: "More actions" },
    ],
  },
  approved: {
    badge: "Approved",
    source: "Workspaces / Dental Chart Improvements / Approved",
    actions: [
      { label: "Compare", action: "compare" },
      { label: "Create Change Set", action: "change-set", primary: true },
      { label: "•••", action: "more", title: "More actions" },
    ],
  },
};

const saveMenu = ["Save Draft", "Save as Variant", "Add to Flow", "Create Change Set"];
const moreMenu = ["Duplicate", "Branch from Here", "Move to Workspace", "Promote to Asset", "Copy or Export", "---", "Reset Container", "Archive", "Delete"];

let currentState = "production";
const statusBadge = document.querySelector("#statusBadge");
const sourceLabel = document.querySelector("#sourceLabel");
const headerActions = document.querySelector("#headerActions");
const eventLog = document.querySelector("#eventLog");
const menu = document.querySelector("#menu");
const toast = document.querySelector("#toast");

function renderState(state) {
  currentState = state;
  const config = stateConfig[state];
  statusBadge.textContent = config.badge;
  statusBadge.className = `status-badge ${state}`;
  sourceLabel.textContent = config.source;
  headerActions.replaceChildren();

  config.actions.forEach((item) => {
    const button = document.createElement("button");
    button.className = `action-button${item.primary ? " primary" : ""}`;
    button.textContent = item.label;
    button.title = item.title || item.label;
    button.addEventListener("click", (event) => handleAction(item.action, event.currentTarget));
    headerActions.append(button);
  });

  document.querySelectorAll(".state-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.state === state);
  });
  closeMenu();
}

function handleAction(action, anchor) {
  if (action === "save") return openMenu(anchor, saveMenu);
  if (action === "more") return openMenu(anchor, moreMenu);
  if (action === "branch") {
    logEvent("Branched Patient Header into a safe draft");
    renderState("draft");
    return showToast("Draft created — production remains unchanged");
  }

  const messages = {
    compare: "Opened comparison with production",
    undo: "Undid the latest container edit",
    reset: "Reset requested — confirmation would protect current edits",
    review: "Opened focused review",
    "change-set": "Created a proposed change set from the approved container",
  };
  logEvent(messages[action]);
  showToast(messages[action]);
}

function openMenu(anchor, items) {
  menu.replaceChildren();
  items.forEach((label) => {
    if (label === "---") {
      const separator = document.createElement("div");
      separator.className = "separator";
      menu.append(separator);
      return;
    }
    const button = document.createElement("button");
    button.textContent = label;
    if (["Reset Container", "Delete"].includes(label)) button.className = "danger";
    button.addEventListener("click", () => selectMenuItem(label));
    menu.append(button);
  });

  const rect = anchor.getBoundingClientRect();
  menu.hidden = false;
  menu.style.top = `${rect.bottom + 7}px`;
  menu.style.left = `${Math.min(rect.right - 206, window.innerWidth - 218)}px`;
}

function selectMenuItem(label) {
  const transitions = {
    "Save Draft": "variant",
    "Save as Variant": "variant",
    "Create Change Set": "approved",
  };
  logEvent(`${label} selected for Patient Header`);
  if (transitions[label]) renderState(transitions[label]);
  closeMenu();
  showToast(`${label} selected`);
}

function closeMenu() {
  menu.hidden = true;
}

function logEvent(message) {
  if (!message) return;
  const item = document.createElement("li");
  item.textContent = message;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  item.append(time);
  eventLog.prepend(item);
}

let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 1800);
}

document.querySelectorAll(".state-button").forEach((button) => {
  button.addEventListener("click", () => {
    renderState(button.dataset.state);
    logEvent(`Previewed ${button.dataset.state} header state`);
  });
});

document.querySelector("#clearLog").addEventListener("click", () => eventLog.replaceChildren());
document.addEventListener("click", (event) => {
  if (!menu.hidden && !menu.contains(event.target) && !event.target.closest(".header-actions")) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

renderState(currentState);
logEvent("Loaded protected production container state");
