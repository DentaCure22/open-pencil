# OpenCode persistence and memory architecture

Research snapshot: 2026-08-26. Source inspected at OpenCode `v1.18.23`, commit
[`c2eacd72afc4a4984564c393e15ab30011057269`](https://github.com/anomalyco/opencode/commit/c2eacd72afc4a4984564c393e15ab30011057269).
Only official OpenCode documentation and the official `anomalyco/opencode`
repository are used below.

## Bottom line

Stock OpenCode has durable chats, automatic/manual context compaction, and
durable instruction files. It does **not** have native automatic long-term
memory that learns from one session and semantically recalls that knowledge in
another.

Its architecture is therefore:

1. save the complete conversation locally;
2. compact one long conversation when it gets too large;
3. reload stable project/user instructions on every model step;
4. resume a previous conversation explicitly when its history is needed.

Automatic cross-session extraction and retrieval are left to plugins or MCP
servers. The official ecosystem page lists
[`opencode-supermemory`](https://opencode.ai/docs/ecosystem) specifically as a
plugin for "persistent memory across sessions," which is separate from the
OpenCode core.

## 1. Durable session and chat storage

OpenCode stores its local state in SQLite. On normal release channels the
database filename is `opencode.db` under OpenCode's data directory; the source
enables WAL mode, foreign keys, and database migrations at startup
([`packages/core/src/database/database.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/core/src/database/database.ts#L22-L57)).

The schema separates:

- `session`: project/workspace/parent links, title, model, agent, cost, token
  totals, archive and compaction timestamps;
- `message`: each user/assistant record;
- `part`: text, reasoning, tool calls/results, attachments, and other pieces of
  a message.

Messages cascade from sessions and parts cascade from messages
([`packages/core/src/session/sql.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/core/src/session/sql.ts#L22-L98)).
The runtime pages the message and part tables back into a chronological chat
([`packages/opencode/src/session/message-v2.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/message-v2.ts#L425-L503)).

This gives durable **chat persistence**, not long-term memory. A user can list,
switch to, export, import, or delete sessions through `/sessions` and the CLI
([TUI docs](https://opencode.ai/docs/tui),
[CLI docs](https://opencode.ai/docs/cli)). Continuing a stored session restores
that session's history. It does not search other sessions for relevant facts.

Storage documentation currently has a small drift: the troubleshooting page
still describes the older per-project `storage/` tree, while the current source
and the documented `opencode db path` command point to the SQLite database.
For current builds, `opencode db path` and the database source are the safer
authority ([troubleshooting](https://opencode.ai/docs/troubleshooting),
[CLI database tools](https://opencode.ai/docs/cli#db)).

## 2. Context compaction and summarization

Compaction is enabled automatically by default when the active context is full,
and can also be triggered with `/compact` or `/summarize`
([configuration](https://opencode.ai/docs/config#compaction),
[TUI command](https://opencode.ai/docs/tui#compact)). The runtime checks the
latest completed assistant turn for overflow and creates a compaction task
inside the same session
([`packages/opencode/src/session/prompt.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/prompt.ts#L1149-L1167)).

The compaction algorithm:

1. finds the older conversation head and a recent tail;
2. asks a dedicated `compaction` agent for a structured summary;
3. folds the previous summary into the new summary on repeated compactions;
4. stores the compaction request and summary as ordinary durable session
   messages;
5. builds future model context from the summary, a bounded recent tail, and new
   messages.

The summary template preserves the objective, important constraints and
decisions, completed/active/blocked work, next moves, and relevant files
([`packages/core/src/session/compaction.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/core/src/session/compaction.ts#L16-L55)).
The shipping compaction path selects a recent tail by a token budget, invokes
the summary agent, and persists the result
([`packages/opencode/src/session/compaction.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/compaction.ts#L115-L269),
[`packages/opencode/src/session/compaction.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/compaction.ts#L319-L556)).

Crucially, compaction changes the **model-visible context**, not the durable
session into a memory index. `filterCompacted` reconstructs the model input as
the compaction checkpoint plus retained recent messages
([`packages/opencode/src/session/message-v2.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/message-v2.ts#L521-L580)).
The older messages remain queryable in SQLite unless the session is explicitly
deleted or reverted.

Optional tool-output pruning is off by default. When enabled, OpenCode marks
older tool results as compacted so model serialization substitutes a small
placeholder; this is also context management, not semantic memory
([`packages/opencode/src/session/compaction.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/compaction.ts#L271-L317),
[`packages/opencode/src/session/compaction.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/compaction.ts#L54-L83)).

## 3. `AGENTS.md`, rules, and instruction files

OpenCode treats instructions as a separate layer from conversation history.
The official rules contract supports:

- project `AGENTS.md`;
- global `~/.config/opencode/AGENTS.md`;
- `CLAUDE.md` fallbacks;
- additional local globs or remote URLs from `instructions` in
  `opencode.json`.

The `/init` command creates or improves `AGENTS.md`, and the documentation
recommends committing project rules to Git
([rules documentation](https://opencode.ai/docs/rules)).

The runtime resolves the global, project, fallback, configured, and remote
instruction sources
([`packages/opencode/src/session/instruction.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/instruction.ts#L55-L169)).
It calls `instruction.system()` during every model step and includes the result
in the system prompt
([`packages/opencode/src/session/prompt.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/prompt.ts#L1252-L1285)).
That makes root/global instructions robust across context compaction because
they are re-read instead of depending on the summary to remember them.

Nested instruction files are lazy. When the read tool opens a file, OpenCode
walks upward for nearby `AGENTS.md`/`CLAUDE.md` files and attaches newly relevant
rules as a system reminder in that read result
([`packages/opencode/src/session/instruction.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/session/instruction.ts#L171-L225),
[`packages/opencode/src/tool/read.ts`](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/opencode/src/tool/read.ts#L300-L365)).

These files can act as **manual durable knowledge**, but they are not automatic
agent memory. The user, team, or agent must deliberately write and maintain
them, and OpenCode does not semantically select individual facts from them.

## 4. Automatic cross-session long-term memory

As of the inspected version, OpenCode core has no automatic pipeline that:

- extracts durable facts, preferences, decisions, or error/fix pairs from
  completed sessions;
- consolidates and de-duplicates those facts;
- searches them semantically or by keyword for a later unrelated session;
- injects the retrieved facts based on the new task.

This is an inference from the current official source and configuration surface:
the core exposes sessions, compaction, instructions, skills, plugins, and MCP,
but no native memory service, memory config, or recall tool. The official
ecosystem page reinforces the boundary by offering persistent cross-session
memory as the separate `opencode-supermemory` plugin
([configuration surface](https://github.com/anomalyco/opencode/blob/c2eacd72afc4a4984564c393e15ab30011057269/packages/core/src/v1/config/config.ts),
[ecosystem](https://opencode.ai/docs/ecosystem)).

Therefore:

- **resume the same session** = durable conversation continuity;
- **compaction** = smaller active context for that session;
- **`AGENTS.md`** = manually maintained, always-loaded instructions;
- **plugin/MCP memory** = optional automatic cross-session recall.

Those are four different mechanisms.

## 5. Observability and operator tooling

OpenCode exposes strong session-level inspection:

- `/details` shows tool execution details;
- `/sessions` lists and switches sessions;
- `/export` exports the current conversation as Markdown;
- `opencode session list --format json` lists stored sessions;
- `opencode export [sessionID]` exports a session as JSON and can sanitize
  sensitive transcript/file data;
- `opencode stats` reports token, tool, model, project, and cost statistics;
- `opencode db path` prints the SQLite location, while `opencode db [query]`
  can inspect it directly;
- `--print-logs`, `--log-level`, and timestamped local logs support runtime
  diagnosis.

These controls are documented in the
[TUI](https://opencode.ai/docs/tui), [CLI](https://opencode.ai/docs/cli), and
[troubleshooting](https://opencode.ai/docs/troubleshooting) pages. They make it
easy to prove that a session exists, inspect its transcript, see tool calls,
and inspect storage. There is no corresponding native "memory recalled this
fact" trace because stock OpenCode has no native cross-session memory layer.

## Comparison implications for OpenPencil Project Memory

OpenCode is less ambitious than OpenPencil's Pi Project Memory but has a cleaner
baseline separation:

| Concern | Stock OpenCode | OpenPencil Pi Project Memory |
| --- | --- | --- |
| Chat persistence | SQLite sessions/messages/parts | Durable Pi/OpenPencil chat/session records |
| Long-chat continuity | Automatic/manual compaction plus recent tail | Session compaction plus local continuation |
| Stable rules | `AGENTS.md` and configured instructions reloaded each model step | Pi skills/system routing instructions |
| Learned cross-session knowledge | None in core | Extracted/consolidated local memory with search/read tools |
| Recall trigger | Resume the session or load a known instruction file | Model decides when to call Project Memory search/read |
| Memory observability | Not applicable; session and DB tools only | MCP status and durable tool-call traces |

The main design lesson is not that OpenCode has a better long-term-memory
engine; it does not have one. Its advantage is that chat persistence,
compaction, and always-on rules do not depend on a probabilistic memory search.
OpenPencil adds a real fourth layer—automatic learned memory—but that layer must
be independently observable and reliable or it will feel "off" even while the
underlying chats and compaction work correctly.
