# Smylr OpenPencil Fork Start

This source tree is a vendored MIT-licensed OpenPencil snapshot.

Source: https://github.com/open-pencil/open-pencil  
License: `LICENSE` in this directory. Keep the copyright and permission notice with copied or modified OpenPencil code.

## Product Direction

Start from OpenPencil's editor shell, not the old Smylr debug drawer.

Keep:
- Left layer/container panel
- Center canvas/editor surface
- Right Design / Code / AI inspector tabs
- Bottom tool dock
- Scene graph, selection, undo, canvas, DOM/CSS import, MCP/tool architecture

Replace:
- `.fig` / `.pen` as the primary document source
- File-first open/save UX
- Generic design-document naming
- OpenPencil AI prompts that assume static design files

With:
- `SmylrLiveContainerDocument`
- Production DOM capture as the source of truth
- Container tree, owner map, token controls, grid controls, and agent handoff
- Save/apply/copy operations that produce scoped Smylr code patches

## First Cut

The first new adapter lives in:

`src/app/smylr-live-container/`

It converts captured Smylr production containers into OpenPencil `DesignDocument`
nodes. From there, OpenPencil's existing DOM/CSS and scene-graph systems can
render and edit the container as if it were a normal editable document.

## Gut Order

1. Keep OpenPencil running as its own app.
2. Add a Smylr live-container import command that builds a scene graph from captured DOM.
3. Rename the UI surface from generic document editor to container editor.
4. Disable or hide file/document features that are not useful for Smylr container editing.
5. Replace export/save with:
   - copy selected container packet
   - copy all containers above
   - save container recipe
   - send clean agent patch packet
6. Add MCP tools that operate on Smylr container nodes and token patches.
