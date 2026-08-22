# OpenPencil Inspect for Chrome

This unpacked Manifest V3 extension gives OpenPencil the same basic DOM-selection
flow used by its iframe inspector: move across a page, see the element boundary,
click several elements into one capture session, and send their selectors and
surrounding-context screenshots to Trace and the agent.

It does not create Board objects or inspect Electron, CEF, or native apps.

## Install for local development

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.
4. Keep OpenPencil open at `http://localhost:1420` or `http://127.0.0.1:1420`.
5. To inspect OpenPencil itself, press **Inspect Chrome** in the vertical Editor
   tools rail. No extension-toolbar click is needed.
6. Point at an element and click to add it. Selected elements keep numbered
   boundaries. Use Up/Down to move through DOM depth, **Record motion** (or `R`)
   for an optional 30-second WebM clip, and **Done** or Escape to finish.
7. To inspect another Chrome tab, visit it, then return to OpenPencil and press
   **Inspect Chrome**. The extension follows the last active ordinary web page.

The extension ignores Chrome internal pages and remembers the last ordinary web
page you actively visited. This prevents a stale tab ID from reopening an unrelated
page while keeping the full flow on OpenPencil's Editor tools rail.

The manifest requests page access because Chrome allows a rail-initiated
`captureVisibleTab()` only with `<all_urls>` access; `activeTab` works only after
clicking the browser-extension icon. The background listener remembers only the
active tab ID. It injects and reads the page only when you invoke the picker.

## Current boundary

- Each selected DOM element is added to the active Trace-linked capture session
  as a bounded semantic brief plus a PNG of its surrounding context. The purple
  target boundary and sequence number are baked into the PNG.
- Motion recording is opt-in, capped at 30 seconds and 11.5 MB, and uses Chrome's
  `tabCapture` through an MV3 offscreen document.
- The selector is read-only context. It does not edit the source page or create a
  Board object.
- Chrome internal pages and cross-origin iframe descent remain unavailable.
