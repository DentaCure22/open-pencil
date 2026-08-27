# Memory architecture comparison

Research snapshot: 2026-08-26.

## Executive conclusion

The three systems are not doing the same thing:

- **Codex** has durable chats, per-chat compaction, durable instruction files,
  and a separate automatic cross-session memory pipeline.
- **OpenCode** has durable chats, per-chat compaction, and durable instruction
  files. Stock OpenCode does not automatically learn from one chat and recall
  it in another.
- **OpenPencil/Pi** has durable chats and Pi-owned compaction, plus a custom
  cross-session memory plugin modeled after Codex. At audit time the reader was
  live, but the writer did not follow Codex's database, locking, versioning, or
  retry model.

At audit time, the local Pi implementation was therefore more ambitious than
stock OpenCode, but materially less reliable than native Codex memory.

The most important defect found was ownership: Pi wrote directly into Codex-generated
files under `~/.codex/memories`, while native Codex rebuilds those files from its
own SQLite memory database. Pi's extracted sessions are not inserted into that
database and Pi does not participate in Codex's global consolidation lock. A
later native Codex consolidation can consequently replace Pi's raw entries and
prune Pi-only rollout summaries.

## Follow-up implementation

Later on 2026-08-26, `pi-codex-memory` 0.2.0 repaired the core deviations found
in this audit:

- Pi now owns `~/.pi/agent/memories`; Codex memory is federated read-only, and
  the writer refuses a configuration that points at Codex's generated store.
- Sessions use the full ID plus a SHA-256 conversation version, so a resumed
  chat becomes eligible again when its content changes.
- Extraction jobs persist attempts, retry time, errors, and leases, while one
  expiring filesystem lock coordinates writers across Pi processes.
- Phase 1 writes versioned source records, and Phase 2 receives a bounded batch
  of those exact unconsolidated records instead of the first slice of one large
  shared raw file.
- Search returns exact source paths and line ranges, while only a subsequent
  exact read counts as usage.
- Status distinguishes Pi ownership, read-only Codex federation, pending work,
  versioned records, consolidation retry state, and current errors.

Verification after the change: 35 focused tests passed; direct MCP initialize,
tool discovery, search, and line-addressed read passed under Bun and Node; a
fresh installed Pi process loaded the extension; and the agent-level evaluation
used both `handbook_search` and `handbook_read` and finished 9/9 checks.

This is not full Codex parity. Pi still uses atomic JSON jobs rather than
SQLite, has fewer eligibility and per-chat controls, and does not have Codex's
native structured citation parser. Those are remaining hardening opportunities,
not the former ownership/versioning failure.

## Plain-language model

| Mechanism | What it means |
| --- | --- |
| Saved chat | The full conversation is still on disk and can be resumed. |
| Compaction | An oversized chat is summarized so that same chat can continue. |
| Rules | Stable instructions such as `AGENTS.md` are loaded again for new work. |
| Long-term memory | Useful facts are extracted from older chats and selectively reused in other chats. |

Codex has all four. OpenCode core has the first three. OpenPencil/Pi attempts
all four. At audit time, its long-term-memory write path conflicted with Codex's
ownership of the shared files; the follow-up implementation above separated them.

## Comparison

| Capability | Codex | OpenCode core | OpenPencil/Pi at audit time |
| --- | --- | --- | --- |
| Durable sessions | Persisted threads with resume, fork, read, archive, and pagination | SQLite sessions/messages/parts with resume and export | OpenPencil thread JSON plus native Pi JSONL sessions and resume/fork routing |
| Context compaction | Automatic/manual, inside one thread | Automatic/manual, inside one session | Pi compacts model context; OpenPencil separately trims retained UI history |
| Automatic cross-session memory | Native two-phase extraction and consolidation | None | Custom `pi-codex-memory` plugin |
| Stable rules | `AGENTS.md`, skills, configuration | `AGENTS.md`, configured instructions, skills | Pi/global/project instructions and skills |
| Memory eligibility | Bounded by source, age, idle time, root-session status, per-chat settings, and rate limits | Not applicable | Four messages and 20 minutes idle; no equivalent source/age/rate-limit controls |
| Change detection | Full thread ID plus `source_updated_at`; updated chats can be re-extracted | Not applicable | A shortened session ID is marked extracted forever |
| Job durability | SQLite claims, leases, concurrency caps, retry backoff, and a global Phase 2 lock | Not applicable | In-process timer and promise chain; no persistent lease or retry scheduler |
| Consolidation input | DB-selected top memories, usage ranking, filesystem sync, and a git-style workspace diff | Not applicable | First 12,000 characters of a shared raw file plus up to four overlapping groups |
| Recall | Summary routing plus exact file search/read and memory citations; current source also contains optional line-addressed memory tools | Explicit session resume or manually maintained instructions | Keyword MCP search with excerpts; coarse read tool; no memory citations |
| Usage signal | Cited rollout IDs and recognized memory-file reads update source-level usage | No cross-session memory signal | Every returned search group is counted as used, even if the agent ignores it |
| Operator controls | Global and per-chat use/generate controls; model, retention, idle, rate-limit, and external-context settings | Session/compaction/config controls; plugin choice for memory | Environment variables plus one manual consolidate command; no per-chat memory controls |

## Codex

### Architecture

Official Codex documentation explicitly separates memory from compaction.
After memories are enabled, eligible idle chats are processed in the background
and useful context is stored under `~/.codex/memories`. Active or short-lived
sessions are skipped, generated fields are secret-redacted, and low remaining
rate-limit capacity can postpone generation. Memory use and generation can be
controlled per chat ([Codex Memories](https://developers.openai.com/codex/memories)).

The documented defaults include:

- up to 256 recent raw memories selected for consolidation;
- 30 days as the memory-usage retention window;
- rollouts no older than 30 days;
- at least 6 hours idle before extraction;
- up to 16 rollout candidates per startup;
- at least 25% rate-limit capacity remaining before background generation.

These controls are independently configurable, including extraction and
consolidation models and whether chats with external context may contribute
([Codex configuration reference](https://developers.openai.com/codex/config-reference)).

Current official source was inspected at `openai/codex@07d260c623cf874828f4eff40266dbf08b723944`.
Its `codex-rs/memories/README.md` and implementation show:

1. Phase 1 claims eligible thread versions from SQLite and extracts several in
   parallel.
2. Each job has an ownership lease, retry state, and source-update watermark.
3. Phase 2 takes one global lock, ranks a bounded set of memories by real usage
   and recency, and rebuilds `raw_memories.md` and `rollout_summaries/` from the
   selected database rows.
4. A restricted consolidation agent receives a git-style diff of the memory
   workspace, can inspect the relevant files, and records success or failure in
   the database.
5. Updated chats can be extracted again because identity is paired with the
   source's update time.

The read path injects `memory_summary.md` as a routing index and tells the agent
to search `MEMORY.md`, then open only relevant evidence or skills. When memory
is used, the answer carries structured file/line and rollout citations. The
runtime parses those citations and associates usage with the underlying
rollouts. Relevant source paths are:

- `codex-rs/ext/memories/templates/memories/read_path.md`
- `codex-rs/memories/read/src/citations.rs`
- `codex-rs/memories/read/src/usage.rs`
- `codex-rs/memories/write/src/phase1.rs`
- `codex-rs/memories/write/src/phase2.rs`
- `codex-rs/memories/write/src/storage.rs`
- `codex-rs/state/src/runtime/memories.rs`

Thread persistence and compaction are separate app-server operations: stored
threads can be resumed/forked/read, while `thread/compact/start` compacts one
thread's active context ([Codex app-server](https://developers.openai.com/codex/app-server)).

### Current local Codex snapshot

The installed client is `codex-cli 0.149.0-alpha.4.3`. Memories, generation,
and use are enabled in `~/.codex/config.toml`.

At inspection time, native Codex's read-only SQLite state showed:

- 602 completed Phase 1 jobs;
- 75 Phase 1 errors, mostly oversized source threads exhausting the extraction
  model's context window;
- 372 current Stage 1 outputs;
- 256 selected for the last Phase 2 input set;
- 206 outputs with recorded later use;
- 26 successful Phase 1 jobs on 2026-08-26;
- a last completed Phase 2 pass at 2:49 PM CDT with no stored Phase 2 error.

Codex is not failure-free, but failures are durable, classified, retried within
a budget, and do not masquerade as successful consolidation.

## OpenCode

Research snapshot: 2026-08-26. Source inspected at OpenCode `v1.18.23`, commit
[`c2eacd72afc4a4984564c393e15ab30011057269`](https://github.com/anomalyco/opencode/commit/c2eacd72afc4a4984564c393e15ab30011057269).
Only official OpenCode documentation and the official `anomalyco/opencode`
repository are used below.

### Bottom line

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

### 1. Durable session and chat storage

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

### 2. Context compaction and summarization

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

### 3. `AGENTS.md`, rules, and instruction files

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

### 4. Automatic cross-session long-term memory

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

### 5. Observability and operator tooling

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

## OpenPencil/Pi Project Memory

### What matches Codex

The plugin is not merely chat compaction. It implements a real two-stage
long-term-memory attempt:

1. after a Pi session settles, queue its conversation;
2. have a side model extract a rollout summary and raw memory;
3. have another side-model pass merge raw memories into `MEMORY.md` and
   `memory_summary.md`;
4. inject the compact summary into future Pi prompts;
5. let agents call `handbook_search`, `handbook_read`, and `handbook_status`.

It also asks both extraction prompts to redact secrets, skips sessions with
fewer than four messages, waits 20 minutes after a settled turn, tracks group
search frequency, and has a 30-day unused-group policy. Its 28 focused unit
tests currently pass.

Those are meaningful features. The system is closer to Codex memory than to
OpenCode's core.

### Where it deviates

#### 1. It shares Codex's generated files without sharing Codex's database

Pi's default content root is `~/.codex/memories`, and it directly prepends to
`raw_memories.md`, creates rollout summaries there, and may update `MEMORY.md`
and `memory_summary.md`.

Native Codex treats those as generated artifacts. On Phase 2, it rebuilds the
raw file and rollout-summary directory from the selected rows in
`~/.codex/memories_1.sqlite`, pruning files that are not in that selection.

A current Pi entry for session `ed6725d9-9812-47cd-b08c-` existed at the top of
the shared raw file and had a Pi rollout summary, but there was no matching row
in Codex's `stage1_outputs` table. This proves the two writers do not share an
authority. Native Codex can overwrite that raw entry or prune its summary on a
later sync.

Pi also uses only an in-process promise to serialize its own consolidation. It
does not take Codex's SQLite global Phase 2 lease, so both writers can touch the
same files concurrently.

This is the highest-severity deviation.

Relevant Pi source:

- `/Users/omar/plugins/pi-codex-memory/extensions/store.ts`
- `/Users/omar/plugins/pi-codex-memory/extensions/pipeline.ts`

#### 2. A retained Pi chat is extracted only once

Pi shortens the native session ID to 24 characters and stores it in
`extractedSessionIds`. After any successful extraction or valid no-op, that ID
is permanently skipped.

OpenPencil intentionally resumes long-lived Pi chats. If a user continues one
of those chats tomorrow and makes a new decision, the memory pipeline still
sees the session as "already extracted." Codex instead keys work to the full
thread plus `source_updated_at`, so an updated thread becomes eligible again.

This is probably the largest direct reason new work feels forgotten.

#### 3. Background work is process-bound instead of job-bound

Pi uses an unreferenced timer and one 90-second in-process pipeline. It has no
persistent leases, retry backoff, concurrency claims, input watermark, or
heartbeat. If the worker exits or its side-model request stalls, a
`consolidate started` record may have no completion record.

The current Pi state demonstrates that failure mode:

- five consolidation starts were logged on 2026-08-26;
- one recorded completion;
- one explicit timeout on `xai-auth/grok-composer-2.5-fast`;
- the remaining starts had no terminal completion/error record;
- Pi's own `lastConsolidatedAt` remained 1:02 AM CDT even though native Codex
  later updated the shared store.

`pending extracts: 0` therefore does not mean all extracted Pi knowledge was
successfully merged into the searchable handbook.

#### 4. Consolidation sees a tiny, ambiguous slice

Pi prepends raw text to the shared `raw_memories.md`, but Phase 2 passes only
the first 12,000 characters to the model along with at most four overlapping
groups. It does not track an exact selected input set or provide a diff of
added, updated, and removed evidence.

At inspection time the shared raw file was roughly 1.1 MB because native Codex
materialized its selected memory set there and Pi also prepended its entries.
Pi's consolidation request therefore exposed roughly one percent of the file
and had no stable cursor identifying what had already been consumed.

Codex avoids this ambiguity by selecting records in SQLite, syncing the exact
set, and giving its consolidation agent a workspace diff plus file access.

#### 5. Search can locate the right group but show the wrong evidence

Pi's search score checks whether query tokens occur anywhere inside an entire
task group. Excerpt selection then favors the later window when windows tie.
Large task groups can therefore rank correctly by title while returning an
unrelated passage from much later in the group.

A live query for `Work Map todo in_motion archive` returned the correct Work
Map group first, but its excerpt discussed an unrelated image-vectorization
experiment. The merged result list also included duplicate native and legacy
Pi versions of the same groups.

The follow-up reader cannot repair this cleanly: it can read only the beginning
of the whole summary/handbook/raw file or an already-known rollout filename. It
does not accept a selected group, arbitrary path plus line offset, or a cursor.

By contrast, Codex's shipping prompt uses exact filesystem search/read with
line citations. Its current source also contains optional dedicated tools that
return a path, match line, context line, pagination cursor, and line-addressed
read.

Relevant Pi source:

- `/Users/omar/plugins/pi-codex-memory/extensions/store.ts`
- `/Users/omar/plugins/pi-codex-memory/mcp/server.ts`

#### 6. Pi's "used" metric measures search results, not used memories

Each Pi search increments every native group returned in the result list. It
does not require the agent to open the group, cite it, or use it in the answer.
This makes the count useful as search telemetry but unsafe as evidence that a
memory helped.

The same signal drives Pi's ranking and forgetting policy, so false-positive
search hits can preserve weak groups while useful memories that were accessed
through another path appear unused.

Codex associates usage with actual memory-file reads and structured rollout
citations, then ranks source-level Stage 1 records by that usage.

#### 7. Eligibility and user controls are much thinner

Pi has no native equivalent of Codex's:

- per-chat "use memories" and "generate memories" choices;
- maximum rollout age;
- allowed interactive-session sources;
- root-vs-subagent/ephemeral gating;
- rate-limit threshold;
- optional exclusion of chats that used web/MCP/external context;
- bounded number of candidates per startup;
- persistent retry budget.

Pi does request secret redaction in its prompts, but it lacks Codex's broader
policy and operator surface around what may enter memory.

### Current read-path usage

The reader is genuinely being called. In the 13 Pi session files created on
2026-08-26 before this audit:

- 4 sessions called Project Memory;
- 5 `handbook_search` calls were made;
- 0 `handbook_read` calls were made;
- no worker directly opened a file inside either memory store.

The usage ledger independently showed five distinct retrieval batches that
day. This proves memory is not disabled. It also confirms that current agents
stop at search snippets, making snippet relevance a critical quality boundary.

## Root cause, not symptoms

The primary problem is not prompt wording and not compaction. It is that the Pi
plugin copied Codex's visible Markdown artifacts while omitting the hidden
system that makes those artifacts coherent:

- source-version identity;
- a durable job database;
- leases and retry backoff;
- one global writer lock;
- exact selected inputs;
- diff-based consolidation;
- source-level usage and provenance;
- line-addressed retrieval and citations.

Prompts can encourage more searches, but they cannot fix those ownership and
state-model gaps.

## Recommended direction

### 1. Give Pi its own authoritative store

Do not let Pi automatically mutate Codex-generated `raw_memories.md`,
`rollout_summaries/`, `MEMORY.md`, or `memory_summary.md`.

Use a separate Pi memory root and SQLite database. The read path may federate
Codex and Pi results, but each writer should own its own state, files, lock, and
retention policy. Do not write directly into Codex's internal SQLite schema;
that is not a documented integration contract.

### 2. Version memory inputs by full session ID plus update time

Replace `extractedSessionIds` with rows keyed by the full native Pi session ID
and its latest durable update timestamp/hash. Continuing a retained chat should
enqueue only the changed version.

### 3. Port the durable job model before tuning prompts

Add persisted Phase 1 and Phase 2 job rows, ownership leases, retry budgets,
backoff, a global consolidation lock, and a completion watermark. A process
restart should resume unfinished memory work instead of silently abandoning it.

### 4. Make consolidation evidence-based and bounded

Select a fixed number of Stage 1 records by real usage and recency, materialize
that exact set, and provide an additions/updates/deletions diff to the
consolidator. Preserve provenance so forgetting one source removes only the
claims supported by that source.

### 5. Repair retrieval before increasing retrieval frequency

The memory search response should provide exact path, group/title, line range,
matched terms, and a non-duplicated excerpt. The read tool should accept that
path and line offset directly. Track a memory as used only after a read or
citation, not because it appeared in search results.

### 6. Add user-facing controls and truthful health

Expose per-chat use/generate controls, sensitive/external-context exclusion,
last successful extraction/consolidation, retry/error state, and the count of
unconsolidated records. Status must distinguish Pi's store from native Codex's
store.

## Practical ranking

For automatic cross-session memory today:

1. **Codex** — the strongest and most complete implementation of the three.
2. **OpenPencil/Pi** — real cross-session ambition and a live reader, but an
   unsafe shared-writer boundary and stale-input/job-state defects.
3. **OpenCode core** — no automatic cross-session memory, by design; plugins
   fill that gap.

For simple session continuity, OpenCode is not last: its smaller architecture
is coherent and observable. OpenPencil's saved Pi chats are also a solid layer.
The ranking above applies specifically to automatic memory learned across
different chats.
