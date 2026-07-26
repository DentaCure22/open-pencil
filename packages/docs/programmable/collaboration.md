---
title: Collaboration
description: Fast Yjs collaboration through WebRTC with optional durable OpenPencil Cloud workspaces.
---

# Collaboration

Edit designs together in real time. WebRTC keeps live interaction fast. A configured OpenPencil Cloud project adds accounts, durable database storage, cross-device recovery, and controlled workspace invites.

## Shared Cloud Workspace

When the deployment includes `VITE_OPENPENCIL_SUPABASE_URL` and `VITE_OPENPENCIL_SUPABASE_ANON_KEY`:

1. Create an OpenPencil account or sign in
2. Open the collaboration control
3. Copy the one-time cofounder invite
4. Send it to the person who should join the workspace

The invite expires after seven days and can be accepted once. OpenPencil stores append-only Yjs updates and periodic checkpoints in its own Supabase project. Boards and project folders are part of that shared document, while IndexedDB remains the offline cache.

To deploy a dedicated backend, create a new Supabase project for OpenPencil, run `bunx supabase link --project-ref <project-ref>` followed by `bunx supabase db push`, and set the two environment variables above on the OpenPencil app deployment. Do not reuse another product's Supabase project.

## Account-Free P2P Rooms

1. Click the share button in the top-right corner
2. Copy the generated link (`app.openpencil.dev/share/<room-id>`)
3. Send it to your collaborators

Anyone with the link can join. The room stays active as long as at least one participant has the page open.

## What Syncs

- **Document changes** — every edit (shapes, text, properties, layout) syncs instantly
- **Cursors** — see where each collaborator is pointing, with their name and color
- **Selections** — highlighted selections are visible to everyone

## Follow Mode

Click a collaborator's avatar in the top bar to follow their viewport. Your canvas pans and zooms to match their view. Click again to stop following.

## How It Works

Peers connect directly via WebRTC — your design data goes straight from browser to browser, never through a central server. The document state uses a CRDT (conflict-free replicated data type), so concurrent edits merge automatically without conflicts.

The room persists locally — if you refresh the page, you rejoin with the same state.

## Tips

- Works in the browser and the desktop app
- Room IDs are cryptographically random — only people with the link can join
- Stale cursors are cleaned up automatically when someone disconnects
