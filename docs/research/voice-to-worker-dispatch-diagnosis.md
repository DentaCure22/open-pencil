# Voice-to-worker dispatch diagnosis

Research snapshot: 2026-08-26. Scope: spoken requests that should become work in
a live OpenPencil Board. This report intentionally excludes ambient-audio and
transcript-privacy behavior except where the handoff changes dispatch.

## Conclusion

The underlying OpenPencil dispatch path is simple and healthy. `dispatch_work`
posts directly to the local Pi router, which claims a warm Board worker when one
is available and returns a running thread receipt. There is no second
dispatcher-model turn in that path.

The part that feels slow is real, but almost all of it happens **before**
OpenPencil receives the dispatch. In the two sampled voice sessions, the local
dispatch itself took about **0.29 s** and **0.66 s**. The live parent did not
start those calls until about **17.7 s** after a compound Board/research request
and **11.1 s** after a simple Mermaid placement; the completed receipts arrived
at about **18.0 s** and **11.7 s**. Most of that time was the live parent
speaking, loading skills, discovering already-known tools, and doing extra
context reads.

Routing correctness was mixed:

- The simple request, “put a mermaid on the board over there,” was sent to one
  new worker with the correct current Dental Chart target.
- The compound request explicitly mentioned reorganizing the current Board and
  “another worker” for Smylr analytics/research, but the live parent initially
  merged both jobs into one worker. It split them only after the user corrected
  it with “Two separate workers.”
- The correction reached the right threads, but the parent invented replacement
  `exact_words` instead of passing the user's actual clause verbatim. That
  violates the handoff contract and can silently change constraints.

So the user is not overthinking the workflow: the Pi launcher is not the
bottleneck, but the voice parent is doing too much before calling it and is not
reliably splitting independent work.

## Actual path

1. `$voice-dispatch` decides whether the request is direct parent work
   (navigation/theme) or Board work. Board work should produce one
   `dispatch_work` call per complete independent thought, with the user's clause
   verbatim plus one resolved intention sentence
   (`/Users/omar/plugins/openpencil/skills/voice-dispatch/SKILL.md:12-29`,
   `:46-66`).
2. `dispatch_work` builds `/skill:openpencil <exact words>` plus the intention,
   marks the request `toolScope: "board-worker"`, and chooses one direct route:
   new dispatch, exact-thread follow-up, or exact-thread fork
   (`packages/mcp/src/tool/dispatch-registration.ts:114-171`).
3. The MCP tool posts to the authenticated local authority and returns the
   authority's job/thread receipt. Its 15-second timeout is transport protection,
   not a second routing stage
   (`packages/mcp/src/tool/dispatch-registration.ts:23-25`, `:295-325`).
4. The authority passes the request straight to `PiAgentRouter` and returns HTTP
   202 after Pi has accepted the turn
   (`packages/mcp/src/agent-router/conversation-actions.ts:175-234`).
5. For new Board work, the router claims a dedicated warm Board-worker process
   when available; otherwise it starts a Board-isolated Pi session. It then
   delivers the prompt and returns `state: "running"`
   (`packages/mcp/src/pi/router.ts:714-759`, `:805-827`, `:928-1001`). The local
   authority defaults to one warm Board worker
   (`packages/mcp/src/local-authority-index.ts:61-86`).
6. Workers receive Board mutation/query tools but not `dispatch_work`, preventing
   recursive worker dispatch
   (`packages/mcp/src/pi/worker-mcp.ts:12-26`,
   `tests/engine/mcp/pi/worker-mcp.test.ts:58-75`). Completion is settled later
   from Pi's `agent_settled` event; the initial receipt proves assignment only
   (`packages/mcp/src/pi/router.ts:1033-1069`).

The worker's `/skill:openpencil` body already contains the first-turn
`board_where`/`workmap_query` and project-space rules
(`/Users/omar/plugins/openpencil/pi-skill/openpencil/SKILL.md:23-103`). The
`boardWorkerPrompt` fallback also contains those rules for unprefixed Board
prompts, but intentionally leaves already-prefixed skill prompts unchanged
(`packages/mcp/src/pi/worker-mcp.ts:64-70`,
`tests/engine/mcp/pi/worker-mcp.test.ts:24-55`). That is duplication, not a
confirmed bootstrap failure.

## What the sampled sessions show

| Voice request | Input to dispatch call | Local dispatch duration | Result |
| --- | ---: | ---: | --- |
| Reorganize current Board; use another worker for Smylr analytics/research | 17.7 s | 0.29 s | Incorrectly combined into one worker first |
| “Two separate workers” correction | 6.3 s | 0.13 s + 0.40 s | Correct existing-thread narrowing plus one new research thread |
| “put a mermaid on the board over there” | 11.1 s | 0.66 s | Correct new worker on Dental Chart |

The compound request arrived at `21:57:30.837Z`; the authority recorded the
first dispatch at `21:57:48.550Z`. Before that call, the parent captured the
Codex screen, loaded the voice skill, searched its tool catalog, and read both
Board presence and the Work Map. The dispatch receipt itself was returned at
`21:57:48.834Z`
(`/Users/omar/.codex/sessions/2026/08/26/rollout-2026-08-26T16-56-56-01a04013-869d-7950-9632-bc20fdfdf006.jsonl:9-44`).

That first call's intention explicitly combined Board reorganization, analytics,
data consolidation, market research, and rollout assumptions. After “Two
separate workers,” the parent correctly continued the first receipt's exact
thread and created a second thread, but it sent synthesized instructions as
`exact_words` rather than the user's literal correction
(`/Users/omar/.codex/sessions/2026/08/26/rollout-2026-08-26T16-56-56-01a04013-869d-7950-9632-bc20fdfdf006.jsonl:53-65`).

The Mermaid Board request arrived at `20:13:19.677Z`; the authority recorded
dispatch at `20:13:30.739Z` and returned the receipt at `20:13:31.392Z`. Here,
`board_where` was justified by “over there,” but loading the unrelated Work Plan
skill and doing a separate tool-catalog discovery were not needed to identify or
dispatch the target
(`/Users/omar/.codex/sessions/2026/08/26/rollout-2026-08-26T15-12-50-01a03fb4-381c-7123-a7ab-d5f17977155d.jsonl:27-53`).

When the user later asked whether that worker was working, the parent used
`list_agent_chats` once and found the exact Mermaid thread completed. That was a
reasonable status lookup prompted by the user; it did not delay the original
dispatch. The answer correctly identified Dental Chart from the earlier
presence read
(`/Users/omar/.codex/sessions/2026/08/26/rollout-2026-08-26T15-12-50-01a03fb4-381c-7123-a7ab-d5f17977155d.jsonl:58-77`).

## Diagnosis

### Confirmed defects

1. **Independent-work splitting is too vague and untested.** The skill says one
   dispatch per independent thought, but gives no explicit rule for “another
   worker,” “separate worker,” or two different deliverables in one spoken turn.
   The compound sample demonstrates the resulting merge.
2. **`exact_words` is not actually preserved.** The tool schema can require a
   string but cannot verify that it is verbatim
   (`packages/mcp/src/tool/dispatch-registration.ts:383-403`). Both the initial
   compound call and its correction rewrote the user's words. The intention
   field should carry normalization; `exact_words` should remain source text.
3. **The realtime parent has avoidable pre-dispatch work.** `capture_screen_context`
   read the Codex task rather than the OpenPencil Board, `workmap_query` added no
   targeting value to the compound request, and the Mermaid turn loaded Work
   Plan even though no prepared Todo/Plan was involved. These steps added model
   round trips while the actual OpenPencil calls stayed subsecond.

### Healthy parts

- The backend uses direct new/continue/fork routes with no LLM routing hop
  (`tests/engine/mcp/live-parent-registration.test.ts:1075-1127`,
  `CHANGELOG.md:879-905`).
- `board_where` is correctly limited to current-location/selection language in
  both the parent skill and tool description
  (`/Users/omar/plugins/openpencil/skills/voice-dispatch/SKILL.md:14-22`,
  `packages/mcp/src/tool/live-parent-registration.ts:249-299`).
- The correction reused the exact receipt thread for `continue`, matching the
  intended continuation contract.
- Warm-worker claiming, Board-worker isolation, direct prompt delivery, resident
  follow-ups, and settlement are covered by focused router tests
  (`tests/engine/mcp/pi/router.test.ts:383-438`, `:1306-1378`).
- The Mermaid status check happened only after the user asked for it; the parent
  did not poll during the original dispatch.

### Unobserved design risk

The 15-second `dispatch_work` timeout explicitly says the assignment may already
exist, but a new dispatch carries no idempotency key. Retrying after an ambiguous
timeout could create a duplicate worker
(`packages/mcp/src/tool/dispatch-registration.ts:23-25`, `:85-96`, `:295-325`).
Neither sampled session hit this path.

## Recommended changes

1. Add an explicit splitting rule to `$voice-dispatch`: when the user says
   “another worker,” “separate workers,” or gives independent deliverables with
   different owners, dispatch one clause per worker before reporting success.
2. Pass the literal spoken work clause unchanged as `exact_words`. Resolve names,
   pronouns, targets, and cleaned wording only in `intention`.
3. Make the critical path: read the already-selected voice skill, call
   `board_where` only for “here/current/selected/over there,” then immediately
   call `dispatch_work`. Do not capture the Codex screen, query the Work Map, load
   Work Plan, or enumerate tools unless the request specifically needs them.
4. Add captured-turn regression tests above the MCP unit layer:
   - one simple “over there” request produces `board_where` then one dispatch;
   - one compound “reorganize this Board; another worker researches X” request
     produces two new dispatch receipts;
   - each `exact_words` value is a literal source clause;
   - no unrelated parent tools run before dispatch;
   - input-to-dispatch latency is reported separately from authority acceptance.
5. Add an idempotency key to new dispatch so a timeout can be retried safely.

## Verification performed

Focused source tests were run against the current checkout:

```text
bun test ./tests/engine/mcp/live-parent-registration.test.ts \
  ./tests/engine/mcp/pi/worker-mcp.test.ts \
  ./tests/engine/mcp/pi/router.test.ts \
  ./tests/engine/mcp/voice-dictation/manager.test.ts

64 passed, 0 failed
```

This proves the current tool contracts and Pi lifecycle fixtures. It does not
prove a full live microphone-to-real-worker run; the two realtime JSONL sessions
are the end-to-end evidence used for that layer.
