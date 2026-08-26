# Changelog

## Unreleased

- Move project Layers and Assets out of the Work Map's left utility strip and
  into the existing T3 right workspace beside Diff. Clicking a project's
  workspace tray now opens its board layers directly; Assets can switch between
  Project and Global scope, and Settings can toggle Activity in the same right
  workspace. The left sidebar now stays focused on the Work Map.
- Adopt Iconly's free Essential Light set as OpenPencil's shared interface icon
  language for navigation, chat, search, settings, files, common actions, and
  feedback, while retaining specialist editor glyphs where the free set has no
  accurate equivalent.
- Keep one thread-safe Gemini Board worker ready in the local authority and
  bind its live Board thread only when claimed. Fresh Board chats now avoid Pi,
  plugin, and Antigravity process startup while preserving the full Board-tool
  surface; the generic worker pool remains bounded separately.
- Replace the flat agent-chat history with a durable Work Map of projects,
  one-level subprojects, live chats, and linked todos. Board workers now place
  their own chats from current Board context, can capture and advance todos from
  Todo through In motion to Finished, and respect manual placement. Legacy Needs
  you and Review items return to In motion so blockers stay in the conversation
  and verified workers can finish the work they complete.
- Polish the Work Map sidebar with a borderless utility strip, a roomier top
  inset, a dedicated zero-width edge hinge for closing the panel, full-width
  spaced shadowless tabs with a soft grey fill and no border on the active
  utility, and an icon-first search control that expands left into the title
  space. Search, new chat, and new project stay ordered together at the right.
  Project highlighting remains hover-only, with a visible placeholder beneath
  an empty active status. Finished and Misc chats rows no longer show trailing
  counts. Task-status icons are smaller with breathing room around their guide
  line, use transparent icon wells, and pair with larger, higher-contrast labels.
  Task-row hover surfaces begin after the guide rail without moving their text,
  so the highlight no longer paints across the hierarchy line.
  The former Global section is now Pinned, with top-level project rows aligned to
  the section instead of visually nested beneath it. Expanded project statuses
  and tasks now use one compact hierarchy step, while child-project icon spacing
  is tuned separately so both child types share the same label column. Opening
  and closing a project now slides its contents smoothly from the directory row,
  with reduced-motion preferences respected.
  Project rows now use a translucent raster workspace tray that changes with the
  workspace's real expanded or collapsed state. Projects, subprojects, and their
  contents now use compact stepped whitespace for hierarchy, with subproject
  icons centered on the same column as their parent's task-status icons. Child
  projects now hide with their collapsed parent and return when it reopens.
  The entire project row now toggles its disclosure, while folder-plus and the
  same simple plus used by Todo hover keep child-project and new-chat creation
  easy to tell apart. Both actions use the same icon size and stroke weight, with
  the directory action kept rightmost.
  The collapsed Finished disclosure stays quiet until its row is hovered or
  keyboard-focused, while the expanded state remains visible.
  Expanded projects begin directly with their task statuses instead of placed
  chat rows or a redundant Tasks heading; unplaced conversations remain
  recoverable under Misc chats. Each task status now reveals five rows at a
  time, while Misc chats starts at fifteen and reveals ten more per step. These
  quiet disclosure labels darken on hover without painting a background box.
  The Work Map title's optical top inset now matches its side insets. Expanded
  search now dismisses when the user clicks elsewhere without stealing focus
  from the clicked control. Existing chat rows now advertise click first with a
  pointer and switch to grabbing only while pressed.
- Make both workspace edges easier to resize: stable, visually transparent 40px
  hit areas keep neighboring Board controls from flickering the resize cursor.
  The left edge now lives directly in the workspace interaction layer instead of
  re-enabling pointer input through disabled splitter ancestors. Each handle now
  owns one captured pointer stream, and a drag-scoped cursor lock prevents the
  canvas or toolbar from replacing the resize cursor mid-drag. The sidebar close
  hinge now stays visually hidden at rest and reveals only its flush chevron on
  hover or keyboard focus, while preserving a generous invisible hit target.
  When collapsed, the old draggable mini-toolbar is replaced by a fixed 28 x 44
  edge tab with a centered reopen icon and no duplicate grip or floating shell.
  The tab now stays pinned to its final midpoint throughout the collapse instead
  of riding the shrinking panel edge and settling into place afterward.
- Keep the bottom editor toolbar inside the free canvas between the Work Map,
  right workspace, and zoom controls. Its chrome now contracts with the
  available space while one continuous horizontal control track remains
  scrollable, so tools and utilities stay reachable without covering either
  side panel.
- Keep historical task failures in the task row and selected header instead of
  repeating them as a large composer card. Composer banners remain reserved for
  actionable connection, retry, and in-progress states, and now sit in their own
  space above the prompt instead of overlapping its top edge.
- Keep the composer command drawer in its own aligned space above the prompt,
  with a complete border and compact padding instead of a tucked-under stacked
  shell.
- Bring T3 Code's surrounding chat workflow into OpenPencil: task rows now expose
  working, connecting, approval, input, completion, stopped, and failure states;
  connection and retry notices attach above the composer in a non-jumping stack;
  `/commands`, `/skill:` and `@files` open a keyboard-navigable command drawer;
  and files can be dropped anywhere on a conversation to attach them.
- Match the agent-chat transcript scrollbar to thread history: a thin light-grey
  pill instead of the thick dark native bar.
- Give agent chats concise persisted titles generated in the background by xAI
  Composer 2.5 Fast. The first prompt remains available immediately as the
  provisional label, existing untitled chats are named when opened, title
  generation uses an isolated tool-free ephemeral session, and a manual rename
  continues to take precedence.
- Replace the imitated agent activity disclosure with an attributed React
  island derived from T3 Code's exact August 19 message workflow: commentary
  and tool runs stay chronological, adjacent tools retain only their newest
  row behind a `+N previous tool calls` control, and the self-ticking working
  row remains at the live bottom without rerendering the transcript each second.
- Attach exact Git workspace changes to the agent turn that produced them. Completed
  responses now show a compact changed-file summary that opens a T3 Code-style,
  resizable right-side diff workspace with stacked files, unified or split views,
  responsive sheet behavior, and source-backed line comments that return to the
  prompt as annotations. A persistent selected-chat header button opens the Diff
  surface and selects the newest available changes without attributing pre-existing
  dirty files to the agent.
- Extend the T3-style right workspace with real Browser, Terminal, and Files
  tabs. Browser keeps URL history and renders local previews, Terminal runs a
  persistent shell in the current workspace, Files browses and reads actual
  workspace files, and the unused Agents launcher entry is removed.
- Keep Board-worker tool definitions stable after MCP startup so Sol can reuse
  its prompt prefix across tool loops, and aggregate every model call in a user
  turn in the cache meter instead of recording only the final call.
- Give chat-history rows slightly more height and separation for easier scanning.
- Keep task-list elapsed time tied to the whole active agent turn instead of
  resetting for each tool or action. Background completions now show a right-side
  unread dot that clears when the chat is opened.
- Simplify the Board Activity panel by removing its explanatory subtitle,
  session-tag badge, and redundant Trace Activity summary band. Replace the
  heavy purple rail, dots, and boxed timeline cards with a calmer compact event
  log that keeps evidence and details available.
- Preserve unsent agent-chat text, annotations, and file attachments per new
  task or existing thread, so leaving a composer or refreshing OpenPencil no
  longer loses the draft; explicitly starting a fresh task still clears it.
- Keep the source image attached to the visible agent-chat turn when image
  annotations are sent from the composer, instead of showing only the numbered
  edit instructions while the image is hidden in worker evidence.
- Expose the canonical Codex image tools directly to every Board worker and
  match their request timeout to the media job lifecycle, so proxy providers do
  not fall back to workspace-bound native image tools or abandon valid jobs at
  60 seconds.
- Treat typed `create_image` and `create_code_object` bounds as page coordinates
  by default, converting them for nested parents so generated media lands at the
  requested absolute Board position.
- Recognize image generation nested through the Antigravity MCP bridge, so
  agent chats show the live generating state and completed image preview
  instead of a generic MCP activity row.
- Keep repeated image-edit retries from flooding agent chats with near-identical
  full-size previews. The latest completed edit stays prominent, earlier edits
  remain available behind one compact disclosure, and distinct generated
  variants remain visible.
- Keep completed Markdown blocks inert while an agent response streams, poll
  only the changing transcript tail instead of the full chat every 80 ms, and
  pause the heavyweight task-list poll while a retained chat is live. Match T3
  Code's transcript model by keeping one compact live-work row visible, folding
  earlier activity, and maintaining the live edge instantly instead of making
  the viewport chase each resize with a spring. Long answers no longer become
  progressively choppier or randomly jump as the transcript grows.
- Let Board workers import completed local PNG, JPEG, WebP, and GIF outputs
  directly as source-backed native images through `board_apply.create_image`,
  avoiding base64 conversion, oversized Code Objects, and vector stand-ins.
- Start Board workers in a dedicated neutral runtime directory while preserving
  Pi's normal context-file and global skill loading, so repository instructions
  are not inherited merely because the OpenPencil authority runs from its source
  checkout.
- Keep Board workers aware of resident chats without letting ambiguous follow-ups
  import them. Chat listings mark the active thread, preserve its substantive
  task, and omit answer previews; cross-chat reads require a concrete match and
  are blocked when “continue” or another bare follow-up refers to the active
  chat.
- Keep each agent run as one Codex-style chronological work stream: the
  “Worked for” disclosure now owns its commentary, reasoning, and compact
  adjacent tool rows instead of sorting those events into separate buckets.
  New provider thinking starts a fresh boundary and closes the tools above it;
  OpenAI commentary remains the user-visible preamble lane.
- Render Markdown inside OpenAI and Antigravity commentary and reasoning rows,
  so emphasis, links, lists, and inline code no longer appear as literal source
  markers in the work stream.
- Replace separate worker Board discovery and hydration tools with progressive
  `board_query`, and expose bounded read-only `trace_query` eagerly for exact
  history or referent lookup without making Trace the source of current Board
  state.
- Make Inspect Chrome annotation-first: every element click opens an optional
  inline comment pill, durable handles reopen without duplicating selections,
  and comments save on Enter or click-away. The pill reuses compact icon controls
  for dictation, motion recording, and revisit-only deletion, all with tooltips;
  deleting a handle removes that selection. The editable field remains a real
  text input even on pages with global keyboard shortcuts, and the aligned
  numbered handle matches the image-annotation message bubble. Its generated,
  vectorized marker, mic, recording, and delete artwork is embedded as
  self-contained SVG image data instead of relying on page-visible extension
  URLs or page-sensitive CSS masks. Each numbered handle also appears as soon
  as its sequence is reserved while capture and delivery finish in the
  background. Record motion starts after
  clearing inspector chrome, a temporary Escape hint replaces the persistent
  top toolbar, and Escape finishes the whole session.
- Make Inspect Chrome selection work across embedded-document boundaries: iframe,
  frame, embed, and object shells now receive explicit selection shields, while
  controls in open shadow roots resolve from the composed event path. Motion
  recording also falls back to a bounded visible-frame WebM when Chrome rejects
  `tabCapture` because the session originated in OpenPencil rather than an
  extension-toolbar gesture.
- Give every Inspect Chrome capture a stable `Annotation #N` reference in the
  agent prompt, including single-selection drags, so typed and voice-dispatched
  instructions can address captures by number. Live and captured highlights now
  use dashed borders without an interior tint.
- Expand attached Inspect Chrome sessions to the full five-file chat budget
  instead of silently stopping at two screenshots. Screenshot notes are now
  counted in the composer and baked into the submitted evidence as numbered
  markers with a readable comment legend.
- Record Inspect Chrome as a first-class durable Trace session instead of a
  browser-only attachment list. Chrome, Board, and voice activity now retain
  structured source episodes; Escape closes the Chrome episode and its owned
  Trace session, while annotation deletion removes that selection from agent
  context without erasing the audit record. Every session gets a short editable
  tag such as `#patient-flow`, and `trace_query` can resolve that tag exactly
  across Boards and chats.
- Keep the Codex OpenPencil parent to presence, navigation, theme, and worker
  routing tools. Board discovery, reads, screenshots, and mutations remain on
  the Pi worker surface.
- Keep healthy follow-ups in the same native Pi thread. When a failed or stopped
  turn receives a bare “continue,” retain the visible chat but replace the
  broken native session with one seeded only from that chat's saved transcript
  tail and images. Dev-authority restarts now terminate the previous authority
  and its Pi children before a replacement takes ownership.
- Make Board proof boundaries machine-readable: atomic apply receipts identify
  saved/static verification, while screenshots identify live composed capture
  or persisted fallback. Visible Code Object UI is included without moving the
  camera; a still image still does not prove interaction behavior.
- Stop asking Board and sidebar Pi chats to narrate progress every few steps.
  The launch no longer appends that extra system line.
- Board image and video makers stay named-only: Codex for a generic picture,
  Grok or Gemini/Nano Banana only when you name that provider, Grok video only
  when you name Grok. Gemini/Veo video is not wired.
- Board CLI and chat tools no longer offer create, build, or change. The
  remaining Board commands are where, go, and theme. Add and edit by changing
  Board files.
- File Board chat notes into the same Codex notebook both harnesses already
  read, instead of a second Pi-only folder.
- Keep a working chat from jumping while it streams: the live reply stays put
  when a tool starts, tool rows do not slide in, and older turns keep their
  height so the transcript does not snap.
- Match T3 Code's work hierarchy while a turn runs: a stable, independently
  ticking “Working for” header sits above one smoothly updating activity row;
  “Thinking” appears only as the fallback when no specific activity exists.
- Ease live chat text in instead of dropping whole chunks. The reply,
  commentary, and thought lines catch up smoothly, then settle at once when
  the turn finishes.
- Stream the open chat while it is working, and keep the last full transcript
  when you leave and come back so messages do not pop in.
- Keep the model’s live commentary visible while it works. Private thinking
  stays in the Thought fold, not in the reply.
- Show one visible answer per chat turn. Earlier “I’m checking…” text stays in
  the thought lane. A real answer is no longer hidden just because the same
  turn also has thoughts or tools.
- Keep a quiet per-turn cache and token ledger for live Pi/CHATS turns, plus a
  headless probe that can roll up and check the same records. Settings now
  opens a Cache sidebar view with the same rollup in the web and desktop apps.
  The context chip still shows only the latest turn.
- Drop the built-in Grok API mailbox from Board chats. Grok subscription
  login (`xai-auth`) is the only xAI door. Old `xai/…` picks remap there.
  Connected apps are no longer pinned onto every letter; the cook searches
  plugins, same idea as Codex. Chrome helper, the old memory dump, Grok’s
  extra file-hands, Grok search/image bridges, and the Gemini Ask helper
  are off the default letter. Grok extras and `/xai-tools` are gone from
  the login door. X search is a plugin. Handbook search is a plugin.
  Login doors stay as packages. The Pi Chrome Connector is a search-only
  plugin, not a package dump. Chat tool labels now match across cooks:
  looking up an app, reading mail, and sending a text use the same words
  whether the ticket came from Grok or Cursor. Grok video is a search-only
  plugin again. Old memory-search tickets stay off the activity lane. When a
  login tags `final_answer`, that text is the visible close for Grok, Cursor,
  Codex, and Gemini.
- Stop the composer attach menu from flickering on hover. Sessions opens as a
  side column in the same panel instead of a second floating menu, so moving
  onto a session no longer closes it. The surface is solid so the Board grid
  does not flash through.
- Show Antigravity thoughts, tool inputs, and tool results in the chat
  activity lane. Gemini leftover thinking stays visible as commentary, a
  later `[agy input]` / `[agy output]` fills the same tool, and offloaded
  “saved to file” dumps are inlined into the Result panel.
- Send OpenPencil Pi chats to the named connected-app plugin first. Calendar,
  mail, Drive, QuickBooks, and Linear now search `mcp` before Chrome, memory,
  or the Mac desktop. Routing lives in the Pi agent notes once; the chat
  launch prompt only asks for short progress updates.
- Make hover chrome on Board chat cards and other Code Objects instant. The
  outline is CSS on the card instead of a CanvasKit stroke that flickered
  against the DOM hit target and redrew the overlay canvas on every pass.
  Hover no longer adds a second card identity or pointer listeners on the
  hit target. Dragging a chat from CHATS onto the Board moves only the small
  widget with the pointer. While you drag, the Board does not hover, hit-test,
  or redraw under the chip. The chat appears when you let go. New task, the
  thread list, and the name header all use that path.
- Replace the Pi memory dump with a Codex-shaped handbook: next turns get
  the short index, not 16k of daily notes. A quiet Board chat is extracted
  after about 20 minutes, then the Pi worker is unloaded and the next
  message resumes from disk.
- Show a black “Thought for” label at the top of every agent turn. Thought
  text stays unboxed above the tools.
- Keep the sidebar chat from jumping when the model or attach menu opens, or
  when a new chat starts. Focus no longer scrolls the sidebar chrome.
- Stop Board chat cards from leaving a grey plate at the old spot while
  they move. The move preview now punches a hole through the scene instead
  of painting a solid page-colored rectangle over the grid.
- Compact-fork a chat from its stored tail instead of copying the parent
  Pi session. The task menu Compact-fork opens an idle lighter chat and
  does not send a continue prompt. Fork keeps the native Pi history. A
  later follow-up can attach the stored tail. `dispatch_work` action
  `fork` still sends the spoken ask. Pass `historyScope: "full"` for the
  native session copy.
- After Pi auto-compaction, mark the context meter stalled when the window
  is still about 80% full or stored history is still huge. That points at
  compact-fork instead of another summarizer. Older stored tool I/O now
  keeps a head-and-tail replay buffer.
- Bound leftover tool dumps in open chats: page copies and loaded Vue
  transcripts keep the start and end of fat command output instead of the
  whole dump.
- Virtualize long open agent transcripts so only the visible turns plus a
  small overscan stay mounted. Chapter-rail jumps remount a loaded turn
  without refetching, and the live turn stays painted while it streams.
- Stream the live assistant and commentary tail at a continuous frame-paced
  cadence with a short glyph fade instead of burst-pause token dumps. Completed
  Markdown blocks stay inert while only the changing tail is repainted.
- Keep ordinary Pi chats on the user's MCP catalog, but launch Board-dispatched
  workers with a generated, fail-closed catalog containing only OpenPencil
  `board_where` and `board_screenshot`. Explicit user MCP config is filtered too,
  so connected apps and live-parent controls cannot leak into Board workers.
- Open long agent chats on a recent tail instead of the full transcript.
  Older turns load on scroll, the Earlier messages control, or a chapter-rail
  jump. Live polls fetch only new messages. History now writes each thread
  body separately so one update does not rewrite every chat, and each page
  stays under a 256 KB byte budget instead of an uncapped item count.
- Pi chats no longer keep a second copy of the same wrap-up or commentary when
  session history replays a different id.
- Title image-only chats as Screenshot or Image in the CHATS list instead of
  the raw capture filename.
- Assistant markdown now styles real paragraphs and renders tables, images, and task lists.
- Default OpenPencil MCP to tool search: the advertised catalog stays a
  small Board-read set plus `search_tools` and `invoke_tool`, so agents load
  schemas on demand instead of receiving every design tool each turn. Set
  `OPENPENCIL_MCP_TOOL_SEARCH=0` when a client needs the full named list.
- Keep the 64 KB model-facing MCP result cap, and bound stored Pi thread
  memory by clipping old tool output and writing compact history JSON after
  native compaction.
- Keep large Boards from locking up on save, hover, and chat: stringify
  `workspace.json` once per commit, skip mermaid compilation when none is
  present, keep fill-only paints from wiping positions, skip empty overlay
  work, and stop deep-watching idle chat transcripts.
- Keep pan, drag, and save off the slow path: skip isolation layers unless a
  parent or child actually needs compositing, keep move-only edits from
  wiping cached pictures, persist only after graph changes, and move the
  canvas grid plus Code Object chrome onto cached styles and CSS variables.
- Keep Board chats and Code Objects visible when the local workspace service
  restarts: reuse the published auth token, do not save over the Board just
  because it was restored, and show that chats are unavailable instead of an
  empty list.
- Stop Code Object cards from crashing the Board overlay: live-runtime
  residency no longer rewrites its own input set on every Vue tick.
- Fill the agent composer stop control as a solid rounded square so it no
  longer reads as a hollow Lucide outline.
- Start new Pi agent sessions from a warm process pool so the first prompt
  does not wait on a cold `pi --mode rpc` boot. Empty-session history and
  matching model/thinking RPCs are skipped, and the pool refills in the
  background for the next chat.
- Keep page-level card drags from redrawing the whole Board: reuse a scene
  picture with holes for the moving frames, then paint only those frames live.
- Keep nested card drags on the same preview path: punch holes for any moving
  object on the page, then paint only the topmost movers live.
- Cut save, open, and idle hitch on packed Boards: reuse complete persisted
  nodes instead of allocating a default blob for every record, skip overlay
  list walks on move-only edits, index `workspace.jsonl` without hydrating the
  whole graph, patch that index on move-only saves instead of walking every
  node, return the save receipt before writing the 21 MB history snapshot,
  keep the editor moving after an authority save instead of waiting on the
  browser cache, skip mermaid scans when the Board says none are present,
  walk overlay frames without allocating child arrays, paint chat-card chrome
  before mounting conversation surfaces, paint only the latest chat turns
  before a card’s viewport is measured, hydrate open transcripts two at a
  time on idle instead of all at once, keep Board chat cards on preview
  text until click or idle, skip the chapter rail until a card is active,
  skip resending unchanged Board images on later saves, skip unchanged pages
  on later Board saves, return a save receipt before writing the 22 MB Board
  file, warm the workspace index from disk so the first save after a restart
  can patch, skip mermaid compile when diagram sources did not change, keep
  the profiler from treating
  idle page hops as multi-second frames, paint the visible Patients viewport
  first instead of recording the whole scene cache on the opening frame,
  reuse the painted scene cache while dragging instead of recording the rest
  of the page again, and reuse descendant visual bounds while panning.
- Keep hover, overlay, and save cheaper on packed Boards: reuse inverse world
  matrices for hit-testing, cache Code Object descriptors across overlay ticks,
  skip overlay rescans on tool changes, and rebuild the workspace index only
  when the Board revision actually changes.
- Keep packed Boards lighter without parking cards: chat and Code Object
  surfaces stay painted, off-screen work is skipped with `content-visibility`,
  and only extra JS updates stay capped. Group-drag now moves every selected
  card live. `workspace.json` still saves compact JSON instead of pretty-printed
  28 MB snapshots.
- Keep text-heavy boards responsive while panning by reusing CanvasKit paragraph
  layouts across frames instead of rebuilding and deleting them on every paint.
- Keep agent tool activity closer to Cursor: group reads, searches, and commands,
  leave the current group open while it runs, and collapse that group when the
  next thought arrives. Finished turns summarize as “Explored 8 files, 2
  searches” instead of a generic activity dump.
- Stop agent chats from flickering while a turn is running. Open transcripts keep
  their mounted messages across preview polls, streamed commentary is not
  replaced by the answer, and a still-running task stays in the working state
  instead of flipping back to ready.
- Capture each enabled Pi model's wrap-up the way that provider actually writes
  it: last plain text for Cursor and xAI, Codex `final_answer` when present, and
  only the last text block for Antigravity's concatenated stops. Cursor streamed
  closes stay in the same bubble even when that row still has commentary parts; a
  close already on the thread still completes the turn, and a commentary-tagged
  wrap-up is shown as a chat bubble instead of “No final response.”
  Cursor and other slow first-token models no longer fail the turn when Pi
  takes longer than 15 seconds to acknowledge `prompt` or `steer`; the chat
  stays running until the wrap-up arrives.
- Start each new sidebar task with an empty composer and transcript instead of
  carrying over the previous prompt, image, or optimistic `new-task` turn.
- Show Codex-style agent progress as plain inline commentary alongside tool
  activity, without a `Thought` icon or nested disclosure. OpenAI commentary
  phases and Gemini's natural pre-tool updates stay visible, while raw reasoning
  summaries and Gemini's structured tool envelopes remain out of the transcript.
  New workers are prompted to report meaningful milestones instead of narrating
  every inspection or tool call, and legacy provider-thought rows are removed
  during history hydration.
- Remove the global floating toast pop-ups, including repeated refresh and
  Chrome capture notices that covered the Board.
- Keep agent transcripts mounted and pinned to their latest message through
  refresh hydration and rapid tool-activity updates without visible scroll jumps
  or flicker while the agent is working. The transcript viewport now uses stable
  stick-to-bottom refs instead of rebinding observers and snapping scroll on
  every working-tick render, and annotation geometry stays idle until there is
  something to measure. An open sidebar chat now keeps its selected thread across
  panel remounts and incomplete history polls, so the Chats view no longer jumps
  back to the list or another task mid-turn.
- Add a Codex-style user-message chapter rail to shared sidebar and Board agent
  conversations. Four or more prompts gain scroll-synced markers, neighbor
  expansion on hover, prompt/response preview cards, click-to-jump highlighting,
  keyboard access, and drag scrubbing through long transcripts. Transcript text
  and the prompt bar now share one centered inset in both sidebar and Board chat
  surfaces while the chapter rail remains pinned to the wall. Narrow sidebar
  chats use a compact 32 px inset while wider Board chat objects retain 44 px.
  The chapter rail sits slightly below the transcript midpoint so it feels
  centered against the full chat surface, including the composer.
  Text-selection actions now close when the user clicks outside the agent chat,
  while clicks on the selection card itself remain interactive. Copy now works
  across multiple transcript messages through both the selection card and the
  native copy shortcut, while annotation creation stays scoped to one message.
  Composer annotation chips use a flat white bordered treatment in light mode
  instead of blending into the gray composer.
  The desktop sidebar now opens at 27% of the workspace and can stretch to 30%
  when more reading room is useful.
- Show Pi tool approvals inside the active task instead of auto-declining them.
  Messages sends now preview the recipient above one or more exact,
  right-aligned blue outgoing bubbles, with quiet Cancel and Send text actions
  beneath the outgoing text. Sending, Sent, Cancelled,
  and Not sent sit quietly beneath the outgoing text instead of competing with
  it. These states reuse that inline anatomy in both themes, and sends remain
  blocked until the user chooses Send.
  Approval previews now stay attached to their originating chat turn. A newer
  follow-up or steering message cancels any untouched Messages approval, removes
  its actions, and leaves the settled preview in transcript history.
  Wrapped Antigravity results settle the inline state instead of leaving it on
  Sending. The Messages bridge now accepts an explicit ordered `texts` sequence
  for separate bubbles while preserving newlines inside a single bubble.
- Let Pi model scopes pin a supported reasoning level per provider/model, keeping
  OpenPencil's live model catalog aligned with the curated Pi configuration.
- Replace the bulky agent composer context fill with a slim, bounded circular
  gauge, and keep its throughput readout visible. Provider output uses measured `t/s`;
  Gemini/Antigravity turns upgrade their live estimate from local generation
  metadata when available, while missing defensible timing stays unavailable.
- Restyle the Trace evidence buffer with OpenPencil's semantic chrome, surface,
  accent, and status tokens so its menu stays legible and polished in both light
  and dark themes. Trace rows now replace the persistent `Details` label with a
  hover disclosure chevron that turns downward when its metadata and screenshot
  are expanded. Focus and Ink evidence now uses OpenPencil's local CanvasKit,
  DOM, image, and video compositor without requesting browser screen sharing.
  Live cross-origin iframe pixels remain explicitly unavailable.
- Add one **Inspect Chrome** action to the vertical Editor tools rail. Its unpacked
  extension runs a persistent multi-select session with animated DOM boundaries,
  numbered retained selections, surrounding-context screenshots, optional pinned
  annotations, and bounded motion recording. Sessions stay in a side-by-side,
  horizontally scrollable basket at the top of every sidebar tab, record into
  Trace, and can be dragged into sidebar or Board agent chats without sending.
  One armed session now persists across tabs the user visits, keeps globally
  ordered selection numbers, and never changes the active Chrome tab itself.
  Session children now stay collapsed until their parent is opened in an anchored
  dropdown, and screenshot comments reuse the Board's floating pill editor so a
  numbered pin can be reopened and revised directly on the image. The same picker
  can now select OpenPencil's own UI and canvas while leaving its session and
  annotation controls interactive. Session headers stay white, omit the redundant
  disclosure arrow, reveal removal only on hover or focus, and no longer add a
  separator beneath the capture basket. Their dropdown uses a compact four-pixel
  shell inset and tighter, shorter child rows.
  Selection children use the complete row to
  open annotation, remove the old separator rules, use a soft rounded hover and
  focus highlight with optically even content insets, and reveal only their
  remove action on hover or keyboard focus. The light annotation review now blends its
  header and screenshot stage into one continuous white surface without a hard
  divider seam. Its header now uses a deterministic compact display title,
  removes the redundant instruction line, and reveals the close action only on
  header hover or keyboard focus.
- Let a Chrome selector capture be dragged onto the Board as one persisted
  external live-surface Code Object. The selector now keeps a clean element-only
  crop separate from its annotated agent context. On macOS desktop, an embedded
  ScreenCaptureKit helper reconnects the exact window-relative source region at
  30 fps using Retina-aware, latest-frame transport. The browser build uses the
  Chrome extension's tab-capture stream to keep that selected region live without
  copying or restyling its DOM. Existing Code Object Design/Interact behavior owns
  Board transforms, while Interact relays bounded pointer, wheel, key, and text
  input back through the Chrome extension. The native transport follows Attune's
  capture mechanics without importing Attune's destination UI or DOM-twin styling.
- Make photo and video drag-and-drop reliable across the full Board surface,
  including over native media and other overlay-backed objects. Dropped photos
  become native image rectangles, while videos become movable, source-backed
  playback frames that retain their original bytes.
- Let agent-chat composers accept files, images, and videos through the picker,
  paste, or drag and drop. Attachments now share the compact annotation-chip
  treatment, support attachment-only prompts, and keep large plain-text pastes in
  a removable `Pasted text` chip above annotations and media instead of clipping
  the composer. Shorter text remains editable in a bounded scrolling input. Allow
  local video files up to 100 MB each within a 250 MB batch. Local videos are
  sampled into a compact timeline filmstrip and sent to the agent as actual vision
  input while keeping the original clip available for denser, timestamp-specific
  inspection. Sending now transfers the draft out of the composer immediately,
  keeps image previews and file or video cards above and outside the sent text
  bubble, and preserves those attachments when the authoritative conversation
  replaces the optimistic preview. Image drafts now show their actual thumbnail
  in the prompt bar, Chrome capture drafts reuse that same snapshot chip, and
  images can open the same annotation editor before send or directly from the
  conversation transcript.
- Let user prompts and assistant responses share the same one-click copy affordance
  beneath the message alongside its local timestamp. The copy action stays quiet
  with the timestamp until message hover or keyboard focus and gives
  prompt-specific accessible feedback after copying.
- Add a shared task context menu to sidebar rows, open sidebar conversations, and
  Board agent-chat headers. Tasks can be pinned, renamed, marked unread, archived
  and restored, shared through the system sheet, or copied as a complete hydrated
  transcript, latest response, or stable task ID.
- Keep the selected interaction highlight flush against Code Object edges instead
  of leaving a visible gap between the object and its outline.
- Replace the hard divider beneath Board and sidebar conversation headers with a
  soft scroll-edge fade so transcript content visually recedes beneath the title
  bar.
- Move Board and sidebar agent transcripts to the latest message whenever the
  user submits or retries a prompt, even after they have scrolled up in history.
- Increase the floating sidebar surface opacity slightly so canvas content no
  longer competes with the chat transcript while the chrome remains translucent.
- Let the Next.js client inside each embedded Smylr iframe exclusively own Fast
  Refresh. OpenPencil no longer opens a competing private HMR socket or polls the
  dev server, so agent edits update the resident frame instead of remounting it.
- Preserve stable Code Object roots, iframe DOM runtimes, Board selection, and the
  active viewport while local-authority edits or OpenPencil HMR update the Board.
  Explicit iframe refreshes now target only the selected frame.
- Forward the configured Smylr project root from Vite's local environment into
  the local authority so the selected-frame play button can find its allowlisted
  launcher instead of reporting `Launcher not configured`.
- Make Pi conversations lighter and more resilient. Generated images now live
  outside the conversation JSON and streaming updates are saved in small
  batches. Every new conversation receives its own unbounded worker identity,
  durable Pi session entries repair missed tool and final-answer events, Board
  evidence is sent to Pi as an actual image, and a liveness watchdog releases a
  stuck process while preserving its resumable session.
- Add a screenshot-first Board comment tool. Drag over any Board region, place
  multiple numbered comments directly on the captured image, revise or resize
  the crop, add optional overall instructions, and send the image with
  normalized image coordinates, absolute Board-space points, and crop/viewport
  geometry through the existing contextual worker route. OpenPencil now composes
  the visible Board directly instead of recording its browser tab, so repeated
  captures require no chooser and leave no persistent sharing strip. Crops that
  include live cross-origin iframes are rejected rather than attaching blank or
  misleading pixels.
  Each numbered pin now records its durable Board/object target plus
  modality-specific context: image coordinates, captured video or audio time,
  document page or slide, Code Object and semantic DOM identity, live-element
  identity, diagram identity, agent conversation, or an explicitly projected-only
  3D point. The compact target chip shows what the agent will receive.
- Show image generation as a first-class agent-chat card with a grainy live
  loading state, image-specific progress, an intrinsically sized completed MCP
  preview, and a transparent checkerboard with enough inset to keep rounded cards
  from clipping image pixels. Generated images open in the same numbered-comment
  editor as Board screenshots; image evidence keeps its alpha channel and is sent
  back to the exact task as a steer or follow-up for editing. Transparent sources
  add an explicit no-flattening constraint to the edit prompt. Durable results
  recover even when rendering finishes after an interrupted turn. Safe Antigravity
  tool markers now remain live until their next step or terminal update instead of
  appearing completed immediately.
- Show Grok video generation in the same first-class agent-chat flow: a single
  grainy `Creating video` card replaces duplicate thought/tool rows, completed
  clips render directly below the turn with native playback and a larger viewer,
  and interrupted durable jobs recover their actual video without embedding large
  media payloads in conversation JSON. A shared Vue video player now powers both
  chat clips and native Board video evidence, while `VideoPlayer` and the registered
  `video-player` block expose the same primitive to Code Objects.
- Turn selected agent transcript text into anchored annotations without copying
  it into the draft. Sidebar and Board chats keep compact numbered markers,
  reopenable comments, optional speech dictation, retry state, per-annotation
  deletion from the editor, and one-step clear-all from the composer before the
  quoted context is dispatched.
- Make agent chat text natively selectable and offer a compact selection action
  for copying or quoting an excerpt into the current composer. The shared model
  picker now shows live provider subscription capacity when Pi exposes it, and
  the context meter keeps a transparent center on every chat surface. TPS now
  divides provider-reported output tokens by the measured first-token-to-stream-end
  interval instead of estimating tokens from characters or including time to first token.
- Simplify Board work to files and ordinary coding-agent tools. `workspace.json`
  remains canonical; the authority emits a disposable, revisioned
  `workspace.index.jsonl` for `rg` discovery. Trace now uses append-only rotated
  JSONL, a bounded `trace-context.json`, and separate PNG evidence instead of
  SQLite. The live parent launches, continues, or forks a Pi worker directly,
  with no LLM dispatcher turn, and the plugin now has only live-parent and worker roles.
  The parent can read six high-signal previews of resident Pi chats, optionally
  inspect one bounded human-facing transcript when routing is ambiguous, then
  continue a matching chat, steer it when it is still running, fork its native
  context for independent work, or start clean. Tool output, reasoning, session
  data, transcript copying, and a separate dispatcher registry stay out of the
  routing context. Inventory reads now distinguish currently running chats from
  completed chats that remain resumable, avoid duplicate generic searches, and
  never imply that resident chats are visibly placed on the current Board.
  Board workers keep normal provider, file, and machine tools. Their MCP surface
  contains only read-only `board_where` and `board_screenshot` from OpenPencil;
  connected apps, dispatch, navigation, and theme remain outside the worker.
  Saved-scene screenshots
  are bounded to exact object IDs and stay inside the expandable tool result
  that produced them. They load the short file skill explicitly for
  Board work, and presence includes a bounded current selection for targeting.
- Bound Trace screenshot evidence to the newest 100 unique captures or 250 MB,
  whichever comes first. Identical images share storage; agent-task evidence is
  pinned until its conversation is removed, and evicted PNGs leave their Trace
  events intact with an explicit `evicted` evidence status. The Activity panel
  now shows live buffer usage, pins, evictions, and deduplication in a compact
  evidence dropdown, with cleaner rows that surface each image's state.
- Page older Trace activity through one bounded cursor request instead of replaying
  the full store once per session. The Activity panel can move between earlier,
  newer, and latest 80-event windows, lazily loads visible screenshots, and
  preserves context-draft rows so saved and legacy sessions remain reviewable.
- Make the local authority the only durable Board command engine. The optional
  browser bridge is now limited to live presentation, selection, export, file,
  theme, and primitive-tool operations; Board open writes one authority navigation
  intent instead of choosing between direct browser, HTTP, and persisted paths.
- Clean up agent conversations to match the Codex task model: CHATS is one quiet
  task list that opens into one conversation, routing and worker-pool internals stay
  out of the UI, Board cards use normal thread titles instead of numbered worker names,
  and live reasoning/tools share one
  chronological disclosure that stays open after the run finishes unless the user
  collapses it. Completed steps now
  use compact action-specific icons, no timeline rail or nested indentation, hover-only
  right/down disclosure arrows, and smoothly expanding tool and thought details. Consecutive
  tool calls collapse into one Codex-style action summary between thought traces. Only the
  current step stays live, Pi tool inputs and results survive completion, and the
  elapsed-time divider sits at the end of the activity
  using the whole turn. The shared composer is a compact rounded rectangle instead of
  a row of oversized chrome circles. Accepted follow-ups now clear immediately while
  the same composer exposes Stop until the run finishes. Board cards keep the normal
  complete chat visible in both design and interaction modes. Sidebar threads can be
  dragged onto the Board to place or reposition that exact conversation, and the New task
  control can be dragged out to place a fresh chat composer. The composer keeps the context
  meter, visible model name, and terminal action grouped on the right.
  Frame, Section, Rectangle, and the other shape tools now share one creation
  flyout. Chats has moved from the floating canvas pill into the editor tool rail,
  where it opens the sidebar directly on CHATS.
- Surface Antigravity's safe tool markers, bounded command inputs and edit diffs, and generic
  thought lifecycle in the shared activity disclosure. Connected-app bridge calls retain their
  concrete tool identity, and tool inputs remain expandable even when no result is returned.
  Because its bridge reports zero usage, estimate and label context consumption instead of leaving
  the meter frozen at zero.
- Chat message text stays readable, and assistant replies render markdown
  (bold, lists, inline code) instead of showing the raw markers.
- Board agents run on Pi. Sidebar CHATS and Board cards share one conversation
  history and the original Vue chat chrome, so a send in either place is the
  same thread. Each conversation now owns one resident `pi --mode rpc` session,
  so follow-ups reuse Pi's normal retry and session lifecycle instead of
  launching a one-shot JSON process and guessing completion from process exit.
  Pi tool failures remain failures, and a turn without a final answer needs
  attention instead of receiving successful checkmarks. The model picker follows the live `pi --list-models` catalog and
  the local Pi default (`xai-auth/grok-4.6`). The picker keeps Cursor Grok and
  Composer 2.5, xAI Grok 4.6 and Composer 2.5, and Codex Sol, Luna, Terra, and
  Spark, and now includes authenticated Antigravity CLI models registered by Pi
  packages. Agent workers include the standard `~/.local/bin` install location,
  so locally installed provider CLIs remain available to sidebar and Board chats.
  Sidebar and Board views of the same task now share one model selection.
- Sending from a running agent chat now uses Pi's native steering channel. The
  instruction joins the active turn at its next tool boundary without aborting
  it, creating a replacement job, or waiting in an OpenPencil follow-up queue.
  Assistant text already streamed stays in the transcript before the steering
  instruction, while a steer sent before visible text no longer creates a false
  “No final response” warning. An image generation already in progress also
  keeps its loading card across steering and resolves in place when its result arrives.
  Running composers expose the same send-first interaction as Codex with an
  “Add instructions…” prompt and a Stop action whenever the draft is empty.
- A frame’s box is its group. Children sitting fully outside that box leave
  the group when the frame moves, resizes, or is deleted, so they stay on the
  page instead of traveling or disappearing with it. Dragging a Board app or
  worker card back onto that box — or moving the box over it — puts it in the
  group again.
- Agent cards are created next to the app and then left alone. The overlay no
  longer resizes the workspace frame, snaps cards back into it, or rearranges
  them after undo.
- Agent cards beside a Board app no longer stretch the workspace under the
  app for a layout that is not used. A tall empty frame shrinks back to the
  cards.
- Board document updates now discard renderer pictures from the previous graph,
  so resized parent frames repaint their fill immediately instead of keeping the
  old white rectangle until the next interaction.
- The live Board and `workspace.json` stay one document. A worker file write
  updates the canvas through the existing file synchronization path.
- Board workers treat `workspace.json` like a repo file: `rg` the compact
  `workspace.index.jsonl`, read the exact matching record and its hierarchy,
  then patch the canonical file with ordinary coding-agent tools.
- Board worker cards show a live Pi tool log inside one chronological activity
  disclosure, with the command or path visible while it runs.
- The disposable JSONL index covers every canonical reachable object by ID,
  name, bounded text, page, owner, parent, and bounds. Continued workers reload
  the same small file-native contract instead of receiving a command preamble.
- Board worker status keeps ticking while a turn is running. After the first
  tool or thought, the header keeps that activity and adds elapsed time
  (`Run command… · 48s`) instead of freezing until the recap.
- Board cards and the selected transcript now show that live activity line
  instead of only “running”, and keep it moving in the UI between heartbeats.
- Board worker cards and the selected chat keep the full agent log without
  dropping empty-text rows on preview polls. Live activity stays expanded and
  completed activity remains visible until the user collapses it.
- Board dispatch now starts a Pi worker directly or continues the exact prior
  thread. Voice, typed comments, and annotations no longer pay for a separate
  routing-model turn; `$voice-dispatch` still keeps camera and theme on the parent.
- Board worker cards can render Cursor-native Read/List/Grep/shell turns as they
  happen, instead of staying quiet until the final message.
- `board_go` zooms into the target the same way a double-click does, instead of
  only nudging if the object is already on screen.
- `dispatch_work` carries the user's exact words, one done sentence, and the
  spoken turn window. Pi loads `/skill:openpencil` to resolve “this/here” from `trace-context.json`
  or the rotated Trace JSONL files; empty, ambiguous, stale, truncated, or
  cross-page context stays fail-closed.
- Remove the Board worker spiral watchdog. Pi turns are no longer stopped for
  too many look-only tool calls.
- Honor the selected model on continue or steer. Pi starts in the configured
  Open Pencil workspace root; workers use listed absolute project paths only
  when the brief requires them.
- Remove the unused Antigravity CLI router, warm-pool settings, and terminal
  transport. Board chats stay on Pi.
- Plugin MCP is the live OpenPencil parent: `dispatch_work`, `board_where`,
  `board_go`, and `set_theme`. An empty `board_go` focuses the live embed on
  the current Board. A query is a proper name only. Workers still edit files.
  The fat Board-mutation catalog stays off the plugin.
- Drop `get_code_object`, `insert_mermaid_diagram`, and `get_mermaid_source` from
  the MCP tool catalog. Mermaid and Code Objects stay file- or CLI-owned; the
  live RPC those commands used is unchanged.
- Keep exactly two plugin roles: `$voice-dispatch` for the live Codex parent and
  `$openpencil` for the Pi Board worker. Workers pick the project from the brief
  and the Open Pencil `AGENTS.md` list.
- Send the live container selector's actual selection with contextual comments:
  element identity, bounds, layout, class tokens, and the full React owner chain —
  not just a label and one primitive file:line.
- Gut the Board agent control plane: direct Pi launch replaces dispatcher routing,
  page-owner locks, lexical fallback, and fat directed-work packets. Board workers
  use the JSONL index, Trace files, and ordinary file tools on `workspace.json`;
  CLI/MCP mutation adapters are not part of their contract.
- Keep Board workers as resident Pi sessions with a restricted MCP catalog and
  the direct user prompt. Dispatch stays Board-only so ordinary Codex work remains
  in its own task.
- Keep Worker and embedded Smylr apps attached to the Board camera. Agent hosts no
  longer use `content-visibility`, so they pan and zoom with the canvas. Entering Interact keeps
  the same conversation tree and stick-to-bottom viewport instead of remounting the transcript at
  the top. Nested agent and iframe surfaces now share their parent Board coordinate space and normal
  stacking order, while workspace repair removes duplicate top-level Smylr frames. Presence skips
  unchanged heartbeats, and the scene/overlay canvases use their exact capped retina backing ratio
  so rendered objects, selection chrome, hit testing, and DOM surfaces stay pixel-aligned. Avoid
  rebuilding unchanged canvas surfaces and rescanning the graph for message-only agent updates.
  Retained agent chats merge polling previews into the mounted transcript instead of collapsing to
  three messages and rebuilding from the full response on every turn.
- Stop an automation register-token loop that could flood the live Board with thousands of
  WebSocket messages a second whenever more than one OpenPencil window was open, which made the
  editor feel lagged even while idle.
- Keep Dispatcher and Worker composers typeable. The prompt was binding a stale destructured
  `modelValue` and `useTextareaAutosize` was writing that empty string back over every keystroke.
  The composer now uses a live prop, resizes without resetting the draft, and keys typed while the
  card is active still land in the input.
- Give typed contextual comments the same directed-work contract as voice dispatch: exact words,
  authority, a definition of done, and an honesty rule. Named selections and live containers are
  already the target, so comments no longer tell the worker to hunt for a code owner.
- Archive the desktop object inspector from the current sidebar while preserving its Design and
  Code implementations for a later return. Native selections, Code Objects, source documents,
  trusted Smylr frames, and agent chats now leave the full sidebar to Layers, Chats, Assets, and
  Activity.
- Keep the contextual-comment composer fully below live embedded objects by panning the Board when
  needed, align the compact model selector with the composer's circular control radius, and enlarge
  its edge actions inside a 54px shell with the same five-pixel inset on every side.
- Give Board agent chats and the sidebar conversation the same compact single-line composer: a 48px
  rounded rectangle, quiet edge actions, inline model selection, and microphone-to-Send handoff. At
  narrow sidebar widths, retain the row with proportionally smaller actions and an icon-only model
  trigger instead of wrapping the input vertically. Use one low-contrast hairline around the
  composer without stacking a second focus ring over it, and keep the inactive controls legible
  through explicit muted colors instead of washing out the entire control with opacity. Balance the
  microphone inside its circle with a slightly smaller, lighter-weight glyph, and keep its empty
  state on the same dark chrome surface as the attachment control so only Send becomes prominent.
- Match the integrated desktop tool rail to the sidebar surface in both light and dark themes so the
  shell reads as one continuous piece of chrome instead of a separately tinted strip.
- Turn the contextual-comment composer into one compact pill with the attachment, text, and model
  controls on one line; show the microphone while empty and replace it with Send once text exists.
- Make embedded Board objects direct and legible: one click enters a Code Object or agent chat
  immediately, double-click still centers the object, dragging moves it, wheel and trackpad gestures
  stay with the Board before interaction, and Escape returns to the canvas without interaction
  chrome. With any object selected, including while interacting, hold Space and press an Arrow key
  to select and center the nearest Board object, even from a focused text box, without surrendering
  ordinary typing or Arrow keys inside the embedded app. Treat a held Arrow as one move per press so
  iframe focus, selection, and recentering do not race across several objects. Send lightweight
  iframe hover highlights without rebuilding and cloning the full live-container tree on every
  target change, cache live-container lookup geometry between real tree updates, and keep Trace from
  deep-cloning large Code Object source payloads on selection. Relay trusted-iframe double-clicks to
  the same chrome-aware canvas focus action used by ordinary Board objects.
- Add one unified, chat-first Antigravity Board object UI for dispatchers and workers with native selection, transforms, zoom, and history. Use a token-matched AI Elements Vue rendering layer for streaming Markdown, tools, safe provider-emitted activity summaries, attachments, sources, errors, and prompt controls while explicitly excluding hidden chain-of-thought. Keep the scoped PTY transport internal instead of presenting a second terminal-style object, and recover warm runs that never return a completion event.
- Add a stable overlay thread selector to the native Chats sidebar with scoped historical worker discovery, pinned dispatcher control threads, and individual worker
  ownership, visible warm-pool decisions, and authenticated follow-ups that serialize same-target
  writers before using warm or cold overflow capacity.

- Add contextual comments for Board selections and live containers with explicit dictation, cropped screenshot evidence, and agent-router dispatch.

- Turn Trace into a quieter Board Activity surface that combines human/editor history with durable
  agent mutation receipts, Reveal, receipt detail/copy actions, guarded latest-agent Undo, and
  repeated-selection compaction.
  Document the Board-first agentic viewing model around attention, legible state, progressive proof,
  and bounded liveliness.
- Let an empty Board enter a blank native canvas without inserting a placeholder, expose exceptional
  view-only or newer-Board authority states, and make document replacement announce busy state while
  blocking mutations but preserving safe navigation.
- Give desktop and mobile tools proper toolbar, pressed, roving-focus, disabled, and accessible-name
  semantics; keep Layer-tree selection synchronized with canvas selection and use real inspector
  headings instead of orphan labels.
- Preserve PWA caches across normal web boots, restore browser zoom, and show a recoverable CanvasKit
  error state instead of dismissing the loader as if a failed canvas were ready.
- Cut initial JavaScript by loading automation handlers, React Code Object runtimes, compatibility
  viewers, PDF.js, Markdown rendering, inspectors, variables, Activity, and the Smylr component
  catalog only when needed. Bound trusted app residency to four viewport-relevant or pinned iframes,
  lazy-load those frames, batch Narrated Trace creation timers, rerender only the Code Object whose
  document changed, reuse unaffected DOM-overlay geometry during preview edits, reuse one canvas
  coordinate read per pointer move, and frame-coalesce embedded-app hover messages. Enforce a 4.75
  MB raw / 1.3 MB gzip regression ceiling for the initial JavaScript entry.
- Let Command-C enter live Container selection when a trusted app frame is selected, including from
  the native desktop menu, while preserving ordinary Copy everywhere else. Accept current chart and
  status token metadata so valid live container trees remain visible.
- Make `Command/Ctrl+C` enter Containers mode for a selected trusted app Code Object. Container
  clicks now select without copying, while a second `Command/Ctrl+C` copies the selected container's
  DevTools-style outerHTML.
- Keep live container selector labels inside the visible app frame by flipping them at top and side
  edges, while giving long container titles more room and exposing the full title on hover.
- Preserve each trusted Smylr app's own light or dark preference across iframe reloads, and stop
  OpenPencil appearance changes from replacing or recoloring the embedded app.
- Remove the React Flow dependency and the complete Object Graph feature, including connector
  rendering, editor/runtime integration, Code Object ports and signals, collaboration records,
  Board automation/Trace contracts, CLI and MCP commands, documentation, and dedicated tests.
- Let trusted iframe Code Objects open in Full Frame from the object toolset without replacing the
  running iframe or changing Board geometry. Keep the OpenPencil sidebar above the expanded app,
  integrate its compact toolset into the sidebar shell, collapse it to a polished edge-arrow tab
  that can be repositioned vertically, and restore the same route and runtime on exit.
- Match the Desktop Code Object viewport option to the measured 1728 × 1069 Chrome viewport so
  trusted-app iframe spacing and responsive sizing match the standalone page.
- Open Board search from anywhere with Command-K, ready for immediate typing and switching.
- Show a compact computed box summary for every selected live Smylr container, including distinct
  padding, margin, border, row/column gap, box-sizing, and unavailable-versus-zero values.
- Add a shadcn-compatible Code Object UI registry with JSON-configured financial dashboard and
  connected estimates-list blocks backed by Recharts and TanStack Table. Registered blocks now own
  strict configuration schemas, default geometry, state, surface behavior, and capabilities so agent
  plans only need a block ID and domain data. Let Code Objects declare transparent or surfaced
  backgrounds plus clipped or internally scrollable overflow.
- Keep active trusted Smylr patient iframes resident when OpenPencil loses document visibility,
  preserving the live patient view across browser tab and focus changes.
- Let live Containers selection take pointer control while Trace annotation stays active, and record
  selected live containers as frame-scoped Trace targets.
- Preserve distinct trusted-iframe container targets in bounded Trace queries, including their owner
  frame, internal ID, route, and path, so agents edit Smylr source instead of searching Board JSON.
- Restore missing SceneNode defaults while loading persisted Boards so one compact or older object
  cannot crash workspace startup and hide every Board.
- Close the Design inspector when nothing is selected so Layers, Assets, and Trace reclaim the
  entire sidebar. Design tokens remain available from the Layers toolbar.
- Remove the generic Connections section from selected-object properties; connections remain
  created and manipulated directly through their Board handles and selected edges.
- Remove the redundant selected-object type, name, and size summary from the standard properties
  inspector so controls begin immediately below the sidebar title.
- Move Workspace board search, switching, and creation into the desktop tool rail and remove the
  bottom Board dock so navigation no longer covers the canvas. Remove the redundant OpenPencil
  sidebar header and move the application menu behind a theme-aware Settings control pinned to the
  rail's lower corner. Keep that menu focused on File and application preferences instead of
  repeating contextual Edit, View, Object, Text, and Arrange controls; retain Media and Mermaid
  creation inside File. Align the compact popup with the sidebar's bottom edge and use the shell's
  quieter radius, spacing, and shadow language so it reads as an extension of the rail.
- Move selected Code Object viewport presets and duplication into a hover-revealed group in the
  shared desktop tool rail, where object-specific actions stay discoverable without covering the
  Board with a floating header. Open shape families from their centered rail icon on hover instead
  of shifting the icon aside for a separate chevron. Give tool changes one stable, spring-driven
  active indicator with a brief capsule stretch and a compact icon handoff instead of making the
  rail jump between disconnected selected states.
- Add a contextual Run/Refresh control beside Code Object tools so a selected trusted application
  can start its registered local launcher or reload its existing frame in place. Keep trusted Smylr
  frames on that registered app origin when older Board data contains a stale loopback host or port,
  while preserving the active loopback hostname for same-site authentication.
- Move Trace Ink and Focus into that primary tool stack with the same active styling and add I/G
  shortcuts. Focus now starts its microphone automatically and stopping or switching tools ends the
  capture, replacing the separate microphone button and second consent step.
- Center double-click focus against the complete visible sidebar shell and retain a small edge gap,
  so the selected object lands in the true readable Board area without touching the chrome.
- Gently zoom out and recenter the single selected object in sync with the opening sidebar, then
  smoothly restore the original camera when it closes. Reuse the same camera endpoints across
  repeated or interrupted toggles so the motion stays deterministic and does not drift.
- Let Markdown documents enter interaction on their first selection click, and let selected Code
  Objects and videos enter with one click while preserving drag-to-move. Double-click focus now uses
  the same chrome-aware center-and-zoom action from canvas and active embedded surfaces. Holding Space
  or using the Hand tool temporarily restores Board panning without leaving interaction state.
- Navigate between Board objects with unmodified Arrow keys: connected Object Graph neighbors take
  priority, otherwise the nearest visible object in that direction is selected and centered without
  changing zoom or adding Undo history. Native container traversal and the live Containers tool take
  arrow priority over Board objects; Shift+Arrow remains the nudge shortcut outside those modes.
- Follow system Light/Dark appearance with presentation-only Board variable modes, automatic
  Mermaid rendering, and a theme prop for authored Code Objects without rewriting Board JSON or
  adding Undo history.
- Replace the animated canvas dither with a stable, low-contrast dot grid on the graphite Board
  background so spatial guidance stays visible without distracting motion or entering exports.
- Make the compact radial desktop toolset the sidebar's collapsed form, then morph that same shell
  vertically and horizontally into the full workspace panel while its tool spine stays connected and
  the compact height grows with the visible tools. Keep the sidebar toggle at the top of that spine
  in both states, and use a quieter neutral selected-tool treatment. Treat the shell as side chrome
  so double-click focus fits and centers objects in the readable Board area instead of placing them
  beneath it.
- Make source-backed video frames chrome-free and directly draggable in normal Board mode, then
  enable playback controls and frame capture only after entering the media surface. Reconcile media
  assets only when the media inventory changes so ordinary transforms do not rebuild viewer state.
- Keep large, long-lived Boards responsive by repairing only collaboration hierarchy branches that
  changed, caching Code Object metadata across pans, and projecting only saved Narrated Trace ink
  instead of rescanning every Board node on each presentation frame. Keep Object Graph camera sync
  imperative and update only changed hover handles so normal pans do not rerender the React surface.
  Seed restored collaboration state atomically and skip duplicate unchanged authority saves during
  hydration. Cache lightweight local-authority status and deliver navigation intents through the
  existing change stream instead of polling, preventing idle editors and hot reloads from repeatedly
  parsing or locking the full workspace. Remove dormant workspace/proving prototypes with no
  application consumers, and avoid racing a full authority save against the replacement page during
  reload. Consolidate repeated fresh-context CLI validation, timing, acquisition, and collaboration
  image synchronization.
  Use the authority change stream as the only local-tab document sync path instead of cloning every
  restored Board into a second Yjs document. Keep only lightweight authority status in memory,
  release parsed heads after requests, and encode binary assets during request serialization so a
  full save no longer creates another complete document copy first.
- Give source-backed Markdown and text frames white reading surfaces that retain normal Board
  transforms, center on double-click, and scroll after entering the focused reading surface.
- Replace caller-managed runtime Board Authority grants with automatic, operation-scoped Board
  Permissions. Keep page, target, ownership, field, limit, Undo, and transient-cleanup checks while
  moving Code Object shapes and Board Experience components into their owning domains; the canonical
  `workspace.json` persistence authority remains unchanged.
- Remove MCP from the agent workflow and keep the editor bridge optional. Development starts only
  the narrow local Board/Trace authority on port 7602, which owns durable Undo and local app
  launching; the editor connects only for the small set of live presentation and file operations.
- Let Board visualization and analytics skills create source-backed chart Code Objects with bundled
  D3 imports, compact reviewed data and provenance, normal frame transforms, and OpenPencil-owned
  targeting, persistence, and proof boundaries instead of host-specific widgets or CDN scripts.
- Open Markdown, MDX, and text as one source-authoritative Board frame with a rendered preview and
  in-place source editor; keep native block expansion explicit instead of exposing layout children.
- Make source-backed Mermaid frames behave like normal Board objects: their rendered bounds now
  select and drag through the shared canvas controls, and double-click focuses without entering an
  empty container; existing proportional resize, rotation, keyboard movement, and Undo stay shared.
- Keep Mermaid and other DOM-backed Board surfaces on CanvasKit's shared presentation frame during
  continuous pan and zoom so their rendered pixels no longer lead or drift away from canvas objects.
- Isolate invalid Mermaid source to its owning frame so unrelated Boards still open, read, and edit;
  guarded Mermaid builds continue to reject invalid requested source before mutation.
- Render Mermaid 11.16 source as one SVG-backed Board frame with no generated native children;
  direct source edits preserve frame identity and geometry without a browser or headless compiler.
- Publish direct canonical JSON graph replacements through the authority change stream, so agent
  edits remain simple file changes while open local editors update without a second collaboration
  document.
- Make `~/.openpencil/local-workspace-authority-v1/workspace.json` the canonical plain Board
  document: coding agents can edit its node JSON directly while OpenPencil derives revisions,
  bounded JSON history, and open-editor synchronization. Keep Trace history in append-only JSONL;
  CLI and MCP remain optional adapters instead of the normal Board mutation path.
- Publish the latest completed Trace gesture atomically as a bounded `trace-context.json` beside the
  canonical Board, with exact current object and connector IDs, a finite region, explicit expiry and
  omissions, and one filesystem PNG reference instead of base64, history, runtime, or inferred-intent
  dumps; Board edits re-resolve its targets and mark missing references ambiguous.
- Route `board present` from a persisted four-field Board target into the connected live editor,
  and let existing Code Objects switch viewport presets through one semantic `object.resize`.
- Let trusted-app Board recipes choose shared Desktop, Laptop, Tablet, or Phone viewport presets;
  frame-header clicks and agent builds now persist the same semantic preset and dimensions.
- Make `trusted_web_app` creation persist the complete registered Smylr iframe contract in both live
  and headless Board builds, instead of producing a generic Code Object shell without app metadata.
- Simplify normal Board automation to `board search`, `board create`, `board build`, and
  `board present`; `board build` now accepts one `board-build-request/v1` while OpenPencil keeps
  runtime routing, authority, revisions, retries, persistence, and Undo internal.
- Add semantic Board composition to the universal builder: agents state only the listed members and
  optional direction, density, reading order, grouping, or emphasis, while OpenPencil measures
  artifacts, derives flow from connections, avoids unrelated Board content, and creates or
  recomposes the requested objects in one live Undo batch or persisted authority revision; a group
  containing only new objects now auto-places without a meaningless anchor.
- Let `board create --name NAME --request-id ID` resolve the sole persisted workspace/document
  authority automatically, while optional exact target flags pin or disambiguate creation without
  requiring a browser or live editor.
- Let one direct `native_diagram` Board recipe rewrite an exact Mermaid SVG frame in place across
  live and persisted authority, preserving its identity and position through one atomic receipt.
- Deliver Trace-guided agent context as one bounded packet of canonical top-level Board targets plus
  a model-visible evidence image, keeping image bytes and nested implementation children out of the
  text prompt before the single direct persisted `board build` mutation.
- Treat Trace regions as soft “near here” placement hints while keeping explicit regions strict,
  and preserve exact Board, revision, request, and Trace context in pre-mutation errors.
- Keep routine Board work independent of the live app: CLI and MCP now share one execution-surface
  classifier, persisted Trace history and Mermaid source readback stay on local authority, compact
  receipts omit optional live-proof noise, and editor Undo/Redo can revert durable agent
  transactions after a runtime restart.
- Make Board discovery index-first: a disposable revision- and content-hash-aware
  `workspace.index.jsonl` lists Boards and objects while `workspace.json` remains truth; agents can
  use ordinary `rg` without dumping or parsing the canonical workspace into model context.
- Add generic reversible Board transactions: every successful plan returns a transaction ID,
  `board context` lists recent transactions, and one `transaction.revert` plan restores exact native
  objects and Object Graph records through live Undo/Redo or retained durable authority history.
- Let universal `board build` plans delete exact page-owned Object Graph connections idempotently
  through the same live Undo batch, persisted authority transaction, and durable receipt.
- Make exact-target `board build` acquire current Board authority automatically, and add relative
  object moves (`above`, `below`, `left`, or `right`) so follow-up placement needs no geometry read.
- Let `board build` resolve the latest or an exact Trace gesture internally, materialize `$trace`
  object references and `trace_region` placement before validation, and apply the requested plan in
  the same agent-visible CLI or MCP call; remove `board prepare-edit` from the public tool surface.
- Reconcile atomic `board build` plans against the authority snapshot before commit: already-current
  object edits and exact existing Object Graph connections now report `already_satisfied`, while
  missing effects apply in the same durable transaction and true metadata conflicts still refuse.
- Let `board build --plan '<JSON>'` execute ordinary atomic plans inline so agents can create,
  connect, persist, and receive the compact receipt in one visible CLI command without a temporary
  plan file; retain `--plan-file` for large or shell-sensitive payloads.
- Let fresh-context name placement use complete top-level name coverage even when bounded context
  omits irrelevant child or text detail, while still refusing incomplete or ambiguous root scans;
  clarify that native text and card recipes imply creation and do not accept `operation`.
- Suspend and dispose off-screen Code Object runtimes, WebGL loops, and inactive Board Experience
  animation frames so CPU and memory scale with visible Board work instead of total page contents.
- Keep the empty-Board dither wave continuously animated while capping its shader draws and internal
  resolution so decorative motion no longer monopolizes the renderer while the editor is idle.
- Preserve canonical-object identity separately from each indexed Board placement so agents can
  distinguish a reusable source, an instance/reference, and an independent local clone.
- Bridge Code Object semantic port markers into Object Graph presentation geometry so connectors
  remain attached to their rendered rows or controls when a container resizes or its internal React
  layout reflows; persisted percentage anchors remain the unloaded-runtime fallback.
- Commit the Object Graph viewport before paint from the same OpenPencil presentation frame as
  Code Object surfaces, removing React Flow's independent asynchronous viewport update so schema
  nodes, field handles, and connections remain visually locked to the Board while it moves.
- Let the active OpenPencil tool own pointer input across Code Object and Object Graph overlays:
  Hand and drawing tools now reach the ordinary canvas when a gesture starts over a React surface,
  while Code Object movement, graph handles, edge selection, and reconnection remain Select-only.
- Keep Object Graph connectors attached during direct Hand-tool and touch panning by synchronizing
  React Flow on every shared canvas repaint, including transient camera updates that do not emit a
  committed viewport event.
- Initialize React Flow from the restored shared Board camera as soon as its pan/zoom controller is
  ready, and keep upstream connector paths readable in constant screen space at overview zoom
  without adding custom colors, arrows, labels, or routing.
- Vendor the React Flow UI Database Schema Node component structure into the reusable flow registry,
  materialize real input/output ports for every field, and bind schema relationships to exact field
  handles instead of side-only connector approximations. Match the upstream header, table, label,
  and 11px handle treatment, and use React Flow's built-in Bézier edge without custom arrows,
  badges, colors, obstacle routing, or size-dependent connector chrome.
- Let any Code Object created through the universal `board build` plan declare stable named Object
  Graph ports with explicit direction, connection kinds, side, and offset. Connections can now bind
  exact source and target port IDs, while React Flow projects those handles onto the ordinary Board
  object and existing side-only connections remain compatible.
- Make `board build --plan-file` the universal atomic Board mutation path: one revision-bound plan
  can now create artifacts, update/move/resize/duplicate/delete exact top-level objects, and add
  Object Graph connections with one durable receipt and same-request replay. Retain `board edit`
  and `board connect` only as hidden compatibility commands.
- Make the universal `board build` plan path tolerate redundant matching exact-target flags,
  normalize unambiguous grid-member and recipe aliases, accept title-only native cards, and widen
  long native prose cards deterministically without dropping content or escalating to executable
  Code Objects.
- Add exact Codex app-server prompt-to-Board telemetry and a receipt-driven straight-through release
  path so eligible durable Board successes can return a truthful final without another model turn.
- Let `board build --plan-file` accept a versioned `board-build-recipe-request/v1` and compile the
  bounded `brief_grid@1` and sequentially connected `process_flow@1` recipes into the existing atomic
  plan, with strict validation, stable aliases, an expanded-plan SHA-256 digest, compact release
  metadata, and same-request replay. A redundant fresh-context `--auto-place` hint is tolerated while
  the compiled plan remains the sole placement authority.
- Let the same `board build --plan-file` path accept a bounded `board-build-intent-request/v1`, choose
  a structured brief, comparison, or process flow through an authority-free capability registry, and
  retain the selected representation and provider in the durable compilation receipt.
- Add compact `board build --release-summary --json` output so agents can release directly from the
  authoritative receipt without ingesting the full context and readback payload; ordinary native
  card/text compositions with Object Graph connections can use the same deterministic release path,
  and successful persisted builds now return an exact durable `next_build_target` for follow-up
  graph edits without rediscovering or retrying a temporary live runtime.
- Route persisted Board and Trace CLI commands directly through local authority instead of the MCP
  HTTP/live-runtime bridge, while keeping MCP available for external clients and live presentation.
  Store Board heads and revision history as files; store full Trace sessions in rotated JSONL,
  compact current targets in `trace-context.json`, and evidence as separate PNGs. Detect direct
  cross-process Board commits from the canonical revision so open local Boards refresh promptly.

- Keep mixed display creation under the universal `board build` command with an optional
  `--plan-file` contract for atomic native text/card compositions and meaningful Object Graph
  connections, including internal aliases, one durable receipt, full prevalidation, and
  same-request replay without partial persisted state.
- Let `board build --plan-file -` read mixed plans directly from piped or file-backed stdin,
  including shell heredocs, and report conclusive pre-mutation validation failures as terminal
  `stop` outcomes without suggesting same-request recovery for work that never reached the Board.
- Let `board build --fresh-context --relative-to-name ...` resolve one uniquely named visible
  top-level object and place a native card, anchored native text, or Code Object beside it in the
  same command, including persisted-authority Code Object anchoring and one-to-four direction
  preference normalization. Recover
  one conclusive pre-apply stale-context race with the original request ID while preserving
  applied-or-unknown outcomes for explicit recovery.
- Let `board read --object-ids ...` acquire one exact read-only context automatically and return
  only the requested objects plus their descendants, avoiding selection setup, whole-page scans,
  and copied context tokens when stable object IDs are already known.
- Let trusted Code Object `--source-file` builds use an existing context/base plus explicit
  auto/relative/point/region placement, avoiding ad-hoc `jq` wrappers and source JSON escaping after an
  agent has already inspected the Board.
- Add `board present --fresh-context` so agents can select and fit a completed multi-artifact group
  with one exact CLI command and measured two-call handshake.
- Add a direct `board build --source-file` fast path for trusted TSX Code Objects so agents can
  preserve structured receipts and proof without wrapping the CLI to escape source JSON.

- Add guarded persisted-authority `board fixture capture|assert|reset` evaluator controls that bind
  an authority-owned token to the exact Board, compare a receipt-insensitive semantic hash, and
  durably restore native nodes, Code Objects, and page-owned Object Graph records through CAS while
  retaining agent receipts and reporting external reset, normal editor Undo, and pixel proof as
  separate boundaries.
- Add a versioned append-only prompt-to-Board evaluation event contract that timestamps Codex
  stream events from an external clock, separates authoritative Board results from render, pixel,
  durability, and visual-quality witnesses, rejects cross-target or raw-eval evidence, and derives
  complete prompt-to-visible-to-final latency without substituting tool-reported timings.
- Let `board open` switch directly to an exact non-visible live Board before acquiring context,
  removing the circular precondition that required the destination to already be visible. An
  authority-pinned open now queues a short-lived, exact, latest-wins navigation intent that the
  sole or focused matching editor consumes once; missing editors no longer leave orphaned intents,
  and ambiguous editors return candidate runtime IDs for explicit selection. The CLI now trusts the
  exact open receipt instead of reacquiring redundant Board context, while Board building remains
  headless and independently durable.
  Live opens now preserve the Board focal point against the actual sidebar, toolbar, inspector, and
  dock safe area instead of centering content beneath editor chrome.
- Add guarded live-editor and persisted-authority `board edit` operations for top-level native object
  update, move, resize, duplicate, and delete; require exact target/context/revision and stable
  request identity, return durable readback receipts with restart-safe replay, use normal live Undo
  and Object Graph cleanup, reject no-op/stale/locked/nested misuse, allow ordinary move/resize/delete
  transforms for Code Object frames while keeping content/identity changes on their dedicated
  contract, and expose an exact two-call `--fresh-context` CLI shortcut without raw eval.
- Let exact-owner `code-object inspect` read full current TSX, source hash, props, state, and frame
  geometry from persisted local authority without an open editor, then return a guarded staged
  refine base that source-hash fences full-source replacement while preserving owner identity,
  state, geometry, and unrelated plugin data with durable replay receipts.
- Add a guarded one-command `board connect --fresh-context` CLI mode for exact targets and either
  stable endpoint IDs or unique visible top-level endpoint names; it refuses malformed or
  authority-bearing logical input
  before any RPC, validates connector capability plus the atomic context base and revision, performs
  one context call and one connector call on the normal path, permits one same-request conclusive
  pre-apply stale recovery, and reports semantic-call and handshake-wait timing metadata.
- Add an explicit one-command `board build --fresh-context` CLI mode for anchored native text,
  self-contained native cards, and Code Object creates with a fully known exact Board target; it validates auto/relative/point/region
  placement before any RPC, preserves and revision-checks the returned atomic base, supports narrow
  `--auto-place` normalization, reports semantic call/handshake timing metadata, and refuses mixed
  modes.
- Let interactive Code Objects use explicit collision-free auto, relative-object, point, or region placement without
  manufacturing a temporary selected anchor; retain exact singleton-selection guards when an anchor
  is actually requested, and bind either placement mode into the guarded idempotency receipt.
- Let ordinary native-card prompts request explicit bounded automatic or relative-object placement without inventing
  coordinates; use the live usable Board viewport, an exact object, or deterministic headless content bounds while
  preserving exact anchor, point, region, collision, receipt, replay, and refusal semantics.
- Canonicalize Board discovery, context, creation, opening, and guarded automation under
  `openpencil board`; keep `boards` and `documents` as hidden compatibility aliases, hide superseded
  mutation routes from normal help, and let exact writer contexts create pages through either a live
  runtime or persisted local authority with durable CAS and idempotent restart replay.
- Group document inspection under `openpencil inspect`, retain the existing top-level commands as
  compatibility aliases, and keep `eval` explicitly file-only instead of implying unguarded live
  Board mutation.

- Let exact persisted-workspace Board context, bounded reads, native-card builds, receipt verification,
  and document listing run through the local authority when no editor tab is open; keep CAS,
  idempotency, collision checks, and durable restart readback while reporting presentation, pixels,
  Trace, and normal editor Undo honestly unavailable without a live runtime.
- Shorten the healthy prompt-to-Board path by allowing unambiguous read-only current-visible context
  discovery and copy-ready nested build/connection base packets; keep Trace reads from forcing a
  redundant context call, refresh durable no-change continuations internally, and recover unknown
  persistence through same-request build replay without duplicating artifacts.
- Preserve historical same-request receipts after an artifact is gone without issuing a misleading
  fresh persistence barrier or a connector continuation against a later Board revision; immediate
  apply and same-revision replay still return the copy-ready connector base.
- Expose sparse measured stage timings and total caller-visible wall time on guarded `board_build` and
  `connect_objects` results without adding proof waits, extra calls, or mutation semantics.
- Give `board_context` and selection-scoped `board_read` a deterministic nearest-page-owned
  neighborhood with hard pretty-printed UTF-8 limits for neighborhood, compact selection, and total
  context payloads; bound page-root candidate sampling and per-string preview scanning as well as
  transport size, report unscanned roots and unknown byte omissions honestly, and keep wider page
  reads explicit and Trace optional and read-only.
- Let `board_build` turn an exact Trace point or bounded Board region directly into one editable,
  collision-checked native card without creating a temporary anchor; preserve the selected-anchor
  path, exact target/revision guards, stable request replay, one-step Undo/Redo, durable receipts,
  readback, persistence, and presentation proof.
- Align the guarded Board builder and MCP with the existing 100,000-character Code Object source
  ceiling, accept large recipes through the CLI `--recipe-file` option, make CLI help explicit that
  `--recipe` and recipe files contain only the nested recipe object without the outer build contract,
  and state directly in MCP discovery and CLI help that authored TSX is trusted in-process code rather
  than a security sandbox.
- Expose component-free Vue SDK `i18n` and `presentation` entry points so headless Board-builder
  checks do not evaluate the component barrel; focused multi-file tests now exit deterministically
  instead of leaving a CPU-spinning Bun process after a raw `.vue` parse failure.
- Require runtime, workspace, runtime document, stable content document, and Board identity in every
  guarded read/change/present/connect/verify MCP schema and post-context CLI command so a partial
  target cannot be forwarded despite the exact-target contract; keep initial context discovery
  usable from either the durable workspace or runtime document identity; mark every mandatory CLI
  field in command help, point Code Object refinement to the matching CLI inspection command, and
  document the guarded two-call live-Board path before lower-level file primitives on the correct
  default HTTP port.
- Let exact-owner Code Object refinement proceed without a hidden singleton-selection dependency;
  the current owner, immutable key, source hash, context, and Board revision remain mandatory, and
  the CLI/public guide now teach the guarded builder plus exact-owner inspection instead of legacy
  partial-target examples; keep full TSX confined to explicit owner reads while builder mutations
  return bounded source-hash, preservation, runtime, persistence, and presentation proof; document
  authored TSX honestly as trusted in-process code whose static ambient checks are defense in depth,
  while keeping external or untrusted source behind the sandboxed embed boundary.
- Keep page-owned Object Graph connector semantics and selection under OpenPencil authority while
  rendering the upstream React Flow Bézier edge and handle UI directly; remove the custom obstacle
  router, arrow, badge, kind-color, shadow, and zoom-dependent connector presentation layer.
- Show a play action beside a selected trusted app's Containers control when its local runtime is
  down; keep the displayed start script on the Code Object, execute only an allowlisted local
  launcher, and reload the embedded app after startup.
- Stream short-lived drag previews between active local editors with smooth remote interpolation,
  while committing only the final released transform to Board history and persistence.
- Merge page-owned Object Graph connectors as stable per-connection collaboration records so
  concurrent connector edits cannot silently replace unrelated links, while preserving Undo and
  legacy Board reopen behavior.
- Add one `board_build` agent and CLI entry point that routes typed `board-build/v1` recipes to
  existing native-text, bounded native-card, and source-retaining Mermaid owners without requiring
  a specialist skill; create an editable card Frame with title/body text through the
  `local-legible-card-v1` profile while keeping specialist provenance outside mutation; add a
  writer-only `board_build_base` to Board context so agents can copy the explicit exact target,
  token, contract, and revision without renaming nested response fields; keep request identity,
  recipe content, and anchor choice agent-owned and preserve every existing stale/wrong-target check;
  let several independent artifacts chain from each successful build's fresh returned base without
  an intermediate context call or one opaque batched Undo step;
  replay every stored native-text, native-card, Mermaid, or Code Object request from its original
  same-ID input without requiring a fresh context, while conflicts and historical replay after Undo
  still fail without duplication; return one canonical top-level page-owned `owner_id` across every
  applied/replayed recipe for direct use by `connect_objects`, and refuse completion when receipt,
  readback, and ledger owner evidence is missing or inconsistent;
  return an optional copy-ready `connect_objects_base` only from completed builds with fresh
  post-build context, containing the exact target, context token, and current revision but no build
  contract, request, endpoints, or connection semantics, so meaningful follow-up connections avoid
  another context call without implying that every build needs an edge;
  reject unsupported recipe, placement, extension, or top-level fields instead of silently dropping
  requested presentation or misspelled input, and publish the minimum default-exported TSX component
  contract in tool discovery so an interactive Code Object is constructible on the first attempt;
  bound context selection summaries to 25 with honest count/truncation metadata while retaining the
  full internal selection for guards, and make explicit selection reads honor their 1–100 limit;
  describe every build recipe with a behavior-first chooser so agents use the simplest medium that
  preserves the requested behavior and never connect independent objects merely because both exist;
  reject over-height cards before mutation and treat title/body geometry outside the owning card as
  divergent instead of reporting a visually broken result current; measure explicit hard lines,
  CRLF/CR, emoji, and conservative non-ASCII widths before mutation so accepted cards do not clip;
  create-only TSX Code Object recipe that compiles guarded trusted source before mutation, places
  one interactive frame collision-free beside an exact anchor, preserves durable same-request
  replay through reload, and shares the same presentation and persistence acknowledgment;
  parse authored TSX before mutation so blocked browser/network capabilities cannot bypass the
  guard through aliases, destructuring, computed access, optional chains, or later assignment;
  require a correlated attached React render before Code Object creation or replay can report
  completed, while preserving applied receipts and Undo when rendering fails or times out;
  refine that exact selected Code Object through its immutable key, current source hash, and Board
  revision while preserving geometry, interactive state, permissions, metadata, and connections,
  with durable no-change receipts and one-step Undo for applied source updates; return a writer-only
  copy-ready refinement recipe header from the exact Code Object read so agents cannot accidentally
  swap its owner, immutable key, or current source hash;
  keep optional specialist metadata bounded and authority-free, require exact runtime/workspace/
  runtime-document/stable-content-document/page identity, expose the resolved route, reuse normal
  Undo and presentation, support deterministic empty-Board Mermaid placement, and give guarded
  Mermaid creation durable same-request replay, conflict detection, `board_verify` recovery, and
  fail-closed receipt rollback.
- Add guarded semantic `board_context`, `board_read`, `board_change`, `board_present`,
  `connect_objects`, and `board_verify` commands to MCP and the local CLI; pin every operation to
  the exact running client, workspace/document/Board, writer authority, context, selection, and
  revision, with deterministic collision-free native-text and bounded native-card creation,
  page-owned Object Graph
  connections, persisted route-and-payload-bound idempotency receipts, honest live replay status,
  native readback, presentation acknowledgment, and one-step Undo as the first supported change
  slice; reject automatic visual connections and require every data/action agent connection to
  state its automatic activation intent explicitly in the public schema and guarded runtime, with
  that value preserved in request identity and authoritative readback; prove the exact rendered
  React Flow path and endpoint anchors in the same response, and retain an applied
  receipt plus persistence attempt while reporting unavailable if the visible edge is missing;
  require the same writer and
  receipt boundary for generic mutating design tools; fail closed
  on stale, pending, corrupt, expired, or saturated request state; persist a request reservation
  before an executor may change the Board, coalesce concurrent identical requests, and expose
  bounded ledger usage through `board_context`; refuse asynchronous mutating ToolDefs through the
  guarded bridge until their receipt can be durably acknowledged, and disclose that refusal in MCP
  tool discovery before an agent attempts the call; add the opt-in
  `local-legible-text-v1` profile for bounded nearby typography context, actual page-surface
  contrast, readable presentation, and revision-bound visual verification without exposing nearby
  text content.
- Require explicit runtime, workspace, runtime document tab, stable content document, and page
  identity for every MCP and CLI Trace query; expose both document identities through context and
  document discovery, require exactly one retrieval selector, keep spoken turns on their recorded
  window, keep structural scope labels out of evidence scoring, preserve exact target arguments
  through the app dispatcher, scrub transcript-bearing retrieval state on clear or expiry, and
  show honest matched, ambiguous, empty, and error receipts in normal Trace History; bind volatile
  spoken turns and continuation cursors to the exact runtime-tab incarnation so HMR/reload cannot
  reuse stale context.
- Give local workspaces one exclusive saving tab while secondary tabs exchange live edits through a
  session-scoped Yjs channel; hydrate hot joiners from the active session before binding their graph
  or publishing restored state, keep deleted objects and Code Object/connector geometry stable,
  elect exactly one deterministic seed when authority-backed clients start simultaneously, serialize
  rapid authority saves so one writer cannot stale-conflict with itself, and reject genuinely stale
  queued saves.
- Keep the visible local-workspace writer role and guarded Board-tool authority bound to the same
  latest workspace view across hot reloads, so stale view cleanup cannot silently revoke a newer
  writer.
- Start every Assets folder collapsed so opening the panel shows a compact catalog while preserving
  per-folder expansion and automatic search reveal.
- Keep one Board-owned Code Object header visible while its frame is selected through Design,
  direct interaction, and semantic container focus; hide it on deselection, keep transforms
  Design-only without transient duplicate handles, scale it sublinearly from the owning frame's
  Board dimensions using the same size curve as connector chrome without stretching its internal
  layout, preserve that relationship through camera zoom, keep healthy iframe connection state
  quiet, and give transform corners and graph ports one coherent control-node family.
- Keep the restored local Board as the single cold-start authority instead of replaying a second
  persisted Yjs room that could resurrect deleted layers or reset Code Objects and connectors.
- Let arrow keys traverse a selected connector as a focus step between its spatial endpoints, with
  Escape restoring the starting view and Delete disconnecting through normal Undo/Redo; add
  explicit Enter-to-navigate container traversal and live-app Containers navigation that take arrow
  priority over ordinary Board objects.
- Let users drag a multi-selection from empty space inside its visible group bounds, moving every
  selected object through the normal preview, Undo/Redo, and persistence path.
- Center containers, non-text native objects, and Code Objects in the unobstructed Board viewport
  when they are double-clicked, while preserving their existing edit, drill-in, and interaction
  behavior.
- Keep Object Graph connectors physically attached through resize and rotation while using React
  Flow's normal viewport scaling and a larger invisible interaction target around the official 11px
  handle; suppress ghost handles and edges for hidden, fully transparent, or fully clipped endpoints
  without deleting the durable connection, so reveal and Undo can restore it.
- Let selected Smylr surfaces distinguish click from drag: click enters interaction, drag moves the
  owning Code Object frame, Escape returns Board control, and Undo restores a committed move.
- Give Code Object dragging the same edge and center snapping guides as native Board objects,
  including snapped preview coordinates and normal cleanup on commit or cancel.
- Route Object Graph action and data delivery through target-scoped, revocable Board Authority
  grants so connected objects can affect only the exact Board endpoints named by their connections.
- Mount the native authenticated Smylr program as a trusted-web-app Code Object iframe instead of
  reconstructing its DOM; keep up to four frame-bound runtimes live for rapid comparison, park
  overflow frames with new mount generations, restore each frame's Smylr-owned route and scroll
  checkpoint, and keep only the Board-selected frame attached to semantic Layers.
- Migrate legacy frame-owned Code Object `state.write` links into page-owned Object Graph records
  without changing FRAME IDs, and route compatibility writes through revocable exact-target Board
  Authority grants with one Undo/Redo transaction.
- Add reviewable Static Design patch-back for supported literal React styles, stable source identity,
  three-way source/native reconciliation, structured rejection of unsafe dynamic edits, and
  page-scoped Board Authority rollback, provenance, and Undo/Redo.
- Clean up orphaned transient Board Experience components when their owning experience is no
  longer active, preventing stale simulation objects from mounting Code Object and graph runtimes
  after reload.
- Harden Board Authority with Board-issued revocable grants, explicit create/delete and field-scoped update permissions, versioned grant-aware mutation receipts, and automatic cleanup of transient Board Experience components when their authority session ends.
- Give every selected Code Object the same compact Board-owned title, duplicate action, and
  Desktop/Laptop/iPad/Phone viewport controls, including Smylr and Board Experience components,
  while keeping interaction on the object itself instead of repeating runtime status in chrome.
- Retire the HTML Board runtime, Smylr Container tool, Live App Block ownership model, and Focus/Compare/Knowledge/Review workspace projections; Smylr screens and source-backed component placements now use ordinary frame-owned Code Objects with normal selection, transforms, persistence, and Undo/Redo while retaining their internal component layers, selectors, attributes, and computed-style inspection.
- Keep Workspace inside one continuous Board dock surface, separated from Board tabs by a subtle internal divider instead of a detached dock segment.
- Remove the retired dedicated voice-assistant surface and app-server bridge while preserving generic Chat, persistent Trace History and bounded retrieval, guarded automation receipts, Code Objects, and existing saved boards.
- Unify every trusted interactive frame under one Code Object data and inspector contract: presets, Orbit surfaces, forms, charts, documents, spreadsheets, presentations, PDFs, Smylr screens, and saved components expose frame-owned editable TSX, name, properties, and state through the same ReactDOM runtime.
- Consolidate authored interactive content into one Code Object contract: trusted TypeScript/TSX source, serializable properties/state, nested React components, and ReactDOM rendering live inside one ordinary persisted frame with Design/Interact, transforms, connectors, undo/redo, duplication, and save/reopen; add stable `code-object upsert`/`inspect` automation with native readback and retire HTML Board creation from current product paths.
- Connect Code Objects through explicit board-owned state permissions; authored interactions can request one atomic source-and-target state change through a scoped API, while OpenPencil validates the connection and owns persistence, receipts, and Undo/Redo.
- Give trusted Code Objects an explicit board remote for creating, observing, changing, and deleting native shapes they own; every action stays permission-scoped and board-owned with normal selection, persistence, and Undo/Redo, and a new Board remote preset demonstrates the pattern.
- Separate smart objects from whole-board coordination: Code Objects remain ordinary frame-owned components, while optional Board Experiences run once at page scope through the same shared board authority; refactor Tower defense so its lane, controls, towers, and spawned enemies are selectable Code Object instances, with transient motion updates kept out of per-frame Undo history.
- Add one typed object graph across ordinary native objects and Code Objects: every object can reveal React Flow connection handles on hover or selection and use plain Bézier edges directly on the ordinary Board without activation, a separate Graph tool, or another mode; React Flow shares OpenPencil's viewport, follows live OpenPencil move and resize previews through one frame-coordinated projection, keeps connected edges mounted instead of viewport-culling them during transforms, and avoids creating a second canvas, card representation, controls, or minimap; visual, data, and action links remain OpenPencil-owned records with normal permissions, persistence, and Undo/Redo.
- Highlight hovered or selected graph-capable objects with the real `border-beam` React effect, following each native object's bounds and corner radius without creating a duplicate card or intercepting Board interaction.
- Route opened JSX/TSX files and imported PDFs directly into that Code Object contract; add saved TSX Chart and Form components, persistent PDF page navigation and extraction, and keep unsupported files as clearly labeled attachments rather than a competing source-object product.
- Add board-native document and spreadsheet objects with quiet Design previews, full open-source Univer editing in Interaction mode, persisted edits, ordinary canvas transforms, and source-preserving DOCX/XLSX intake; PowerPoint decks gain a familiar thumbnail filmstrip and focused slide controls without becoming iframe embeds.
- Import PPTX as a source-first React deck that behaves like an ordinary canvas object, with direct slide navigation, persisted slide state, and exact original-file download; converting its text, shapes, backgrounds, and connectors into editable canvas copies remains explicit rather than the import default.
- Fixed collaborative workspace persistence for source-backed files so original PPTX, DOCX, spreadsheet, 3D, and other retained bytes remain available after refresh.
- Keep Trace as one dedicated time-ordered History and evidence feed, persist Ink and Focus with their tools still active, coalesce meaningful selections, tool activations, object/container changes, and Smylr surface styles into scoped semantic events, record durable page-space points/regions plus target-relative placement anchors for Focus and explicit target clicks, show those coordinates directly in History, retain honest location evidence for blank-canvas Focus, remove editor chat/readiness/handoff controls, and expose bounded document/page/time-ranked retrieval with follow-up cursors.
- Let users explicitly start a consented microphone session from the top canvas toolbar, keep it on
  until they press Stop, and show each volatile spoken turn inside normal Trace History;
  `query_trace_history` resolves a selected turn's exact runtime, workspace, runtime document tab,
  stable content document, Board, and time window only after an explicit AI request, while
  disclosing possible browser network speech processing, retaining no audio, and reporting
  matched, ambiguous, empty, and error states without Board mutation; show the exact source
  transcript/window, match reasons, and at most five bounded event/target anchors in normal Trace
  History; allow exact deletion of one volatile mic turn without making durable Trace events
  deletable, scrub its retrieval/candidate/UI continuation derivatives on deletion or expiry, retire
  the legacy silent speech path, and expose the same exact-scope retrieval through the local
  `openpencil trace` CLI.

- Keep one persistent OpenPencil Workspace document across reloads, local browser instances, cloud sessions, and agent automation; Boards remain pages inside that document while explicitly opened files stay separate document tabs.
- Keep development workspaces local by default; Cloud now requires `VITE_OPENPENCIL_CLOUD_ENABLED=true` so stored credentials cannot automatically hydrate a parked database.
- Add first-class trusted Code Objects that persist as ordinary scene frames, keep one stable React root while moving and resizing, enter interaction through normal double-click or Enter behavior, preserve component state through save/undo/duplication, and include a polished interactive WebGL globe without an iframe or persistent embed chrome.
- Convert trusted React/TSX plus authored CSS into native editable layers from the app and CLI, retain exact source and React state/event intent, preserve stable layer IDs and manual canvas overrides during re-import, and include polished globe and timeline examples; unsupported imported components remain explicit editable fallbacks.
- Keep cloud-backed collaboration from merging a stale full IndexedDB room into Supabase, and stream first-sync Yjs state in bounded batches so small board and folder edits are not blocked behind an oversized retry.
- Persist unsent cloud edits in a compact local outbox, retry storage with bounded backoff, and elect one checkpoint owner so refreshes cannot resurrect deleted objects during a Cloud outage.
- Preserve object deletions made during collaboration storage hydration so an older Yjs snapshot cannot recreate the deleted object after refresh.
- Make Supabase the single document-sync owner for cloud workspaces, cancel superseded hydration, avoid startup writes before hydration completes, recover timed-out update reads with bounded pages, and remove stale preview nodes after authoritative cloud state loads.
- Stop cloud authentication and workspace bootstrap from leaving the editor behind an endless connecting overlay; after a bounded connection deadline, keep the local workspace usable and offer cloud retry from a non-blocking notice.

- Add an optional, dedicated OpenPencil Cloud workspace with email accounts, durable Yjs board storage, automatic cross-device sync, and one-time cofounder invites while retaining local offline and direct peer editing.
- Show persistent dashed center guides plus live margin, border, padding, content, and gap measurements for the selected Smylr container while hover remains a secondary outline; hide and lock the owning Code Object frame chrome until Containers exits.
- Prevent duplicate persisted child references from mounting the same Code Object overlay and embedded runtime more than once, avoiding duplicate-key churn and interaction instability.
- Keep React Grab's page-level selection overlay opt-in with `?react-grab` during development so it cannot intercept ordinary Board clicks.
- Made source-backed components placed from Assets behave like native board objects: click the component itself to interact, drag its compact selected title to move it or leave interaction, and resize the real rendered component without exposing a surrounding card, empty parent surface, or hover toolbar.
- Make embedded component readiness wait for the committed React render before enabling Board interaction, and keep the Global Context Menu fixture local-only so opening it never triggers an authentication redirect or CORS error.
- Expanded the scalable source-backed component renderer from 20 to 29 live fixture families, adding EmptyState, InitialsAvatar, InputGroup, Label, SearchInput, Skeleton, Spinner, Toggle, and ToggleGroup with their usable states and variants.
- Expanded live component coverage again from 29 to 38 families with Bubble, ButtonGroup, Empty, Field, InputOTP, Pagination, SensitiveInput, SegmentedFilter, and Timeline, including source-defined axes and interactive states.
- Expanded live component coverage from 38 to 47 families with AlertDialog, Collapsible, CollapsibleCard, DatePicker, HoverCard, Popover, Sheet, Stepper, and TimePicker, including contained open overlays and direct on-board interaction.
- Expanded live component coverage from 47 to 56 families with Carousel, ChatBubble, Command, ContextMenu, DetailPair, MetricCard, PreferenceRow, ScrollArea, and SelectDropdown, including real right-click, search, scroll, toggle, and selection behavior.
- Expanded live component coverage from 56 to 65 families with Chart, ConfirmDialog, Form, FormFields, IconifyIcon, Message, SlideOverPanel, Toaster, and TreeNav, including real chart displays, validation states, contained feedback, and collapsible navigation.
- Completed live fixture coverage for every component-bearing root UI module with Dialog, SignaturePad, and TreeNavCollapsedProvider, including contained dialog states, real pointer drawing, and collapsed-navigation context.
- Began full-fledged layout coverage with PageHeader, PillHeaderTabs, SidebarCardDrawer, SidebarClinicLogo, ShellPageFrame, and NavContentCard, including organized layout/navigation states and direct on-board interaction.
- Added live GlobalContextMenu, NoClinicAccessGate, and SmartSuggestions states while removing runtime bootstrappers, providers, renderer registries, and fixture plumbing from the Assets component count.
- Completed the reusable layout category with a source-backed ActiveClinicSwitcher and removed auth shells, slot providers, route gates, hidden skip links, and glass rendering infrastructure from draggable Assets.
- Began reusable shared coverage with live loading screens, content skeletons, patient-empty states, procedure status controls, and the Smylr intelligence icon; delayed-module plumbing is no longer presented as a draggable component.
- Added source-backed AI building blocks for agents, tools, plans, tasks, artifacts, approvals, sources, suggestions, checkpoints, shimmer, and safe Markdown, with open/closed/error/streaming states that remain interactive on a Board.
- Added rich shared AI blocks for attachments, reasoning traces, token context, file trees, citations, branched messages, model selection, task queues, and test-result states.
- Added reusable changelog, chart, leaderboard, invite, price, and product quick-view blocks with source-backed state variants.
- Added source-backed dashboard and spark-chart widgets with metric/context/chart-form variants.
- Added a fixture-safe, source-backed patient search command with live results, empty state, filtering, and selection feedback.
- Completed reusable shared coverage with source-backed code, commit, conversation, prompt, snippet, stack-trace, terminal, profile-menu, and sortable table fixtures; all 51 shared Assets now have live states.
- Began feature-level live coverage with source-backed admin navigation, sign-out, clinic branding, morning huddle, report-center, and command-search states; remote actions use safe local fixture adapters while the production defaults remain unchanged.
- Completed patient-intake, messaging, and settings Asset families with source-backed form, inbox, thread, recipient, status, color, procedure-code, and time-pattern states; deferred route and realtime plumbing stay out of draggable Assets.
- Completed the patient check-in Asset family with source-backed completion, progress, fallback, wizard, identity, contact, medical, insurance, and consent states; the deferred route wrapper stays out of draggable Assets.
- Completed Tasks and Users Asset families with source-backed tables, row and bulk actions, empty/worklist states, create/edit/import/invite/delete workflows, confirmations, and overflow text; invisible providers and deferred route loaders stay out of draggable Assets.
- Completed the Smylr Intelligence Asset family with source-backed header, composer, message, conversation, empty, and full workspace states; Board interaction uses injected local responses instead of real AI or patient-network actions.
- Completed the Agent Asset family with source-backed logo, message, approval, command, composer, thread, message-list, and full-panel states; local Board previews avoid real agent streaming and predictive-classification requests.
- Completed the Patient Sidebar Asset family with source-backed navigation, patient search/header, insurance, metadata, overview, alerts, appointment, briefing, forms, full-sidebar, and actionable suggestion states; local previews contain search, copy-link, navigation, suggestion, and chat actions.
- Completed the Internal Communications Asset family with source-backed workspaces, conversations, call alerts, message delivery states, team pickers, typing, and video-call surfaces; realtime/context/Daily orchestration stays out of draggable Assets and every preview uses local-only actions.
- Completed the Patient Communications Asset family with source-backed inbox, conversation, compose, call, task, channel, and status states; local Board previews safely inject search and message generation, while the realtime bridge stays out of draggable Assets.
- Completed the Treatment Plan Asset family with source-backed case, procedure, financial, payment, signing, presentation, and workspace states; full editors now accept isolated fixture data and safe local navigation while preserving their production store defaults.
- Completed the Patient Onboarding Asset family with source-backed wizard, demographic, contact, insurance, medical, consent, assignment, document, duplicate, handoff, signature, and review states; renderer previews use isolated draft storage and local-only service adapters.
- Completed the Health Chart Asset family with source-backed overview, readiness, metrics, forms, history, vitals, pharmacy, prescription, and Review of Systems states; Board previews keep edits, navigation, autosave, and medication actions local while production behavior remains unchanged.
- Completed the Practice Analytics Asset family with 26 source-backed dashboards, shells, views, navigation controls, charts, metric cards, and workspaces; 59 live states support local view switching, clinic selection, employee search, chart controls, actions, and metric workspace editing.
- Completed the Calendar Asset family with 37 source-backed appointment, scheduling, dialog, day-view, month-view, filtering, and waitlist fixtures; four keyboard-shortcut, realtime-sync, and runtime-bound modules remain explicitly source-only.
- Completed 35 Dental Imaging Asset sources, including CBCT controls, real radiograph annotation, viewer chrome, intraoral grids, matrix layouts, floating images, panoramic review, and photo review; one provider/runtime module remains explicitly source-only.
- Added 35 current Dental Chart Asset sources across 59 live states, replaced deleted legacy controls with the real SurfaceSelectionBar and DentalChartImagingCanvas, and kept the remaining 21 current Dental Chart modules explicitly source-only.
- Completed all 45 current Dental Labs component sources with live fixtures covering order details, timelines, kanban states, restoration choices, logistics, review, submission, tracking, implant, orthodontic, and removable workflows.
- Expanded Patient Admin to 63 live fixtures across 59 source paths, adding appointment, referral, billing, document, family, insurance, payment-plan, and profile states; 17 route-, provider-, or service-bound modules remain explicitly source-only.
- Added 12 Accounting fixtures across 49 checked routes for metrics, statuses, row and attachment actions, connected feeds, filters, header controls, ledgers, tables, accounts, vendors, and work queues.
- Expanded Accounting to 70 live fixtures across 66 source paths with status notices, balance and journal controls, inactive-account handling, tag/category/vendor pickers, editable cells, tables, filters, column controls, ledger metrics, journal-entry views, controlled drawers, and rule states; 39 runtime- or service-bound modules remain explicitly source-only.
- Expanded Dental Chart live coverage to 49 source paths with direct charting, condition, estimate, canvas, odontogram, case-status, phase, and plan-tab components; seven browser-, provider-, or service-bound modules remain explicitly source-only.
- Completed the remaining 11 renderer-safe Primitive sources with real Data Table and Sidebar fixtures, including sorting, filtering, pagination, visibility, selection, search, navigation, layout, loading, side, and surface states.

### Changed

- Keep pointer awareness off the scene mutation path: local cursor moves are coalesced to one collaboration update per animation frame, local awareness changes no longer rebuild remote peers, and remote cursors repaint only the overlay canvas without advancing document revisions or waking autosave.
- Persist production workspaces as crash-safe per-Board snapshots behind a lightweight manifest, rewriting only dirty Boards and changed assets while retaining the previous slot and the full-document fallback for recovery.
- Keep active-Board interaction work page-local by limiting rich overlays to the current Board, releasing off-Board Code Object runtimes, stopping idle Board Experience frames, and avoiding object-graph reprojection during pan and zoom.
- Reduce startup and pointer-move work by keeping authored Three.js out of the initial bundle, routing scene-independent hover and guide updates only to the overlay canvas, and frame-coalescing live-inspector preview transport and persistence.
- Render all 22 supported Mermaid diagram families through Mermaid 11.12.1 with light- and dark-theme styling, preserve Mermaid rectangle radii as editable native rounded corners, convert the SVG result into editable native vectors and text, expose stable create/update placement through `insert_mermaid_diagram`, verify retained source and reconciliation through `get_mermaid_source`, and let people double-click into native parts or redraw the same diagram in one undo step.
- Project Markdown journey files into native editable lane boards with trusted React-derived product views, stable source IDs, state/interaction metadata, override-preserving re-import, alternate routes, labeled multi-directional paths, and feedback/rework loops; flow views no longer require iframe or snapshot surfaces.
- Index all 693 reusable Smylr component modules in organized Assets sections, with 631 source-backed live fixture entries across 623 source paths and 70 explicit source-only modules; hide six nonvisual removal candidates for 695 visible Assets total, and expand live Asset rows into calm inline variant previews that can open their source canvas or drop transparent, content-sized components onto the active Board with normal undo/redo.
- Reconcile editable Mermaid, JSON, CSV, and SVG projections against their retained source so unchanged files save exact bytes and native edits surface an explicit current/conflict state.
- Route PDF, video, audio, large raster, code, office, CAD, and other unsupported files through one source-backed intake boundary that preserves filename, MIME type, exact bytes, undo/redo, and native document reopen.
- Add offline authored Three.js experiences plus GLB and self-contained glTF viewing with persisted camera state and bounded cleanup; unsupported CAD and external-resource models remain honest retained-source fallbacks.
- Add portable OpenPencil design-library publishing and review-before-apply imports for local components and DTCG design tokens, preserving component instance links, modes, aliases, bindings, and embedded images while keeping connected Smylr assets source-backed.
- Turn the Dental Chart Flow Board into an editable app-screen journey: four real web screens now read left to right through labeled action arrows, with explicit start, finish, and return-to-edit paths; moving a screen reattaches its native labels and connectors, and first entry fits the whole journey instead of one isolated state.
- Project one stable Smylr alternate and exact lifecycle revision through Current, Flow, Focus, Compare, Knowledge, and Review, using real product artifacts, typed intent/evidence lineage, latest transition receipts, normal Undo, and independent per-view movement memory.
- Remember each Smylr view's own camera, tool, and selection, record origin receipts against the stable work-item identity, and restore the exact prior context when moving between Current and Flow.
- Keep the animated dither behind working-board canvas content so solid shapes and Mermaid diagrams no longer look transparent, while preserving the stronger empty-board atmosphere.
- Make Smylr **Add to Flow** assign ordered flow lineage, open the existing Flow Board with the same stable alternate, preserve its independent review lifecycle, and provide an exact return to Current that survives reload.
- Carry the theme-aware animated dither across the live canvas, broaden it across dark working boards, make the floating sidebar, toolbar, utility tabs, and Board dock follow light and dark themes, and reveal editor chrome after the first live board is created.
- Convert every Mermaid diagram type through Mermaid's own renderer into separate editable shapes, labels, connectors, and vector details without a forced background, preserving native gradient fills and strokes, transparency, and blend behavior for diagrams such as `sankey-beta` and `architecture-beta`.
- Make finished Trace sessions summary-first: show key outcomes by default, collapse selection/tool/viewport activity, and keep evidence as compact expandable thumbnails while preserving the full copied context.
- Keep Trace focused during refreshes and generated board rebuilds by grouping bulk canvas mutations, hard-bounding copied context, resolving Focus to the Product Map screen or live container beneath the gesture, baking annotations into the copied PNG, and rejecting blank evidence instead of storing a white screenshot.
- Open `.md` and `.markdown` files as editable native canvas documents with retained source metadata, structured Markdown blocks, and editable Mermaid diagrams for fenced Mermaid source.
- Add unified intake for Markdown/MDX/text, SVG, JSON/JSON Schema, CSV, HTML, JSX, and TSX plus dedicated Insert, paste, and drop flows for raster images, PDFs, video, and audio, retaining exact source and content-addressed binary references through native `.fig` save/reopen.
- Open the shared Smylr workspace from the normal OpenPencil home route, group its generated canvases as clearly named Boards under one Smylr Project, and keep the complete Project tree beneath compact pinned and recent Board access.
- Keep large canvases responsive by preserving absolute-position caches across repaint-only frames, culling offscreen retained subtrees, avoiding viewport-driven HTML iframe resynchronization, and committing live-frame transforms only when pointer interaction ends.
- Replace the stacked Layers, Assets, and Trace sidebar rows with a compact text-only segmented control that sits at the top normally, moves beneath Design context when it appears, and keeps one utility selected with a quiet filled active state in the existing OpenPencil palette.
- Make the Board dock behave like a macOS Dock with persistent reorderable pins, separated warm unpinned Boards, right-click Pin/Unpin and Close actions, and open-state dots independent of the active Board.
- Simplify the Board switcher header and remove decorative project count badges and the redundant current-board pin action.
- Reveal the active Board's complete nested Project path in the switcher, mark it as the current page for assistive technology, and keep Board and flow Overview fitting clear of the same visible editor chrome.
- Animate the full left sidebar plus Design, Layers, Assets, and Trace as one coordinated rail, including smooth canvas-width recovery and space-sharing when Design context appears or disappears.
- Load mobile editor chrome, AI chat runtimes, and collaboration networking only when used to reduce initial startup work and memory.
- Add Mermaid diagram import with live preview, separate editable OpenPencil board layers, one-step undo/redo, and retained source/revision metadata.
- Let MCP clients insert Mermaid source directly as native editable layers and optionally place the diagram on a named Board inside a named Project.
- Move the desktop tool strip to the top, replace the right inspector with contextual Design and Code details in the left rail, add Trace beside Layers and Assets, and move Projects into a searchable bottom board dock with persistent quick pins that scale continuously to fit the viewport. The compact switcher now prioritizes pinned and recent Boards, keeps Projects collapsed, stays open while switching Boards, and hands structural editing to a separate management view.
- Give Boards persistent selectable glyphs across the project tree, board switcher, and dock, with icon choice during creation, a compact icon dropdown while renaming, and readable title tooltips on dock hover.
- Keep up to three recently used unpinned Boards in a separate macOS-style warm section of the dock, preserve icon positions while revisiting them, use an open 8px icon and edge rhythm with 6px separator breathing room, and show dock labels immediately on hover.
- Simplify workspace organization around Projects and generic Boards, removing predefined board forms, inferred board types, the Focus/Compare/Knowledge/Review switcher, field-proof chrome, and form-specific semantic agent tools.
- Simplify the Smylr production shell to Design and Trace inspector modes, and move compact collaboration controls into the bottom toolbar.
- Unify the floating right inspector around quieter Design, Code, and Trace views, remove the AI view from this surface, and simplify the code and narrated-trace presentation with progressive disclosure.
- Rework the left sidebar into a floating, low-clutter Projects and Boards workspace with nested Projects, unlimited generic Boards, search, inline rename, drag-and-drop organization, safe deletion, and collapsible Layers and Assets.
- Add scene-backed project content with structured documents, collections, relations, components, tokens, assets, and scoped semantic MCP query/mutation tools without classifying the containing Board.
- Add the first Narrated Trace slice with browser speech capture, semantic canvas events, editable vector Ink, fading Focus trails, clean cache-backed evidence crops, editable context cleanup, durable session history, preview, and Copy Context for manual Codex handoff.
- Keep the most recent live Smylr iframe snapshot on screen during refresh and route changes, then swap to the real eager-loaded iframe as soon as its inspector bridge is ready.
- Speed up Smylr browser refreshes by loading Vite modules directly and deferring demo and automation code until after the editor mounts.
- Populate Assets with deduplicated component owners from the connected Smylr page and insert them as native editable canvas containers.
- Keep Smylr live-container edits across selection changes, add a clean Preview mode, and copy previews into native editable canvas containers.
- Add Figma-style page management in the Pages panel, including rename/delete actions and drag-and-drop page reordering.
- Add DOM/CSS import and authoring support so HTML, CSS, Tailwind, and JSX can be converted into editable OpenPencil documents from the app, CLI, and SDK.
- Add Tailwind class serialization for DOM/CSS HTML export in the SDK and CLI.
- Add standalone browser-openable HTML export with compiled CSS and optional external image/font assets.
- Add richer Design JSX authoring for components, variables, structured fills, gradients, shadows, and blur effects.
- Add overlap analysis for finding layout collisions and overflowing children from the CLI, AI tools, and MCP.
- Add saved per-node export settings for repeat exports.
- Add desktop image drag-and-drop into the Tauri app window.
- Add open-document discovery for live CLI and MCP automation so agents can target the intended document and page.
- Publish lower-level SceneGraph, Pen, Kiwi, Fig, and DOM/CSS functionality through clearer package boundaries for SDK and automation consumers.

### Fixes

- Keep moving Code Object frames, embedded Smylr surfaces, and React Flow connectors on one
  presentation frame, remove misleading moving-dash edge animation, and clip container content
  and selection chrome to the frame's rounded corners.
- Fetch complete durable board updates from Postgres after Realtime notifications so incomplete change payloads cannot interrupt cloud collaboration.
- Center a layer's corresponding node in the unobstructed canvas when it is clicked, while keeping modifier multi-selection and keyboard navigation camera-stable.
- Keep Smylr live-app frames calm by clearing persisted native fills, strokes, and effects beneath the DOM runtime and using restrained theme-aware separation.
- Treat editable Mermaid diagrams as one movable object and scale their native vectors, labels, strokes, and effects proportionally when resized, including diagrams inserted before the grouped-container fix.
- Reduce the floating sidebar shadow to a quiet separation edge so it no longer competes with canvas content.
- Snapshot reactive live-workspace data before durable projection transactions, version projection migrations explicitly, order Review by each lifecycle transition's occurrence time, and keep Compare focused on both real artifacts instead of support metadata.
- Prevent live workspace dialogs from throwing `DataCloneError` when JSON-backed arrays or records arrive through Vue's reactive wrappers.
- Keep board trackpad pan and pinch zoom working over live-app and HTML iframe surfaces, including disconnected live-app frames that cannot forward their own gestures.
- Keep the Workspace panel centered over the usable canvas with a stable height while the Board dock grows, shrinks, or changes sections.
- Keep the selected Layers, Assets, or Trace utility open when its active segment is clicked instead of leaving a blank sidebar.
- Position the active Board dock indicator beneath its icon with a clear, responsive gap instead of overlapping the icon's bottom edge.
- Automatically connect the selected Smylr Alternate to live Layers while it remains in safe frame mode, instead of leaving the sidebar stuck on Loading until interaction starts.
- Keep each Smylr Alternate's exact live state visible after clicking away, retain its runtime while switching OpenPencil pages, and restore its last visited Smylr screen if that runtime must restart.
- Focus a newly opened Board on its primary tile inside the sidebar-aware canvas without a late whole-board zoom jump, and restore each Board's prior focal point and zoom when switching back even if the sidebar width changed.
- Automatically open Layers in the Smylr sidebar whenever no Design context is available, without overriding utilities the user opened explicitly.
- Center the top tool strip and bottom board dock together within the usable canvas, shifting both through the sidebar's shared motion curve as it opens, closes, or resizes.
- Restore live Smylr container selection when OpenPencil and Smylr run on different local origins.
- Keep the Smylr Design inspector visible above Layers, Assets, and Trace when a design is selected, restore Design when Trace closes, remove its redundant live-container header, and reduce its selected-item summary to one quiet name row.
- Keep the OpenPencil sidebar title static and move the browser-only app-menu reveal to the app icon.
- Make the sidebar app icon clearly highlight on hover and give theme, language, and performance controls a dedicated Settings menu.
- Make Trace icon-only, use clearer pen and laser-pointer icons for Ink and Focus, and consolidate the toolbar dividers into one separator before Share.
- Make Focus a one-shot click or swipe that records a semantic evidence moment, releases the canvas immediately, and renders a restrained fading marker or trail without activating underlying UI.
- Keep Trace titles stable while typing, include saved titles in copied context, and remove stale browser-specific microphone warnings after recording finishes.
- Resolve CanvasKit and bundled font assets through the live `/open-pencil` mount even when the proxied Vite server was started with a root base.
- Treat Ink and Focus as mutually exclusive toolbar tools so editor tools never remain highlighted beside them.
- Start Smylr production canvases on the Move tool and preserve the active tool across browser refreshes.
- Require confirmation before deleting a Board and clearly warn that its contents cannot be recovered.
- Keep live MCP automation bound to the active OpenPencil editor when multiple browser documents are open.
- Apply MCP page, selection, and zoom-to-fit changes to the visible editor instead of only the temporary Figma API wrapper.
- Fit Smylr production frames into the canvas area left visible by the Layers panel, Inspector, and floating toolbar instead of centering them underneath editor chrome.
- Restore the same Smylr canvas page and pan/zoom view after refreshing OpenPencil in the browser.
- Fix live CLI and MCP automation drifting to the wrong open document or page when multiple files are open.
- Improve Chinese, Japanese, and Korean text rendering with glyph-aware fallback fonts and outline rendering when needed.
- Preserve imported Figma text sizing more accurately, especially auto-sized text inside auto-layout frames.
- Match Figma auto-layout reflow when deleting children, hiding optional instance slots, or syncing component changes.
- Fix desktop clipboard copy, cut, and paste when browser clipboard events are unavailable.
- Fix desktop "Share This File" links so they use the public app URL.
- Fix collaborators joining a room without receiving the current document contents.
- Fix `.fig` round-trips that could corrupt files because of duplicate generated IDs.
- Fix resizing groups and boolean operations so child layers scale with the parent.
- Fix Hangul IME composition while editing text.
- Improve large layer-tree responsiveness and keep expanded state stable while editing.
- Improve AI provider setup with a connection test and clearer errors for OpenAI-compatible endpoints.
- Fix published package type resolution for TypeScript consumers.
- Fix clone operations sharing mutable data with the original, including fills, strokes, variable bindings, overrides, and vector networks.
- Fix variable bindings left behind when fills or strokes are removed.
- Improve Figma group, boolean, instance, rotated vector, complex text fill, layout grid, page guide, pattern/noise, and other imported visual details.
- Fix file-backed CLI commands under Node by avoiding Bun-only filesystem APIs.
- Improve overlap analysis accuracy for rotated stroked nodes, nested clipping, empty limits, and trimmed filter values.

## 0.13.2 — 2026-05-30

### Changed

- Update the Homebrew install command to use the published `openpencil` cask.

### Fixes

- Fix the published MCP package so global installs include the `openpencil-mcp` and `openpencil-mcp-http` launchers required by desktop app integrations.

## 0.13.1 — 2026-05-29

### Fixes

- Fix the npm package contents for the CLI so Bun installs include the built `openpencil` binary and runtime bundle.

## 0.13.0 — 2026-05-29

### Fixes

- Fix the published CLI package so Bun global installs run the built `openpencil` binary instead of raw TypeScript sources.

- Greatly improve importing Figma `.fig` files with complex component systems: badges, avatars, icons, links, input fields, lists, date pickers, nested instances, component swaps, and variant properties now open much closer to their original Figma appearance.
- Fix missing or white content in imported `.fig` files caused by unresolved Figma variable bindings, including image/avatar badges, icon colors, text colors, and variable-backed component overrides.
- Preserve more Figma document details when opening and saving `.fig` files, including internal component pages, component ordering, page metadata, canvas backgrounds, text layout, glyph rendering, vector geometry, effects, shadows, and instance overrides.
- Keep user edits after opening an imported `.fig` file: changing size, position, fills, text, or layout now wins over preserved Figma round-trip data when the document is saved again.
- Fix `.fig` exports so files reopened in Figma or OpenPencil keep their pages, components, instances, text wrapping, icons, avatars, and preview thumbnail intact.
- Fix live canvas updates during move/resize/edit previews so visible scene changes repaint immediately.
- Fix accidental duplicate creation when Alt-clicking without dragging.
- Fix MCP startup in the browser.
- Fix CanvasKit loading outside the browser when project paths contain spaces.
- Render imported Figma layer and fill blend modes such as multiply, screen, overlay, difference, hue, saturation, color, and luminosity.
- Render common imported Figma mask stacks so visible layers above alpha, vector, or luminance masks are clipped by the mask shape, including consecutive mask layers.
- Render Figma-style smoothed rectangle corners, including independent corner radii, and effect blend modes from imported Figma files.
- Improve imported tiled image fills by applying Figma image transforms when repeating image patterns.
- Keep imported Figma boolean operations editable as boolean-operation nodes instead of flattening them to vectors.
- Apply imported variable font axes from Figma `fontVariations` when rendering text.
- Render more imported Figma visual metadata, including text decoration styles, leading trim, pattern fills, layout grids, page guides, and deterministic fallbacks for raw noise effects.

### Performance

- Open large `.fig` files faster by deferring work for pages you have not viewed yet while still preparing all needed content before export.
- Improve canvas responsiveness during zooming, panning, dragging, and editing by reusing cached scene backing where safe.
- Speed up `.fig` export for documents with many preserved Figma paint and variable payloads.

## 0.12.2 — 2026-05-19

### Added

- Allow OpenRouter users to enter any model ID from provider settings with cached autocomplete suggestions for tool-capable models, while keeping the curated dropdown as the default when no custom model is set.

### Changed

- Use localized app tooltips instead of native browser titles across editor controls, panels, and menus.
- Update Claude Code MCP setup documentation and the docs landing screenshot.
- Ignore non-source Markdown files in the app dev watcher so documentation edits do not reload the running editor.

### Fixes

- Route Claude Code stdio MCP requests through the live OpenPencil app connection, including immediate disconnected errors when no document is connected.
- Keep MCP disconnected guidance focused on starting OpenPencil and opening a document.
- Improve agent-rendered JSX compatibility with Figma-style text, alignment, and rotation aliases; strip HTML comments; and report unsupported props from render tools.
- Load exact text font styles after MCP and AI tool mutations so newly created bold/weighted text renders immediately.
- Include text style fields in MCP `get_node` output so agents can verify generated text accurately.
- Keep provider settings tooltip/popover composition working in WebKit.

## 0.12.1 — 2026-05-19

### Fixes

- Fix `.fig` round-trips for OpenPencil component sets and variable bindings, and recompute imported layouts after opening documents.
- Report desktop/MCP package version mismatches explicitly and include package-manager-aware install guidance from the MCP server.
- Support scoped MCP `save_file({ path })` workflows while keeping file saving in the desktop app.
- Use native Tauri path handling for save parent directories so Unicode and Windows paths are handled correctly.
- Fix the web font picker so Google Fonts remain available in Safari, local font access is requested on first open when supported, font sources are labeled, and Google font previews load lazily for visible rows.
- Fix background blur rendering so it blurs the backdrop behind a layer instead of applying a no-op content filter, and keep effect parameter controls visible in the properties panel.

## 0.12.0 — 2026-05-18

### Added

- Assets panel — browse, search, and insert document components directly from the left sidebar.
- Component variants — switch instance variants from the right inspector; default variant respects property definitions.
- Figma library metadata — component keys, source libraries, version IDs, descriptions, and docs links are preserved on import/export.
- Desktop file associations — double-click `.fig` or `.pen` files in Finder/Explorer to open them in OpenPencil.
- Auto-update — startup update checks and a Check for Updates menu item on desktop.
- Light theme with theme-aware canvas rulers.
- PDF export — available in the export panel, CLI (`--format pdf`), and MCP.
- SVG import tool for automation workflows.
- DeepSeek AI provider.
- Variable modes — create, rename, duplicate, delete, and set defaults per collection.
- Variable binding controls for fills, strokes, sizing, min/max, and typography fields.
- Auto-layout inspector controls for min/max dimensions, auto gap, wrap gap, and two-axis padding.
- Stroke dash/gap controls.
- Font settings — local font access, fallback predownloads, and downloaded font cache management.
- Editor commands for frame selection, paste to replace, Boolean operations, flatten, outline text, and outline stroke.
- Boolean operations panel control and canvas context-menu entries for flattening and outlining supported selections.

### Changed

- Smaller domain modules across core, app, Vue SDK, CLI, MCP, docs, and desktop with enforced package boundaries.
- Separate scene and overlay canvas layers — rulers, labels, and selections no longer cause scene redraws.
- Shared menu schema between browser and native Tauri menus.
- Editor command metadata now drives shortcut display across browser menus, native menus, tooltips, and context menus.
- Text-to-vector conversion now uses shared loaded-font outline geometry across Boolean, flatten, and outline commands.

### Fixes

- Fix `.fig` export of component variant properties and text stretch alignment so designs round-trip correctly through Figma.
- Fix CJK and Arabic text rendering — fallback fonts now load before the first paint instead of showing blank text.
- Fix large `.fig` files freezing on open — parsing runs in a worker, and the viewport fits to content after loading.
- Improve Figma import fidelity — variable aliases, nested instances, avatar swaps, badge internals, and input text alignment are preserved.
- Improve Figma export fidelity — flipped vectors, stroke geometry, visual overflow, and stroked-shape drop shadows are preserved.
- Fix variant switching so instances update their contents, not just the component reference.
- Fix text editing inside components and instances on double-click.
- Fix paste into selected containers and entered frames.
- Fix clipboard parsing to safely ignore invalid data.
- Fix undo/redo for duplicate, state restore, and modifier-key release.
- Prevent browser from intercepting app-level undo/redo shortcuts.
- Fix font loading and bundled font resolution.
- Show the startup loader until fonts load and the first render completes.
- Improve light theme polish and canvas ruler colors.
- Normalize browser zoom speed.
- Fix variable picker popovers and color binding swatches.
- Fix dashed strokes on vector nodes and gradient fills on text.
- Fix inner shadow rendering on text nodes.
- Fix imported Figma-derived underlined text rendering.
- Fix exponential `.fig` file growth on repeated save/load cycles.
- Fix opening large `.fig` files so every page populates component instances, preventing missing nested content when switching pages.
- Fix canvas size badges scaling with zoom.
- Fix layout inspector dropdown anchoring and spacing/padding icon clarity.
- Fix section drawing and color input forwarding in the property panel.
- Fix asset insertion coordinates inside entered containers.
- Fix MCP stdio handshake and eval return values.
- Fix `@open-pencil/vue` npm imports referencing an unexported core subpath.
- Fix Figma clipboard text compatibility — pasted OpenPencil text keeps editable fixed bounds, line wrapping, baselines, glyph offsets, and Figma edit-mode layout.
- Fix local font matching so requested upright and weighted faces do not fall back to italic or regular faces.
- Fix CanvasKit paragraph rendering to preserve requested text weights and slants.
- Fix nested text editing interactions — drill double-click enters nested text edit mode, and clicking another text node switches edit targets while editing.
- Fix auto-height text edit commits so text bounds and undo state stay in sync.
- Fix Boolean, flatten, and outline operations to reject unsupported image/complex-script sources safely instead of silently dropping geometry.
- Fix outline stroke enablement for stroked descendants inside groups and containers.

### Performance

- Event-driven canvas rendering — scene and overlay layers only repaint when their inputs change, replacing continuous polling.
- Shared RAF scheduler coalesces scene and overlay frames into a single animation frame per editor.
- Font-family fallback arrays and downloaded remote fonts are cached to avoid repeated work.
- WebGL draw-call instrumentation only runs while the profiler is active.
- Instance override resolution is cached and `.fig` pages load lazily for large files.
- Live drag/resize uses repaint-only previews to skip layout during interaction.

## 0.11.8 — 2026-04-23

### Fixes

- Fix MCP server not spawning on Windows — use `cmd /c` to resolve `.cmd` wrappers from npm global installs
- Fix MCP server and automation WebSocket not connecting on Windows/Linux — inline `__TAURI_INTERNALS__` check at call time instead of using stale module-level `IS_TAURI` constant
- Fix shell PATH not inherited by GUI app on macOS/Linux — add `fix-path-env-rs` to read shell config

## 0.11.7 — 2026-04-22

### Features

- Add stdio transport for MCP server — `openpencil-mcp` now works as a proper stdio MCP server for Claude Code, Cursor, etc. HTTP server available as `openpencil-mcp-http`.
- Default canvas background to dark when system prefers dark color scheme
- Add `list_available_fonts` MCP tool for font discovery
- Copy node ID / XPath from context menu; CLI selection command
- Arrow key nudge for selected nodes (1px, Shift+arrow for 10px)
- JSX renderer: `position="absolute"`, `top`, `left` props for absolute children inside auto-layout containers
- MCP server sends `notifications/tools/list_changed` when the desktop app connects or disconnects
- Headless text measurement via opentype.js per-glyph advance widths — no CanvasKit needed
- Add `open_file` and `new_document` MCP tools with `OPENPENCIL_MCP_ROOT` path scoping
- Optional `path` param on `export_image`, `export_svg`, `get_jsx` — write output to disk instead of returning base64/string
- Multi-root JSX support — multiple top-level elements auto-wrapped in a fragment
- `Component` and `Instance` tag aliases in JSX renderer
- JSX prop reference doc — copy to clipboard via book icon in Code panel
- Prompts (`CODEGEN_PROMPT`, `JSX_REFERENCE`) moved from embedded strings to markdown files

### Fixes

- Fix Backspace not deleting selected nodes after clicking on canvas — canvas now receives focus on click so keyboard shortcuts aren't blocked by stale input focus
- Support Cmd/Ctrl+click for additive multi-select in layers panel (previously only Shift+click worked)
- Fix macOS Tauri build — move `NSAllowsLocalNetworking` ATS config from invalid `tauri.conf.json` property to a proper `Info.plist` file
- Fix tab order and keyboard handling in inspector panel
- Fix design token variables not resolved before passing to yoga-layout
- Suppress keyboard shortcuts while editing property panel inputs
- Fix tooltip competing with popover trigger on Windows
- Fix hit area for nodes with rotated parents
- Error toasts auto-dismiss, deduplicate, and cap stack at 5
- Bump yoga-layout to 3.3.0-grid.3 with `Node.free()` support
- Bump PWA precache limit for canvaskit-webgpu
- Fix color picker dragging flooding the undo stack — fill/stroke/effect color and opacity drags now collapse into a single undo entry per interaction via debounced batching in `PropertyListRoot`
- Fix .fig import crash on alias variables without a GUID
- Fix `save_file` crash on vectors with missing tangent control points — default to straight segments
- Validate `create_vector` path JSON upfront with clear error messages for malformed input
- Fix MCP/AI tools rejecting string-encoded numeric arguments from MCP clients (`"42"` → `42`)
- Fix "Create Instance" context menu item always grayed out — inverted disabled flag
- Show "Create Instance" instead of "Create Component" in context menu when a component is selected
- Fix headless layout: use stored .fig dimensions instead of rough text size estimates (26K → 11K mismatches on material3.fig)
- Fix `--help` output with huge vertical gaps between commands — remove inline examples from query description
- Fix `openpencil-mcp` npm package missing `dist/stdio.js` — explicitly list entry points in tsconfig
- Show toast when MCP server fails to start instead of silently swallowing the error
- Fix provider settings popover not appearing — tooltip wrapper broke floating-ui positioning
- Fix `set_font_range` producing invalid style runs that crash `.fig` export — use `applyStyleToRange`, apply color and fontWeight from style name
- Fix MCP "app not connected" error — message now instructs the agent to stop and inform the user
- Fix external links in AI panel blocked by Tauri ACL — use opener plugin instead of shell

## 0.11.6 — 2026-04-08

### Fixes

- Switch `@open-pencil/core` build from `tsgo` + `fix-esm-import-path` to `tsdown` — fixes bare directory imports that broke Node.js and Bun consumers

## 0.11.5 — 2026-04-08

### Fixes

- Fix published npm packages resolving to TypeScript source instead of compiled JavaScript — `publishConfig.exports` overrides are now applied during CI publish
- Fix Windows CI build failures caused by backslash file paths in custom lint rules

## 0.11.4 — 2026-04-08

### Fixes

- Fix `@open-pencil/core` published package containing stale import paths from before the domain module restructuring — CLI and MCP installs from npm now resolve correctly
- Add `save_file` MCP tool for saving the current document to disk
- Clipboard text export now writes richer v4 `derivedTextData` payloads with glyph outlines for better paste fidelity

## 0.11.3 — 2026-04-08

### Fixes

- Show actionable install errors in the chat panel when a required local AI CLI is missing
- Fix inline layer rename so clearing the name restores the default name, and Backspace/Delete inside rename inputs no longer delete the layer
- Fix rotated frame hit testing, hover highlights, and selection overlays so interactive areas and overlay labels stay aligned during rotation
- Fix text edit undo so it restores both the original text and `styleRuns`
- Pressing Enter with a selected text node now starts text editing and selects all text
- Fix `ScrubInput` Enter handling so committing a value no longer triggers a second blur-based commit that overwrites it
- Show the auto-layout panel for `COMPONENT`, `COMPONENT_SET`, and `INSTANCE` nodes
- Fix missing layout direction icons in the auto-layout controls
- Fix nested text selection inside gradient cards
- Unify the size control into a single inline sizing input/dropdown with shorter localized labels to prevent overflow

## 0.11.2 — 2026-03-30

### Fixes

- Stabilize npm publishing with isolated temp publish directories instead of mutating tracked package manifests in CI
- Strip build-time scripts and dev dependencies from generated publish manifests so tarballs pack from verified artifacts only
- Fix `@open-pencil/mcp` release packaging so the published npm tarball includes its built `dist/` CLI and server entrypoints deterministically
- Fix `@open-pencil/core` release build configuration so CI publish jobs include Node and Bun ambient types when compiling package artifacts

## 0.11.1 — 2026-03-30

### Fixes

- Fix npm publishing pipeline to publish packed tarballs instead of raw package folders
- Attempt to fix `@open-pencil/mcp` npm package contents so the published CLI includes its built `dist/` entrypoints
- Fix `@open-pencil/vue` npm package metadata and build output so the published package resolves from `dist/` while local workspace development keeps using source aliases

## 0.11.0 — 2026-03-30

### Features

- Lock and visibility toggle buttons in layers panel (hover to reveal, always shown when active)
- Figma-style selection scope — double-click to enter groups/frames/components, Escape to exit
- Nested container navigation — each double-click goes one level deeper
- Dashed border around entered container for visual feedback
- Layer panel click syncs canvas scope automatically
- Vue SDK internationalization primitives — `useI18n()`, locale detection, persisted locale selection, lazy-loaded locale JSON files, and exported locale metadata for custom editor shells
- Vue SDK docs and public API audit — documented advanced exports (`useOkHCL()`, variables helpers, viewport and locale APIs), aligned docs with the actual `provideEditor()` injection model, and expanded release-ready SDK guidance
- npm release pipeline now publishes `@open-pencil/core`, `@open-pencil/cli`, `@open-pencil/mcp`, and `@open-pencil/vue` together on version tags
- App language picker in the menu bar — switch UI locale without reloading
- Added a vector curve editor and improved drawing experience with the pen tool
- Resume pen drawing from existing open path endpoints — click an endpoint to continue the curve
- Close open paths by dragging one endpoint to the other
- Align selected anchor points relative to each other in vector edit mode — the standard alignment buttons in the position panel now operate on selected vertices when 2 or more are selected
- Unified core IO format registry — `.fig` is now modeled as the native document format alongside shared export adapters for PNG, JPG, WEBP, SVG, and JSX
- Export selection or current page as `.fig` from the app export UI and app menu
- New CLI commands: `open-pencil convert` for document conversion, `open-pencil formats` to inspect readable/writable/exportable formats, and `open-pencil lint` for design consistency, structure, and accessibility checks
- CLI export now supports `.fig` output and routes PNG/JPG/WEBP/SVG/JSX/`.fig` through the shared IO layer
- `Open…` now supports `.pen` Pencil documents through the shared document reader pipeline while keeping `.fig` as the native save format
- Display‑P3 document color space pipeline — documents now default to Display‑P3, `.fig` import/export preserves document color profiles, the live canvas requests P3 surfaces with sRGB fallback, and raster/SVG export paths accept explicit color-space targets
- Color picker overhaul — unified `RGB` / `HSL` / `HSB` / `OkHCL` field formats, slider-space-aware track/thumb previews, and better neutral-color editing behavior for fills, strokes, gradient stops, and component fills
- OkHCL metadata now round-trips through `.fig` plugin data and integrates directly into the main fill/stroke color workflow with preview gamut diagnostics
- Vue SDK now exposes reusable color-picker model helpers and solid fill/stroke commit helpers for custom editor shells
- Update built-in Z.ai and MiniMax model lists — Z.ai now uses the Anthropic-compatible endpoint for GLM coding models, adds GLM-5.1, and MiniMax adds M2.7 / M2.7-highspeed
- Arabic and RTL support across text rendering, editing, layout, export, and AI tooling — text nodes support `Auto`/`LTR`/`RTL`, auto-layout frames support `Auto`/`LTR`/`RTL` flow, and JSX/AI prompts/tools can now generate and edit both explicitly

### Fixes

- Fix shortcuts, now work on non-English keyboard layouts.
- Fix imported `.fig` file open and page-switch regressions — loaded documents now keep graph/store state in sync, remap imported canvas/page children correctly, and recompute imported auto-layout descendants when switching pages
- Fix first canvas render happening before fonts load — wait for fonts before the initial draw to avoid Safari and text measurement glitches
- Preserve `fig-kiwi` version on `.fig` roundtrip — imports keep the original header version instead of rewriting everything to a hardcoded value; new files default to version 101
- Normalize auto-layout text export for Figma — text children inside auto-layout frames now serialize with `NONE` auto-resize to match Figma behavior and avoid overflow on reimport
- Fix keyboard editing regressions after the refactor — canvas shortcuts no longer fire while editing text, and Delete/Backspace no longer delete nodes during text entry
- Fix MCP page switching persistence — `switch_page` now survives across tool calls in the same session
- Improve CJK font fallback coverage — load multiple Google Fonts for broader Han/Japanese/Korean text support
- Normalize more visible UI strings for localized app chrome — menus, panels, variables dialog, code panel, chat setup, and editor controls now respect the selected locale instead of falling back to English in common flows
- Fix imported text rendering in browser and headless export — preserve stored bounds until fonts are ready, restore missing font-loaded guards, use natural width for `WIDTH_AND_HEIGHT` text, and clip text to node bounds
- Fix browser/headless rendering mismatch for imported toolbar/instance content by correcting runtime imported layout recomputation instead of diverging browser rendering behavior
- Fix `set_layout` tool not defaulting to HUG sizing when enabling auto-layout — frames now shrink/grow to fit children instead of keeping fixed dimensions
- Normalize font family names on `.fig` export — strip optical size suffixes (e.g. "DM Sans 9pt" → "DM Sans") so Figma recognizes the font
- TEXT nodes now default to a solid black fill — previously exported with no fill, making text invisible when opened in Figma
- Fix save crash when COLOR variable is missing alpha channel
- Fix console error spam on deployed web app from automation WebSocket reconnect loop
- Fix headless CLI font fallback — bundled Inter font now ships with `@open-pencil/core` and loads without a web server
- Locked nodes now block move, resize, rotate, and delete on canvas
- Locked containers block double-click enter
- Marquee selection skips locked and hidden nodes
- COMPONENT/INSTANCE containers are now enterable via double-click
- Replaced the alignment and reflection icons with the correct ones

## 0.10.0 — 2026-03-15

### Performance

- Offload .fig parsing (unzip + Kiwi decode) to a Web Worker — main thread stays responsive during file open
- Offload .fig compression to a Web Worker during save (was blocking 450ms+)
- Add instance index (`componentId → Set<nodeId>`) — `getInstances()` is O(1) instead of scanning all nodes
- Defer graph event subscription until after layout computation during file open — eliminates redundant `syncInstances` calls
- Cache label collection (sections/components) per scene mutation instead of walking the full tree every frame
- Blocking font loading — fonts load before first render to ensure correct glyphs

### Features

- ACP agent support — use Claude Code, Codex, or Gemini CLI as AI assistants in the desktop chat panel
- Permission confirmation dialog — ACP agents request user approval for file/shell operations, MCP design tools auto-approved
- Unified MCP server — single HTTP + WebSocket proxy replaces Vite SSR bridge
- Stock photo integration — `stock_photo` tool fetches images from Pexels or Unsplash and applies to design nodes. Provider adapter supports custom providers.
- Skeleton-first AI workflow — 4-phase design process (plan → skeleton → content fill via `replace_id` → polish) for more reliable AI-generated layouts
- Batched AI tools — `calc` accepts arrays of expressions, `stock_photo` fetches all images in parallel, `batch_update` applies multiple property changes in one call, `describe` accepts `ids` array for multi-node inspection
- AI visual feedback — blue pulsing border on nodes being modified, green flash on completion
- Auto-depth `describe` — adapts inspection depth to subtree size (small block → deeper, large page → shallower)
- `set_fill` gradient support — linear gradients with `color_end` and `gradient` direction params
- `render` tool `replace_id` — atomically swap skeleton placeholders with real content
- MCP `export_image_file` tool for headless PNG rendering
- Grid layout in AI chat — JSX renderer supports `grid`, `columns`, `rows`, `gap` props
- Configurable max output tokens in AI provider settings (default 16384)
- Z.ai AI provider with GLM-5, GLM-4.7, GLM-4.6, GLM-4.5 model families
- MiniMax AI provider with M2.5, M2.1, M2 models

### Improved .fig import fidelity

- Resolve variable-bound fill colors through alias chains
- Fix SCALE constraint resizing for auto-layout instances
- Propagate SCALE constraints through instance clone chains
- Skip self-referencing symbolOverrides on nodes with explicit kiwi properties
- Fix DSD resolution for swapped instance children
- Fix instance swap override propagation through clone chains
- Fix component property override resolution through clone chains
- Fix text/property overrides clobbered by second transitive sync

### Fixes

- Fix text rendering with wrong fonts on file open — all font weights (including default family) are now loaded before the first render
- Fix `weightToStyle` mapping: weight 400 now correctly maps to "Regular" instead of "Medium"
- Fix detached ArrayBuffer crash when switching pages after saving — export worker now copies image buffers before transferring
- Show warning toast when fonts fail to load, error toast when file open fails
- Fix FillPicker crash when selecting image fills (missing `ref` import from #92)
- Fix Google Fonts TLS/network errors not cached — failed families no longer retry on every render
- Fix CJK text garbled when font is unavailable — fallback now renders through paragraph shaper instead of raw `drawText`, preserving CJK characters via the fallback font chain
- Fix auto-layout overflow in AI-generated designs — text wrapping, min/max constraints, absolute positioning, and FILL sizing now work correctly
- Fix `layoutAlignSelf` limited to STRETCH — full range supported (CENTER, MAX, MIN, BASELINE)
- Fix hidden auto-layout children losing their dimensions on layout recompute
- Fix ProviderSettings popover not visible in AI chat
- Fix paste/copy/cut intercepted by canvas in AI chat input
- Strip TypeScript casts from AI-generated JSX (`as any`, `as const`)
- Fix parsing complex .fig files crashing on missing GUIDs in component overrides
- Fix headless text layout using 100×100 default size instead of estimated dimensions — multi-line wrapping now estimated correctly
- Fix clipboard roundtrip losing properties — clipsContent, constraints, arcData, strokeCap/Join, layoutAlignSelf, textAutoResize, autoRename now preserved in Figma Kiwi serialization
- Fix MCP headless export crashing on `window.queryLocalFonts` in non-browser runtimes (Bun/Node)
- Fix MCP `export_image` rendering blank text — fonts now loaded before rasterization
- Fix text always using paragraph rendering with Inter fallback chain (no more missing-font garbling)
- Clip children to rounded corners when `clipsContent` is true
- Use child shape for drop shadows on transparent containers
- Treat `FOREGROUND_BLUR` as layer blur wrapping children
- Fix radial, angular, and diamond gradient rendering
- Fix .fig export roundtrip: variable GUIDs colliding with document
- Fix file open dialog not working on first click in Safari
- Skip variable fonts from local font access, use Google Fonts instead
- Disable autosave by default

## 0.9.0 — 2026-03-09

### Features

- XPath query command — `open-pencil query design.fig "//FRAME[@width < 300]"` to find nodes by type, attributes, and tree structure using XPath selectors
- CSS Grid layout mode — select a frame, click the grid icon in the auto layout toolbar to switch from flex to grid. Configure column/row tracks (fr, fixed px, auto), column and row gaps, and per-side padding. Powered by a [Yoga fork](https://github.com/open-pencil/yoga/tree/grid) with cherry-picked CSS Grid PRs from upstream
- JSX and Tailwind CSS export for grid layouts — `grid grid-cols-N`, `gap-x-*`/`gap-y-*`, child `col-start-*`/`row-start-*`/`col-span-*`/`row-span-*`
- Multi-provider AI support — connect to Anthropic, OpenAI, Google AI, or any OpenAI-compatible endpoint directly, in addition to OpenRouter. Per-provider API key storage, provider settings popover, automatic migration from single OpenRouter key
- Anthropic-compatible provider for custom API endpoints
- New AI tools: `get_jsx` (JSX roundtrip view), `diff_jsx` (structural diff), `describe` (semantic role, visual style, layout, design issues)
- AI visual verification — `export_image` returns image content to the model for vision-based review
- API type toggle (Completions/Responses) for OpenAI-compatible providers
- Figma zoom shortcuts — ⌘0 (100%), ⌘1 (zoom to fit), ⌘2 (zoom to selection), ⇧1/⇧2 alternatives
- XPath query tool — `query_nodes` for AI/MCP with attribute selectors, tree traversal, and type filtering

### Fixes

- Serialize variables, collections, and bindings to `.fig` files — previously lost on save (#65)
- Text nodes created via MCP now render in Figma — emit `derivedTextData` with font metadata and layout size (#64)
- Double-click on layer tree no longer toggles expand/collapse — use the chevron instead
- Page rename input matches layer rename styling
- Fix `w="fill"`/`h="fill"` in JSX renderer — now direction-aware based on parent flex axis
- Fix text auto-resize defaulting to fixed 100×100 — text without explicit width uses `WIDTH_AND_HEIGHT`
- Fix `clipsContent` not propagated to Yoga — frames with clip enabled now set `Overflow.Hidden`
- Fix `COUNTER_ALIGN_MAP` mapping stretch to `MIN` instead of `STRETCH`
- Fix JSX export omitting x/y for absolute-positioned children
- Fix JSX export ignoring `textAutoResize` for text sizing
- Fix drag terminating on mouseleave — drags now continue outside the canvas
- Fix `export_image` stack overflow on large nodes — chunked base64 encoding
- Undo support for auto-layout reorder, layer tree reorder, and drag reparent
- Page snapshot undo for AI tool mutations
- Fix collab sync for same-parent reorder — `node:reordered` events now propagated to Yjs peers
- Fix orphaned instances on clipboard paste — detach to FRAME when component is missing
- Fix text typography lost on Figma clipboard import — preserve fontFamily, fontWeight, fontSize, lineHeight
- Fix `copyFill` missing `gradientTransform` and `imageTransform` — gradient fills now round-trip correctly

### Performance

- Event-driven rendering and component sync — `SceneGraph` emits typed events on mutations; `requestRender()` calls reduced from 94 to 22, component instance sync uses microtask batching with deduplication
- Replace `structuredClone` with typed copy helpers for fills, strokes, effects, and style runs (~24× faster in hot paths)
- Filter .fig unzip to only decompress canvas and image entries, skipping metadata cruft

### Improvements

- Padding on a frame auto-enables vertical auto-layout
- AI tools run `computeAllLayouts` after execution — layout updates immediately
- Enhanced AI system prompt with full JSX prop reference and verification workflow
- Chat panel preserves messages when toggling UI visibility
- SceneGraph event bus (nanoevents) — `node:created`, `node:updated`, `node:deleted`, `node:reparented`, `node:reordered` events replace monkey-patching in collab sync and manual render invalidation
- Replace esbuild-wasm (14 MB) with sucrase (201 KB) for JSX transform — `buildComponent()` and `renderJSX()` now synchronous and browser-compatible
- `useMagicKeys` keyboard shortcut system — replaces tinykeys with VueUse built-in, cross-platform Meta/Control handling, modifier exclusion for combo conflicts
- Dev-only debug toolbar for copying chat logs
- Auto-layout icons in layer tree — vertical (rows), horizontal (columns), and grid icons for auto-layout frames; components keep their purple diamond
- Frame titles on canvas are now draggable — clicking a selected top-level frame's name label starts a drag
- Compact layout controls — icon-based gap (↔/↕) and padding (T/R/B/L) inputs instead of text labels
- Auto-detect horizontal vs vertical direction when wrapping in auto layout (Shift+A)
- Fix alignment grid for vertical layouts — visual positions now match spatial axes
- Fix grid switch from HUG-sized frames — frame expands to fit children
- Remove unwanted white fill when wrapping in auto layout

## 0.8.0 — 2026-03-07

### Features

- Mobile layout & PWA — responsive editor with touch-optimized toolbar, swipeable bottom drawer (layers/properties/design/code), HUD overlay, and installable PWA with icons and service worker
- Tailwind CSS v4 JSX export — export selections as HTML with Tailwind utility classes (`<div className="flex gap-4 p-3">`) from the Code panel, CLI (`bun open-pencil export --format jsx --style tailwind`), or programmatically via `sceneNodeToJSX(id, graph, 'tailwind')`. Supports layout, sizing, colors, border radius, opacity, rotation, overflow, shadows, blur, and typography. Uses v4 spacing semantics (px/4 multiplier) with automatic fallback to arbitrary values.
- Code panel format toggle — switch between OpenPencil (custom components) and Tailwind (HTML + utility classes) output
- Homebrew tap — `brew install open-pencil/tap/open-pencil` for macOS (arm64 + x64), auto-updated on each release
- Double-click to rename layers — inline rename in layer panel, shared `useInlineRename` composable
- New AI/MCP tools: `analyze_colors`, `analyze_typography`, `analyze_spacing`, `analyze_clusters`, `diff_create`, `diff_show`, `get_components`, `get_current_page`, `arrange`, `node_to_component`
- CLI-to-app RPC bridge — all CLI commands work against the running app when no file is specified. Start the app, then run `bun open-pencil tree` to inspect the live document
- VitePress docs site — user guide, reference, architecture, and development docs at openpencil.dev with 6 locales (en, de, fr, es, it, pl), SEO (OG tags, hreflang, JSON-LD, sitemap), and dark theme

### Improvements

- Refactor mobile drawer tabs, layout sizing dropdowns, and inline rename to use Reka UI primitives
- Add shared UI style helpers with tailwind-variants for menus, selects, buttons, and surfaces
- Unified tool definitions — define once in `packages/core/src/tools/`, automatically available in AI chat, CLI, and MCP
- Harden FigmaAPI — hide internals via Symbols, freeze arrays, fix `layoutSizing`, 30+ new properties and methods
- Split tools into domain files (read, create, modify, structure, variables, vector, analyze) — easier to navigate and extend
- Replace inline type definitions with named types (`Color`, `Vector`, `SceneNode`) across the codebase
- Split 3200-line `renderer.ts` into `packages/core/src/renderer/` with 10 focused files (scene, overlays, fills, strokes, shapes, effects, rulers, labels)
- Centralize all color utilities in `packages/core/src/color.ts` — `colorToHex8`, `colorToCSSCompact`, `normalizeColor`, `colorDistance`; remove 5 duplicate implementations across the codebase
- Add `geometry.ts` with shared rotation math (`degToRad`, `radToDeg`, `rotatePoint`, `rotatedCorners`, `rotatedBBox`)
- Extract `isArrayMixed()` helper for multi-selection property panels

### Fixes

- Fix drawer animation jump on close — single spring transition instead of two-phase
- Fix `ALL_TOOLS` registry missing newer tools (`analyzeColors`, `diffCreate`, `exportImage`, `arrangeNodes`)
- Fix `renderJSX` typo in tool definitions (`renderJsx` → `renderJSX`)
- Fix all oxlint warnings and tsgo errors — replace `!` non-null assertions in `use-collab.ts` with local const captures
- Fix broken test imports — stale `../../src/engine/` paths updated to `@open-pencil/core`
- Fix flaky E2E tests: layers panel navigates to `/demo`, zoom-to-fit test zooms in first, snapshot rendering stabilized with `workers: 1` and `colorScheme: dark`
- Fix bogus .fig import mappings for `expanded` and `strokeMiterLimit` fields
- Fix PWA manifest error in dev mode, handle invalid font data gracefully
- Fix eval response unwrapping and `export_jsx` page selection in RPC bridge
- Fix automation commands not recomputing layouts after mutations
- Fix workspace dependency not resolved when installing from npm (switch CI to pnpm publish)

### Internal

- Add `motion-v` for declarative animations — used in mobile drawer (spring-animated height with pan gestures) and toolbar (layout-animated category switching with directional slide transitions)
- Mobile drawer: replace `useSwipe` + manual rAF animation with `motion.div` `:animate` + `@pan`/`@panEnd`; always-on tab state (no more null `activeRibbonTab`); content stays rendered when closed
- Mobile toolbar: replace manual `scrollWidth` measuring + inline CSS transitions with `motion.div layout` + `AnimatePresence` directional slide variants
- Mobile UI cleanup: extract shared `colorToCSS` util to core, `initials` to `src/utils/text`, `toolIcons` to `src/utils/tools`; replace hand-rolled dropdowns with reka-ui Popover/DropdownMenu; narrow `mobileDrawerSnap` type to string union; move magic numbers to constants; disable PWA service worker in dev mode
- 83 new E2E tests (57 → 140): design panel, code panel, components, copy/paste, multi-page, text editing, keyboard shortcuts, context menu
- 150 new unit tests (588 → 738): color, undo, snap, vector, style-runs, text-editor
- 48 new E2E tests (9 spec files) + 26 mutation unit tests + store/canvas test helpers
- Add `data-test-id` attributes to AppearanceSection, LayoutSection, TypographySection, VariablesDialog, EditorView

## 0.7.0 — 2026-03-05

### Features

- SVG export — export selections as SVG from the export panel, context menu, CLI (`bun open-pencil export --format svg`), or MCP/AI tools (`export_svg`). Supports rectangles, ellipses, lines, stars, polygons, vectors, text with style runs, gradients, image fills, effects, blend modes, clip paths, and nested groups (#46)
- Copy/Paste as submenu in context menu — Copy as text, Copy as SVG, Copy as PNG (⇧⌘C), Copy as JSX
- Stroke align (Inside/Center/Outside) with clip-based rendering matching Figma behavior
- Individual stroke weights per side (Top/Right/Bottom/Left) with side selector dropdown
- Google Fonts fallback — automatically loads fonts from Google Fonts API when not available locally
- Auto-save toggle in File menu — disable to prevent automatic writes to the opened .fig file
- Renderer profiler with in-canvas HUD overlay, GPU timing, and phase instrumentation

### Improvements

- Replace custom color picker with Reka UI Color components (ColorArea, ColorSlider, ColorField) — adds keyboard navigation and accessibility to the color area, hue, and alpha controls

### Fixes

- CJK text rendering — load a system CJK font (PingFang SC, Microsoft YaHei, Noto Sans CJK) as fallback; falls back to Noto Sans SC from Google Fonts when no system font is available (#48)
- Font registration errors no longer cache invalid font data — `loadFont` only caches after successful CanvasKit registration
- Fix `render` tool failing on Windows + Bun with "Cannot find module" error (#43)
- Fix hover highlighting nodes from internal component pages — scope hit-test to current page
- Fix hit-testing on transparent frames and groups — empty containers without fills or strokes are now click-through, clipping parents reject hits outside their bounds, matching Figma behavior
- Fix instance overrides on .fig import and clipboard paste — resolve guidPaths by overrideKey, handle component swaps (`overriddenSymbolID`), propagate through nested clone chains. Import and paste now share a single override engine.
- Apply Figma component property assignments on import — boolean visibility toggles and instance swaps via `componentPropRefs`/`componentPropAssignments`
- Apply `derivedSymbolData` sizes on import — containers now shrink correctly when component properties hide children
- Fix override resolution for nested instance targets — check the current node before searching descendants
- Fix component property assignments for nested instances — resolve scoped `componentPropAssignments` inside `symbolOverrides` via guidPath, handle `guidValue` for instance swaps, reorder phases so transitive sync doesn't clobber visibility
- Pixel-perfect vector rendering using pre-computed `fillGeometry`/`strokeGeometry` blobs from .fig files — eliminates white gaps between adjacent stroked shapes
- Stroke outlines on clipboard paste — convert vectorNetwork paths to filled outlines via CanvasKit when geometry blobs are unavailable
- Apply `derivedSymbolData` transforms and geometry during import — instance children render at correct scale and position
- Fix internal pages becoming visible after .fig round-trip — preserve `internalOnly` flag on export
- Scope layout recomputation to current page for paste/undo/font-load (major speedup on large multi-page files)
- Show loading overlay until all document fonts are loaded (no more partially rendered text)
- Load fonts when switching pages (previously only loaded for the first page)
- Always show visibility toggle on fill, stroke, and effect rows (matches Figma)
- Fix renderer crash on double destroy when closing files quickly
- Fix .fig page ordering — use deterministic byte comparison for fractional index positions
- Fix text truncation using `textTruncation` field instead of `textAutoResize`
- Fix horizontal scrollbar on design and pages panels
- Style scrollbars for Tauri (thin dark overlay instead of default OS chrome)
- Enable file watcher in Tauri — `watch` feature was missing from `tauri-plugin-fs`

## 0.6.0 — 2026-03-04

### Features

- Multi-selection properties panel — edit position, size, appearance, fill, stroke, and effects across multiple selected nodes
- Shared values display normally, differing values show "Mixed"
- W/H inputs in multi-selection mode
- Flip horizontal/vertical using scale transform instead of rotation
- Single-node alignment aligns to parent frame bounds
- ACP agent package — Agent Communication Protocol server for AI coding tools, reusing core ToolDefs

### Build

- Apple code signing and notarization for macOS builds
- Git LFS storage moved from GitHub to Cloudflare R2

### Fixes

- Fix Figma clipboard paste: extract shared kiwi→SceneNode conversion, fixing broken auto-layout, missing gradient/image fills, effects, style runs, and text properties
- Fix vector rendering on paste — scale path coordinates from Figma's normalizedSize to actual node bounds
- Fix pasted instances having no children — populate from component via symbolData when both are in clipboard
- Detect component sets on import — promote FRAME nodes with VARIANT componentPropDefs to COMPONENT_SET
- Skip internal canvas on paste — components on Figma's hidden internal page populate instances but are not pasted as visible nodes
- Apply instance overrides on paste — text content, fills, visibility, layoutGrow, and textAutoResize from symbolOverrides
- Fix auto-layout child ordering — sort by geometric position instead of z-order position strings
- Load fonts on paste and .fig import — collect font families from text nodes and load into CanvasKit
- Text measurement in auto-layout — use CanvasKit paragraph metrics for WIDTH_AND_HEIGHT text nodes
- Recompute layouts after font loading completes
- Fix PERCENT line height conversion — was stored as raw value instead of pixels
- Fix InvalidCharacterError when copying nodes with non-ASCII text
- Load all font weight/style variants needed by pasted text nodes
- Fix font loading not registering in core cache
- Fix halfLeading applied to text measurement — enable only for rendering
- Clear hover on zoom/pinch to keep scene picture cache valid
- Fix flip buttons using rotation math instead of actual mirroring
- Fix flip transform encoding — scale first matrix column only (was incorrectly producing 180° rotation)
- Decode flip state from .fig transform matrix on import

## 0.5.1 — 2026-03-03

### Fixes

- Fix File → Save crash when document has layer blur effects

## 0.5.0 — 2026-03-03

### Features

- Effects rendering: drop shadow, inner shadow, shadow spread, layer blur, background blur, foreground blur
- Text shadows render on glyphs instead of bounding box
- Multi-file tabs — open multiple documents in tabs within a single window
- Tab bar with close buttons, middle-click to close, and new tab (+) button
- Keyboard shortcuts: ⌘N/⌘T new tab, ⌘W close tab, ⌘O opens in new tab
- Native Tauri menu: File → New and File → Close Tab wired to tab actions
- Render text from SkPicture cache when fonts are missing — pixel-perfect display without the font installed
- Missing font indicator (⚠) next to font picker in the sidebar
- Right-click context menu on layers panel — same actions as the canvas context menu
- 40+ new AI/MCP tools ported from figma-use:
  - Granular set tools: `set_rotation`, `set_opacity`, `set_radius`, `set_minmax`, `set_text`, `set_font`, `set_font_range`, `set_text_resize`, `set_visible`, `set_blend`, `set_locked`, `set_stroke_align`
  - Node operations: `node_bounds`, `node_move`, `node_resize`, `node_ancestors`, `node_children`, `node_tree`, `node_bindings`, `node_replace_with`
  - Variable CRUD: `get_variable`, `find_variables`, `create_variable`, `set_variable`, `delete_variable`, `bind_variable`
  - Collection CRUD: `get_collection`, `create_collection`, `delete_collection`
  - Boolean operations: `boolean_union`, `boolean_subtract`, `boolean_intersect`, `boolean_exclude`
  - Vector path tools: `path_get`, `path_set`, `path_scale`, `path_flip`, `path_move`
  - Create tools: `create_page`, `create_vector`, `create_slice`
  - Viewport: `viewport_get`, `viewport_set`, `viewport_zoom_to_fit`, `page_bounds`
  - Misc: `flatten_nodes`, `list_fonts`
- `set_text_properties` tool: alignment, auto-resize, decoration
- `set_layout_child` tool: sizing, grow, align_self, positioning
- 13 MCP server integration tests via `InMemoryTransport`

### UI

- Resizable pages/layers split in left panel with reka-ui Splitter
- Layers tree auto-expands and scrolls to reveal selected node
- Loading overlay on canvas while opening .fig files
- Hide internal-only pages (e.g. "Internal Only Canvas" in design systems)
- Render page dividers — pages named with only dashes/asterisks/spaces show as horizontal lines
- Only show component labels for COMPONENT and COMPONENT_SET, not instances
- Replace all native `<select>` dropdowns with reka-ui `AppSelect` component
- Smoother trackpad pinch-to-zoom with `Math.exp` curve and deltaMode normalization
- Fix font picker dropdown truncating long font names
- Show explanation in font picker when Local Font Access API unavailable (Safari/Firefox)

### Fixes

- Fix drop shadow rendering on top of fills — shadow now draws behind opaque content
- Fix effect property changes not recorded in undo/redo history
- Fix active tab text invisible against same-color background
- Fix clipboard "Outside int range" error — `pasteID` used unsigned int exceeding Kiwi's signed 32-bit field
- Error toasts are now sticky (don't auto-dismiss), with selectable text, copy button, and close button
- Truncate long node names in export button

### Performance

- Per-node SkPicture cache for effect rendering — unchanged shadow/blur nodes replay from cache on scene redraws
- Drop shadows use `MaskFilter` direct draw instead of `saveLayer` offscreen buffers
- Cached `ImageFilter`, `MaskFilter`, reusable effect paint — zero per-frame WASM allocations for effects
- Reuse GL context on panel resize — swap surface without recreating renderer, preserving all caches
- Per-frame absolute position cache — avoids repeated parent-chain walks during rendering
- Optimize zoom/pan smoothness with `shallowReactive`, `useRafFn`, and input coalescing

### Build

- Auto-populate GitHub Release notes from CHANGELOG.md via `ffurrer2/extract-release-notes@v2`
- Skip already-published npm versions on CI re-runs instead of failing
- Exclude non-app directories from Vite file watcher

### Internal

- Extract shared color constants (`BLACK`, `TRANSPARENT`, `DEFAULT_SHADOW_COLOR`) — replaces 8 inline literals across core
- Extract shared `NodeContextMenuContent` component to avoid menu duplication
- Fix `@open-pencil/core` dep in MCP package: `workspace:*` for local dev (pnpm resolves at publish time)
- Replace store thunks with a late-binding proxy

### Tests

- Clipboard roundtrip tests: encode to Figma Kiwi binary → decode → verify
- 9 visual regression snapshot tests for effects rendering
- Zoom/pan E2E tests and pipeline benchmark
- MCP server edge-case tests for `find_nodes` and Zod validation
- 6 unit tests for absolute position cache

## [0.4.2] (2026-03-02)

### Fixes

- Fix Figma clipboard paste: skip non-visual node types (variables, widgets, stickies, connectors)
- Fix text not rendering after paste — `letterSpacing` from Figma is a `{value, units}` object, was passed as-is → `NaN` broke CanvasKit paragraph layout
- Fix undo/redo for Figma paste — no undo entry was recorded; redo duplicated `childIds`
- Center pasted Figma content in viewport instead of using original coordinates
- Compute auto-layouts after clipboard paste (same as .fig import and demo creation)

### Improvements

- Import additional properties from Figma clipboard: `layoutAlignSelf`, `clipsContent`, `fontWeight`, `italic`, `letterSpacing`, `lineHeight`
- Convert `letterSpacing` PERCENT units to pixels based on font size

### Tests

- 7 new clipboard import unit tests (14 total)

## [0.4.1] (2026-03-02)

### Fixes

- Fix text disappearing after hover when SkPicture cache was recorded before fonts loaded
- Invalidate scene picture cache on font load to prevent stale fallback text

### Docs

- Highlight copy & paste with Figma in README and feature docs
- Replace "fig-kiwi" format name with "Kiwi binary" — the format is shared between .fig files and clipboard

## [0.4.0] (2026-03-02)

### Features

- MCP server (`@open-pencil/mcp`) — 29 tools for headless .fig editing via stdio (Claude Code, Cursor, Windsurf) or HTTP (Hono + Streamable HTTP with sessions)
- `openpencil-mcp` and `openpencil-mcp-http` binaries — install globally via `bun add -g @open-pencil/mcp`

### Build

- All packages emit JS via tsgo + fix-esm-import-path — `@open-pencil/core` and `@open-pencil/mcp` work on Node.js without Bun
- Core package exports: `bun` condition → src (dev), `import` condition → dist (npm consumers)
- `@open-pencil/mcp` added to CI publish workflow

## [0.3.2] (2026-03-02)

### Performance

- Re-apply SkPicture scene caching for ~7x faster pan/zoom (0.98ms vs 6.8ms per frame at 500 nodes)

### Tests

- Visual regression tests for SkPicture cache: hover on/off cycle, multiple cycles, mouse hover, scene change + hover
- Type `window.__OPEN_PENCIL_STORE__` globally, remove ad-hoc casts from tests

## [0.3.1] (2026-03-02)

### Fixes

- Fix text disappearing after hovering a frame (revert SkPicture scene caching)
- Fix macOS startup hang: async font loading, show window on reopen

## [0.3.0] (2026-03-01)

### Performance

- SkPicture scene caching — pan/zoom replays cached display list instead of re-rendering all nodes
- Cache vector network paths — avoid rebuilding WASM paths every frame
- Cache ruler and pen overlay paints — eliminate 10 WASM Paint allocations per frame
- Only enable `preserveDrawingBuffer` in test mode
- Hoist URL param parsing out of render loop

### Fixes

- Fix npm publish: use pnpm for workspace dependency resolution with provenance
- CLI version now reads from package.json instead of hardcoded value
- Update README: accurate app size (~7 MB), streamlined feature list, current project structure

## [0.2.1] (2026-03-01)

### UI

- Panel header with app logo, editable document name, and sidebar toggle
- ⌘\\ to toggle side panels for distraction-free canvas
- Panels hidden by default on mobile (< 768px)
- Floating bar with logo, filename, and restore button when panels hidden
- Always show local user avatar in collab header
- Touch support for pan and pinch-zoom on iOS

### Performance

- Stubbed shiki to remove 9MB of unused language grammars (20MB → 11MB bundle)

## [0.2.0] (2026-03-01)

### Collaboration

- Real-time P2P collaboration via Trystero (WebRTC) + Yjs CRDT
- Peer-to-peer sync — no server relay, zero hosting cost
- WebRTC signaling via MQTT public brokers
- STUN (Google, Cloudflare) + TURN (Open Relay) for NAT traversal
- Awareness protocol: live cursors, selections, presence
- Figma-style colored cursor arrows with name pills
- Click peer avatar to follow their viewport, click again to stop
- Stale cursor cleanup on peer disconnect
- Local persistence via y-indexeddb — room survives page refresh
- Share link at `/share/<room-id>` with vue-router
- Secure room IDs via `crypto.getRandomValues()`
- Removed Cloudflare Durable Object relay server (`packages/collab/`)

### UI

- Toast notifications via Reka UI Toast — top-center blue pill for info, red for errors
- Global error handler (window.error + unhandledrejection) shows errors as toasts
- Link copied toast on share and copy link actions
- HsvColorArea extracted as shared component (ColorPicker + FillPicker)
- Scrollable app menu without visible scrollbar
- Selection broadcasting to remote peers

## [0.1.0-alpha] (2026-03-01)

First public alpha. The editor is functional but not production-ready.

### Editor

- Canvas rendering via CanvasKit (Skia WASM) on WebGL surface
- Rectangle, Ellipse, Line, Polygon, Star drawing tools
- Pen tool with vector network model (bezier curves, open/closed paths)
- Inline text editing on canvas with phantom textarea for input/IME
- Rich text formatting: bold, italic, underline per-character via style runs
- Font picker with system font enumeration (font-kit on desktop, Local Font Access API in browser)
- Auto-layout via Yoga WASM (direction, gap, padding, justify, align, child sizing)
- Components, instances, component sets with live sync and override preservation
- Variables with collections, modes, color bindings, alias chains
- Undo/redo for all operations (inverse-command pattern)
- Snap guides with rotation-aware edge/center snapping
- Canvas rulers with selection range badges
- Marquee selection, multi-select, resize handles, rotation
- Group/ungroup, z-order, visibility, lock
- Sections with title pills and auto-adoption of overlapping nodes
- Multi-page documents with independent viewport state
- Hover highlight following node geometry (ellipses, rounded rects, vectors)
- Context menu with clipboard, z-order, grouping, component, and visibility actions
- Color picker with HSV, gradients (linear, radial, angular, diamond), image fills
- Properties panel: position, appearance, fill, stroke, effects, typography, layout, export
- ScrubInput drag-to-change number controls
- Resizable side panels via reka-ui Splitter

### File Format

- .fig file import via Kiwi binary codec (194 definitions, ~390 fields)
- .fig file export with Kiwi encoding, Zstd compression, thumbnail generation
- Figma clipboard: copy/paste between OpenPencil and Figma
- Round-trip fidelity for supported node types

### AI Integration

- Built-in AI chat in properties panel (⌘J)
- Direct browser → OpenRouter communication, no backend
- Model selector: Claude, Gemini, GPT, DeepSeek, Qwen, Kimi, Llama
- 10 AI tools: create_shape, set_fill, set_stroke, update_node, set_layout, delete_node, select_nodes, get_page_tree, get_selection, rename_node
- Streaming markdown responses (vue-stream-markdown)
- Tool call timeline with collapsible details

### Code Panel

- JSX export of selected nodes with Tailwind-like shorthand props
- Syntax highlighting via Prism.js
- Copy to clipboard

### CLI (`@open-pencil/cli`)

- `info` — document stats, node types, fonts
- `tree` — visual node tree
- `find` — search by name/type
- `export` — render to PNG/JPG/WEBP at any scale
- `node` — detailed properties by ID
- `pages` — list pages with node counts
- `variables` — list design variables and collections
- `eval` — run scripts with Figma-compatible plugin API
- `analyze colors` — color palette usage
- `analyze typography` — font/size/weight distribution
- `analyze spacing` — gap/padding values
- `analyze clusters` — repeated patterns
- All commands support `--json`

### Core (`@open-pencil/core`)

- Scene graph with flat Map storage and parentIndex tree
- FigmaAPI with ~65% Figma plugin API compatibility
- JSX renderer (TreeNode builder functions with shorthand props)
- Kiwi binary codec (encode/decode)
- Vector network blob encoder/decoder

### Desktop App

- Tauri v2 (~5 MB)
- Native menu bar, save/open dialogs
- System font enumeration via font-kit
- Zstd compression in Rust
- macOS and Windows builds via GitHub Actions

### Web App

- Runs at [app.openpencil.dev](https://app.openpencil.dev)
- No installation required
- File System Access API for save/open (Chrome/Edge), download fallback elsewhere

### Documentation

- [openpencil.dev](https://openpencil.dev) — VitePress site with user guide, reference, and development docs
- Deployed via Cloudflare Pages
