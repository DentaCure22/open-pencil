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
   it. A comment pill opens beside the numbered boundary; text is optional, and
   clicking the durable blue handle reopens it later. Enter or clicking another
   element saves the comment automatically. The compact icon controls support
   dictation and motion recording with tooltips; the delete icon appears only
   after reopening a saved handle and removes that selection. Starting motion
   recording clears the inspection chrome before the optional 30-second WebM
   clip. The comment field keeps normal text-input behavior even when the page
   has global keyboard shortcuts. `R` remains a shortcut when the comment pill
   is closed.
7. Switch to more web tabs and keep selecting. Every tab shares the same capture
   session and global selection numbering. The agent receives those exact stable
   references as `Annotation #1`, `Annotation #2`, and so on, so typed or spoken
   instructions can address each capture by number. Escape in any participating
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
  element-only crop for Board persistence. Its Chrome-side comment handle remains
  editable without requiring text, and deleting that handle removes the selection.
- Hovered and committed elements use a dashed boundary with no interior tint in
  both the live picker and the annotated context PNG.
- The blue annotation marker and compact mic, recording, and delete artwork are
  generated from a transparent master and vectorized into packaged SVG files.
  The background worker embeds those SVGs as self-contained image data before
  injection, so inspected pages never need to load extension asset URLs and
  their CSS cannot erase the controls.
- A numbered annotation handle is added as soon as Chrome reserves its sequence;
  screenshot capture and delivery continue in the background, so slow capture
  work cannot hide later selections.
- Motion recording is opt-in, capped at 30 seconds and 11.5 MB, and uses Chrome's
  `tabCapture` through an MV3 offscreen document when Chrome grants the stream.
  When Chrome rejects that API because Inspect Chrome began from OpenPencil
  instead of the extension toolbar, the same control automatically records a
  motion-only WebM from bounded visible-tab frames at under Chrome's two-captures-
  per-second limit.
- Iframe, frame, embed, and object shells receive explicit top-document selection
  shields because events inside embedded documents do not bubble to their parent.
  Open shadow-root controls resolve from their composed event path instead of
  collapsing to the custom-element host.
- Dragging a selection to the Board creates one ordinary persisted Code Object at
  the element's CSS-pixel dimensions. Design mode preserves normal Board
  selection and transforms; Interact mode relays bounded pointer, wheel, key, and
  text input through the extension.
- Chrome selections stream clean tab pixels in the browser build through the
  extension's bounded offscreen tab capture. Native desktop-app pixels still
  require the macOS Tauri build and Screen Recording permission.
- Chrome internal pages and descent into cross-origin iframe contents remain
  unavailable; the iframe shell itself is selectable.
