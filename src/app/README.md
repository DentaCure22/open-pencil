# Application shell

`src/app` owns OpenPencil product workflows and platform adapters. Framework-agnostic editor,
document, and scene behavior belongs in the public workspace packages instead.

## Dependency direction

```text
components and views -> src/app -> @open-pencil/* public exports
                                  -> local workspace authority HTTP routes
```

- Do not import `packages/*/src` or `@open-pencil/mcp` from the application shell.
- Keep provider and worker-process behavior in `packages/mcp`; the app consumes the local authority
  contract.
- Put reusable editor behavior in `packages/core`, graph behavior in `packages/scene-graph`, and Vue
  primitives in `packages/vue`.
- A remote concern gets a focused app module. Do not rebuild catch-all clients that mix unrelated
  routes and types.

## Top-level map

- `editor`, `document`, and the `*-intake` modules coordinate editor and document workflows.
- `shell`, `tabs`, `sidebar-workspace`, and `agent-terminal` own application-shell state.
- `workspace-document`, `collab`, `cloud`, `tauri`, and `browser-bridge` are platform adapters.
- `code-object`, `external-live-surface`, `board-experience`, and `smylr-*` own embedded product
  experiences.
- `ai` is the in-canvas design assistant. `agent-chat` is the Pi-backed task interface. They are
  separate product surfaces.
- `browser-inspector`, `context-comment`, and `narrated-trace` capture and route directed work.

## Pi task interface

`agent-chat` is split by the app concern its callers use:

- `conversations.ts` — task lifecycle, transcript mapping, paging, and follow-ups.
- `approval.ts` — extension approval contracts, presentation parsing, and responses.
- `attachment-transfer.ts` — upload contracts and model-readable attachment context.
- `attachments.ts` — composer limits and browser drag behavior.
- `work-map.ts` — project, placement, and todo state.
- `workspace.ts` — workspace file and terminal access.

Tests mirror these modules under `tests/engine/app/agent` and exercise the public app interface.
