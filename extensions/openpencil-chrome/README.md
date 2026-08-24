# OpenPencil Inspect for Chrome

This unpacked Manifest V3 extension gives OpenPencil the same basic DOM-selection
flow used by its iframe inspector: move across a page, see the element boundary,
click several elements into one capture session, and send their selectors and
surrounding-context screenshots to Trace and the agent. A captured element can
also be dragged directly onto the Board as a persisted external live surface.

The extension does not inspect Electron, CEF, or native apps. In the browser,
OpenPencil uses Chrome tab capture for clean live pixels from selected tabs. In
the Tauri desktop app, it uses the captured Chrome window geometry to drive its
separate ScreenCaptureKit live-pixel transport.

## Install for local development

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.
4. Keep OpenPencil open at `http://localhost:1420` or `http://127.0.0.1:1420`.
5. Press **Inspect Chrome** in the vertical Editor tools rail. This arms one
   browser-wide capture session without switching tabs.
6. Switch to any ordinary web tab yourself. Point at an element and click to add
   it. Selected elements keep numbered
   boundaries. Use Up/Down to move through DOM depth, **Record motion** (or `R`)
   for an optional 30-second WebM clip.
7. Switch to more web tabs and keep selecting. Every tab shares the same capture
   session and global selection numbering. **Done** or Escape in any participating
   tab finishes the session everywhere.
8. Open a session in OpenPencil and drag an element row onto the Board. The clean
   element crop becomes the persisted fallback; the desktop app reconnects the
   native live stream, and Code Object **Interact** mode relays input to the
   retained source element.

The extension ignores Chrome internal pages and never activates a tab on the
user's behalf. An armed session follows only tabs the user explicitly visits, and
each participating tab retains its own visible selection boundaries when revisited.

The manifest requests page access because Chrome allows a rail-initiated
`captureVisibleTab()` only with `<all_urls>` access; `activeTab` works only after
clicking the browser-extension icon. The background worker keeps the active session
identity, participating tab IDs, and global sequence in session storage. It injects
and reads a page only while that user-started session is active.

## Current boundary

- Each selected DOM element is added to the active Trace-linked capture session
  as a bounded semantic brief, an annotated context PNG for the agent, and a clean
  element-only crop for Board persistence.
- Motion recording is opt-in, capped at 30 seconds and 11.5 MB, and uses Chrome's
  `tabCapture` through an MV3 offscreen document.
- Dragging a selection to the Board creates one ordinary persisted Code Object at
  the element's CSS-pixel dimensions. Design mode preserves normal Board
  selection and transforms; Interact mode relays bounded pointer, wheel, key, and
  text input through the extension.
- Chrome selections stream clean tab pixels in the browser build through the
  extension's bounded offscreen tab capture. Native desktop-app pixels still
  require the macOS Tauri build and Screen Recording permission.
- Chrome internal pages and cross-origin iframe descent remain unavailable.
