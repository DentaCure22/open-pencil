# OpenPencil right inspector v1

Status: applied to the live Smylr-Elite OpenPencil source and browser-verified.

## Target

`/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base`

The patch was prepared as paired `original/` and `modified/` snapshots before it was copied into the live source.

## Design contract

- Match the approved left sidebar's floating dark shell, quiet rows, restrained violet accent, and low-chrome hierarchy.
- Keep exactly three labeled inspector views: Design, HTML, and Trace.
- Remove the AI view, sparkle icon, fourth navigation slot, and zoom percentage from the mode switcher.
- Keep the collaborator and Share header consistent across all modes.
- Use progressive disclosure instead of opening the HTML import form by default.
- Keep selected-object identity visible before Design properties.
- Remove the heavy Trace timeline spine and duplicate empty-session actions.

## Applied source files

- `src/components/PropertiesPanel.vue`
- `src/components/properties-panel.css`
- `src/components/NativeSelectionInspector.vue`
- `src/components/CodePanel.vue`
- `src/components/narrated-trace/NarratedTracePanel.vue`
- `src/components/narrated-trace/NarratedTraceHeader.vue`
- `src/views/EditorView.vue`
- `tests/e2e/code/panel.spec.ts`
- `CHANGELOG.md`

## Verification

- Focused type-aware lint: 0 warnings, 0 errors across all touched Vue/TypeScript source files.
- Production Vite build: passed.
- Combined inspector and narrated-trace browser suites: 13/13 passed.
- Live browser route: `http://127.0.0.1:1420/`.
- Live runtime console: 0 errors after Design, HTML, Trace, close, and reopen checks.
- AI tab count: 0.
- Independent right-inspector collapse/reopen: passed while the left sidebar remained visible.
- A temporary rectangle was created for Design/HTML review and removed afterward.

The repository-wide Vue typecheck still reports pre-existing errors in `packages/dom-css` and unrelated live-inspector files. None of the diagnostics point to a file in this patch, and the production build plus focused suites pass.

## Screenshot evidence

- `artifacts/openpencil-right-inspector-design-final.png`
- `artifacts/openpencil-right-inspector-html-final.png`
- `artifacts/openpencil-right-inspector-trace-final.png`

The source screenshot remains the review authority; the earlier generated triptych was an illustrative preview only.
