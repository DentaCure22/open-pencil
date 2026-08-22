---
title: Task Chat
description: Pi-backed coding tasks shared by the sidebar and Board cards.
---

# Task Chat

Open the **CHATS** tab in the left sidebar to start or continue a task. OpenPencil launches Pi directly and keeps each task as one conversation with its model, effort, messages, tool activity, and follow-ups.

## How it works

- **New task** starts a fresh Pi conversation.
- **Follow up** continues the selected conversation instead of creating hidden routing work.
- **Board cards** and the CHATS sidebar show the same local-authority threads.
- **Attachments** are uploaded with the prompt and remain part of the task context.
- **Stop** ends the active turn; a completed or failed task can still receive a follow-up when Pi allows it.

There is no dispatcher or alternate backend. The model list comes from Pi's catalog, and connected apps are available through Pi's configured `codex_apps` MCP.

## Activity and timing

Reasoning and tool calls stay in their original order inside the turn that produced them. Active work is expanded; completed activity collapses to a compact summary with the turn's elapsed time. OpenPencil does not invent per-tool durations when the backend did not record them.

## Trace evidence

Trace is separate from chat. Press <kbd>⌘</kbd> + <kbd>⌥</kbd> + <kbd>T</kbd> on macOS or <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd> on Windows and Linux to open the Activity feed and durable history.

The local authority writes the latest gesture's exact Board targets, region, expiry, omissions, and optional PNG path to `~/.openpencil/local-workspace-authority-v1/trace-context.json`. Coding agents can read that bounded file directly for “this” and “these” follow-ups. When historical evidence is explicitly needed, clients can read a bounded slice from `trace-events/*.jsonl`.

## Design automation

Task chat and editor automation are separate surfaces. MCP-compatible clients can discover OpenPencil's current design-tool catalog at runtime over stdio or HTTP. See [MCP Server](./mcp-server).
