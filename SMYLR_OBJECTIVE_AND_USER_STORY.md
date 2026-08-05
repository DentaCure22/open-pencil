# Smylr Container Editor Objective

## Goal

Turn OpenPencil into the base for an agentified Smylr container editor.

The editor should run outside the Intent Workbench, inside the production app
context, and let Omar select real UI containers, understand their owner chain,
adjust token-backed layout/surface choices, and hand the clean change to an
agent or save it as a reusable container recipe.

## User Story

As Omar editing Smylr, I want to press `Cmd+C` on a production UI container and
open a focused editor where I can see the selected container, the containers
above it, token/style evidence, grid/layout controls, and agent-safe actions,
so I can make visual adjustments without manually hunting through wrappers,
hidden class constants, or noisy design files.

## Product Idea

Use OpenPencil's mature editor shell and tooling as the base:

- left panel: organized Smylr container tree and owner map
- center canvas: the selected live app container as an editable scene
- right panel: Design / Code / AI inspector
- bottom tool dock: select, container, move, grid, token, copy/send actions
- MCP/tool layer: agent actions that generate scoped Smylr code patches

Replace OpenPencil's document-first mental model with Smylr live-container
documents. `.fig` and `.pen` remain useful import/export capabilities, but they
are not the primary workflow.

## Primary Workflow

1. User selects a production app container with `Cmd+C`.
2. Smylr captures DOM evidence: selected node, owners above it, class tokens,
   computed styles, child boxes, source file, and route.
3. The OpenPencil fork loads that capture as `SmylrLiveContainerDocument`.
4. User adjusts layout/surface/grid/token controls with visible preview.
5. User chooses:
   - copy stack/context to agent
   - send clean patch packet to agent
   - save as container recipe
   - apply a scoped patch after agent verification

## MVP

- Load a sample `SmylrLiveContainerDocument` into OpenPencil's scene graph.
- Preserve source metadata on scene nodes with `data-smylr-*` attributes.
- Add editor-store actions for opening live container documents.
- Rename the fork goal and first entry points around container editing.
- Keep the live-container bridge independent from temporary Smylr editor pages.

## Non Goals For The First Cut

- Do not build a generic Figma clone.
- Do not start with full freeform drawing as the main workflow.
- Do not rewrite Smylr's existing Intent runtime before the OpenPencil fork can
  load and display a container document.
- Do not remove OpenPencil file support yet; hide or de-emphasize it after the
  live-container path is working.
