# Attachment composer design QA

## Comparison target

- Source visual truth: `/var/folders/3p/1nb1q9rs4876lqrmh50kh6700000gn/T/TemporaryItems/NSIRD_screencaptureui_b12aAm/Screenshot 2026-08-22 at 8.10.11 AM.png`
- Browser-rendered implementation: `/Users/omar/.codex/visualizations/2026/08/22/01a02997-4f93-7fc3-b749-cc20a244a41f/openpencil-agent-attachment-chips-final.png`
- Focused side-by-side comparison: `/Users/omar/.codex/visualizations/2026/08/22/01a02997-4f93-7fc3-b749-cc20a244a41f/attachment-chip-comparison-final.png`
- State: light-theme New task composer with `index.ts` and `toolbar.webm` attached; attachment-only Send available.
- Viewport: 1280 x 720 CSS px at device pixel ratio 2.
- Source pixels: 544 x 166. Implementation screenshot pixels: 1280 x 720. The focused comparison crops the implementation composer and normalizes both sides to 166 px high; browser chrome is excluded.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the compact 12 px filename and 9 px type label preserve the source hierarchy and remain legible in OpenPencil's 247 px sidebar composer. The size reduction is intentional because the user asked for the established annotation-bar density rather than a desktop-sized Codex card.
- Spacing and layout rhythm: both chips use the existing 32 px annotation-chip height, 10 px radius, neutral border, compact badge, and consistent inter-chip gap. Long names retain room to truncate without displacing the removal action.
- Colors and visual tokens: the neutral control surface, muted file badge, and dark circular remove button reproduce the source structure using OpenPencil's existing semantic tokens.
- Image quality and asset fidelity: file, image, and video states use the project's established icon components. No raster placeholders, handmade SVGs, or blurry assets were introduced.
- Copy and content: filename and uppercase type/extension are visible. Picker labeling explicitly names files, images, and videos, and the drop state says `Drop files to attach`.
- Accessibility and interaction: each attachment has a persistent named Remove button; attachment-only Send is exposed; the picker accepts multiple arbitrary file types. The live browser accepted the supplied TypeScript file and a real WebM video together. No browser console errors were recorded.

## Full-view comparison evidence

The full implementation capture shows the attachment treatment in its real sidebar context: two wrapped chips above the textarea, the existing model selector and toolbar below, and no overflow or hidden composer controls.

## Focused region comparison evidence

The side-by-side image compares the supplied Codex file card with the implemented OpenPencil composer crop. It verifies the shared filename/type hierarchy, file badge, rounded neutral container, and dark circular removal affordance. The smaller scale is the intended annotation-chip adaptation.

## Comparison history

1. First pass evidence: `/Users/omar/.codex/visualizations/2026/08/22/01a02997-4f93-7fc3-b749-cc20a244a41f/openpencil-agent-attachment-chips-full.png`.
   - P2: attachment removal only appeared on hover, while the source keeps the close affordance visible.
   - Fix: made the dark circular Remove control persistent on every attachment chip.
2. Post-fix evidence: `/Users/omar/.codex/visualizations/2026/08/22/01a02997-4f93-7fc3-b749-cc20a244a41f/openpencil-agent-attachment-chips-final.png` and the final focused comparison.
   - The removal affordance is now visible for both file and video chips without hover. No P0/P1/P2 findings remain.

## Primary interactions checked

- Opened CHATS and a New task composer in the in-app browser.
- Opened the real multi-file chooser.
- Attached `/Users/omar/.pi/agent/npm/node_modules/pi-chrome/extensions/chrome-profile-bridge/index.ts` and `/Users/omar/Documents/Open Pencil/packages/demos/videos/toolbar.webm` together.
- Verified filename/type rendering, named removal controls, and attachment-only Send.
- Did not submit the task, so no agent work was dispatched during visual QA.

## Implementation checklist

- [x] Compact source-matched file chip treatment.
- [x] Distinct file, image, and video icons.
- [x] Persistent remove action.
- [x] Multiple arbitrary file selection.
- [x] Attachment-only Send state.
- [x] No console errors in the tested state.

## Follow-up polish

None required for this pass.

final result: passed
