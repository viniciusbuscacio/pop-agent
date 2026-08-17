# Pop Agent — pi agent integration

**Status:** normative
**Legacy coverage:** §5
**Primary implementation:** server/src/infrastructure/agent, server/src/application/chat
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
## 5. pi integration (`infrastructure/agent/`)

> End-to-end flow detail (frontend ↔ pi through every layer, event
> mapping, failure modes): `docs/agent-flow.md`.

- Package `@earendil-works/pi-coding-agent`, embedded via SDK
  (`createAgentSession`). Plan B if crash isolation ever demands it: pi as
  an RPC subprocess — the `AgentBridge` interface covers both without
  touching the rest.
- **Who stores what**: pi persists sessions as JSONL trees (branching,
  compaction, model changes) — that is the *execution state*, the exact
  context the model sees. Pop Agent never parses those files. Pop Agent's SQLite is
  the *product state*: chat list, titles, rendered messages, search,
  memory. Messages exist in both places on purpose — a pi format change
  must never touch the UI or memory.
- pi's `sessionDir` points into `POP_AGENT_DATA_DIR/sessions/`
  (`SessionManager.create(cwd, sessionDir)`). Resume =
  `SessionManager.open(path)` with the path stored in
  `chats.pi_session_id`. Smoke tests use `SessionManager.inMemory()`.
- **Tools**: read, bash, edit, write — all enabled, full power ("yolo
  mode"). No permission prompts. The taint rule (§10) remains the safety floor.
  Pop Agent's own capabilities (memory, notes, web, skills) are registered as pi
  custom tools via `defineTool` (typebox schemas).
- **Plan Mode is a per-message read-only policy, implemented through pi rather
  than simulated in prose.** Before the model turn, Pop calls pi's
  `setActiveToolsByName()` with a fail-closed allowlist: `read`, `grep`, `find`,
  `ls`, Pop's explicit read tools, `local_read` when attached, and MCP tools
  whose standard `annotations.readOnlyHint` is exactly `true`. `bash`, all
  write/edit/delete tools, unannotated MCP tools and unknown future tools are
  absent. The server also prepends an authoritative `[PLAN MODE ACTIVE]`
  runtime note telling the model to investigate and return a plan, never make
  or claim changes. A mode change is a durable FIFO barrier: steering may share
  a live pi loop only when local connection and execution mode both match.
- **Concurrency**: multiple chats run in parallel. Cap configurable,
  default 20; excess queues with visible status.
  **One run per chat** on top of that ceiling — a second message to a busy
  chat is refused with `run_in_progress`, and the frontend holds it in a
  one-slot client-side queue that fires when the chat frees. Overflow past
  the global ceiling is queued rather than refused, so a burst of chats
  degrades into waiting.
- **Stopping a queued run** removes it from the queue instead of aborting an
  engine it never reached, and still reports `aborted`: a client that asked
  to stop needs to stop waiting. Idle sessions unload from
  RAM after ~3h; reopening is transparent (ms). A warm-standby pool (+1
  pre-created session) was evaluated and rejected for now — session
  creation is an in-process object (ms); revisit only if skill/extension
  scanning ever makes it slow.
- **Stop is a kill**: stopping a run must kill the process group of any
  running bash child, not just abort the stream. aw has a working
  implementation to consult; verify what pi does on abort while coding.
- **Tool output streams in real time** to the UI (terminal-style), from
  v0.1.
- Model switchable per chat and mid-session; global default in Settings.
- **Native pi session commands:** the composer exposes `/compact [instructions]`,
  `/session`, `/name <name>`, `/export [html|jsonl]`, and `/fork <number>`.
  These invoke pi's public SDK operations rather than prompting the model or
  reproducing pi's behavior. Command results never enter model context. The
  `/compact` completion is a durable system timeline marker, delivered through
  the same history/SSE path as provider fallback markers; other command output
  remains local to the visible transcript. Exports land under `Files/Exports/`. `/name` updates the
  SQLite title and pi session name, with SQLite authoritative on every session
  wake. Bare `/fork` lists active-branch user turns; the numbered form creates
  a new Pop chat backed by pi's branched JSONL session, copies the visible
  product history before that turn, and prefills the selected request as a
  draft. Session-mutating commands refuse while that chat is running or queued.

## Detailed flow

See [../agent-flow.md](../agent-flow.md).
