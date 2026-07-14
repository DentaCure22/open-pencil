# Visual self-test

Date: 2026-07-12  
Surface: live local OpenPencil MCP board layer  
Source status: the typed knowledge-workspace vertical slice is installed in the real checkout; this illustrative board did not modify production application source.

## First pass

The board generator connected to `127.0.0.1:7600`, selected the Dental Chart page, rendered the board root `0:631`, ran overlap/color/typography/spacing analysis, and exported:

`/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base/artifacts/openpencil-workflows/05-polished-dental-workflow.png`

The export demonstrated:

- a compact board guide
- a left-to-right four-state journey
- vertical Draft and Alternate branches
- Preferred, In Review, Approved, and Change Set distinctions
- truthful `Illustrative` labels for reconstructed states
- the one-shared-runtime and production-protection explanation
- restrained semantic status color and consistent state-card geometry

## Inspection result

The journey and decision edge were readable at overview scale. The lower-left notes region contained excessive unused white space, however, so the first pass did not satisfy the visual-quality rejection rule against accidental dead zones.

The automated overlap analyzer reported many false-positive text overlaps because rendered text nodes use broad default analysis bounds, but it also correctly reinforced that image inspection is required instead of accepting analyzer output alone.

## Second pass

`polished-openpencil-canvas.mjs` was revised to use the lower-left region for a mixed knowledge workspace containing:

- Document blocks with a brief, decision callout, and checklist
- a Collection view with shared finding records
- a truthfully labeled captured Live App Block
- fixed-height flow notes and runtime-model cards

The second pass connected to the live OpenPencil app and MCP service, replaced the same board root (`0:4` on page `0:3`), reran overlap/color/typography/spacing analysis, and exported to:

`artifacts/openpencil-workflows/06-knowledge-canvas-self-test.png`

## Inspection result

The revised export passes the visual self-test. The reading order is clear at overview scale, the previous lower-left dead zone is now a useful mixed knowledge workspace, state and version geometry is consistent, and the decision edge remains visually distinct. The reconstructed screen states and inactive Live App Block remain truthfully labeled.

The automated overlap analyzer still reports false positives for compact text nodes because its analysis bounds are broader than the rendered glyphs. Image inspection confirmed the intended composition. A few miniature controls inside the captured Live App Block intentionally compress at overview scale; they do not obscure the board's meaning.

## Result

- Overview composition: pass
- Document, Collection, and Live App examples: pass
- Horizontal flow and vertical edit branches: pass
- Runtime/source safety explanation: pass
- Revised export inspected: pass
