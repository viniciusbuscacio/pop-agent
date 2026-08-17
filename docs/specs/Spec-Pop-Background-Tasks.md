# Pop Agent — background tasks and maintenance

**Status:** normative
**Legacy coverage:** §21 before the former changelog
**Primary implementation:** server/src/application/tasks, task routes and repositories
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
## 21. Background tasks (`application/tasks/`)

- A **task** is a prompt with a schedule: the third tab of the sidebar,
  next to Chats and Files. Two kinds and no more — `once` (runs at the
  next tick, then switches itself off) and `interval` (every N minutes,
  forever). A cron expression is a language; this is a personal agent.
- Table `tasks` (migration 017): title, prompt, `schedule_kind`,
  `interval_minutes`, `next_run_at`, `enabled`, `created_at`, and the last
  run's `last_run_at` / `last_status` / `last_chat_id`; migration 018 adds
  `notify_on_finish` (default 1) and `archive_chat` (default 0). Times are epoch
  milliseconds here, unlike the ISO strings of the chat tables: everything
  about a schedule is arithmetic on what the clock port returns. The wire
  DTO converts back to ISO, like every other timestamp the API hands out.
- The **scheduler** lives in `application/`, with the clock AND the timer
  injected (`ports/timer.ts`), so the whole thing is unit-tested without a
  wall-clock second passing. It ticks every 30s, wired in main.ts after the
  server is listening.
- **Serialised, FIFO, never two at once.** Each due task is appended to a
  single queue worked one at a time. A task run is a full agent turn with a
  workspace and a process group behind it; two racing on a small VPS is how
  a personal server falls over. The global run ceiling would not help — it
  counts chats, and every task run opens a new one.
- Each run: open a fresh chat, **rename it to the task's title through the
  manual-rename path** (which switches `auto_title` off, so the service model
  will never rewrite a name chosen for the task — §14), post the prompt as a
  user message,
  and run it through the normal `RunService`. Failover, context compaction,
  usage accounting and persisted error messages all apply, and the result is
  readable as an ordinary conversation.
- On finish: `last_run_at`, `last_status` (`ok` or the failure code),
  `last_chat_id`; an interval task is parked one interval **from when it
  finished**, not from when it was due, so a task slower than its own
  interval cannot queue up behind itself; a `once` task is switched off.
  One journal line per run.
- **Two switches for what a finished run does to the rest of the app**, both
  per task, because the defaults that suit a once-a-day task are exactly
  wrong for one that runs every ten minutes:
  - `notifyOnFinish` (default on) — the finished-run push (§14). Off is
    passed down as `RunService.startRun(..., { notify: false })`, which
    silences **only** the push: `notifyDone` still fires, so the run is
    still counted for health. A quiet task is not an invisible one.
  - `archiveChat` (default off) — the run's conversation is archived the
    moment the run ends, so a frequent task stops burying the sidebar under
    its own output. The chat is untouched otherwise and `last_chat_id`
    still links to it. Archiving is wrapped in its own catch: where a
    conversation sits must never rewrite the run's recorded status.
- **A failing task never crashes or stalls the scheduler.** The catch is
  total: the failure becomes the run's status and the queue moves on. A
  task already running is not queued again by the next tick, and a task
  deleted while it waits is skipped.
- `RunService.whenRunEnds(runId)` is how the scheduler learns the outcome:
  an SSE sink is a broadcast, not an answer to one question. Outcomes for
  runs nobody asked about yet are remembered briefly and bounded.
- Routes (all session-guarded): `GET|POST /v1/tasks`,
  `GET|PATCH|DELETE /v1/tasks/:id`, `POST /v1/tasks/:id/run-now` (202 —
  queued, never inline), `POST /v1/tasks/:id/toggle`. Bodies are strict
  Zod; an interval with no minutes is a 400. New error code:
  `task_not_found`.
- Any change to the schedule, and any switch back on, **re-parks**
  `next_run_at` from now: an edit from "every 6 hours" to "every 5 minutes"
  must not still wait six hours, and a task switched on after a month off
  must not fire the same second.
- UI: the list is the sidebar (like Chats, so on a phone it *is* the
  screen) — title, human-readable schedule, next run, the enabled switch,
  and the last status linking to the conversation it happened in; Run now
  and Delete-with-confirm in the row menu. Create/edit is a **full-screen
  route**, never a drawer (§14), with Save and Cancel.
- **Internal maintenance** (`ports/maintenance-job.ts`) rides the same
  tick rather than owning timers of its own. A maintenance job is not a
  task: no row, no chat, no agent tool, invisible in the UI.


### The orphan sweep

- A **maintenance job**, not a task: no row, no chat, no agent tool, invisible
  in the UI. It rides the scheduler's tick on a daily cadence, and runs on the
  first tick after boot so a machine that reboots every night still sweeps.
- Two targets, both deliberately narrow:
  - `POP_AGENT_WORKSPACE/attachments/<chatId>/` whose chat is no longer in the
    database. A chat deleted through the API already takes its folder with it
    (§6); this catches what a crash, a restore or a hand-edited database left.
  - Scratch files sitting **directly** in the workspace root, older than thirty
    days, and only with an extension the agent is known to leave behind:
    `.png`, `.yaml`, `.mjs`.
- The list of what it must never do is longer than what it does: never the
  attachments of a living chat, never the database, never a directory in the
  workspace root (that is someone's project), never anything outside
  `POP_AGENT_WORKSPACE`, never a symlink. **Session history is forever** — a sweep
  only ever removes files *derived* from it, never a message, a chat or a
  title. Deletion failures are swallowed: a file already gone is the goal.
- One journal line per sweep, with the counts, even when both are zero — a
  silent job is a job nobody can tell is alive.
