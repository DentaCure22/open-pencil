---
title: Layers & Boards
description: Navigate the sidebar, layer tree, and workspace boards in OpenPencil.
---

# Layers & Boards

OpenPencil keeps the canvas open and puts the main controls in one floating left sidebar. Resize the
sidebar with its divider, or collapse it when you want more canvas space. The adjacent tool rail stays
available for drawing, workspace switching, and other editor actions.

## Sidebar

The sidebar has four focused views:

- **Layers** — browse and edit the current Board hierarchy.
- **Chats** — start or continue Pi tasks and open their Board cards.
- **Assets** — browse reusable assets and insert them onto the current Board.
- **Activity** — review captured Trace activity.

Switching views does not replace the canvas or create a second editor.

## Layers

The Layers view shows the current document as a tree.

- Use the chevron beside a container to expand or collapse its children.
- Drag a layer to reorder or reparent it.
- Use the eye control to hide or show an object without removing it.
- Double-click a name to rename it. Press <kbd>Enter</kbd> to commit or <kbd>Escape</kbd> to cancel.
- Select an item in the tree to select the same object on the canvas, and vice versa.

The variable button in the Layers header opens design-token management without adding another
permanent panel.

## Workspaces and Boards

Use the **Workspace** button in the tool rail to search recent Boards, switch Boards, or enter the
project manager. Switching restores that Board's saved viewport.

In project manager mode you can create, rename, organize, and remove projects and Boards. Each Board
owns its own canvas content and viewport state.

## Mobile

On a small screen, the sidebar becomes a bottom drawer. Its ribbon exposes Layers and Design, plus
Code when the selected object has an editable source and AI for the mobile chat surface.

## Tips

- Use Layers when overlapping objects are difficult to select directly.
- Press <kbd>⌘</kbd><kbd>K</kbd> on macOS or <kbd>Ctrl</kbd><kbd>K</kbd> elsewhere to search Boards.
- The [context menu](./context-menu) contains actions for the current selection.
- See [Selection & Manipulation](./selection-and-manipulation) for z-order and visibility shortcuts.
