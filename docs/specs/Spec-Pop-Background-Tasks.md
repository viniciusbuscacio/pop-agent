# Pop Agent — background tasks and maintenance

**Status:** normative
**Legacy coverage:** §21
**Primary implementation:** `server/src/domain/tasks/`, `server/src/application/tasks/`, task routes/repositories
**Related:** [`Spec-Pop-Backend.md`](Spec-Pop-Backend.md), [`Spec-Pop-Events-Synchronization.md`](Spec-Pop-Events-Synchronization.md), [`Spec-Pop-Skills-and-Tools.md`](Spec-Pop-Skills-and-Tools.md)

## Product task model

A task is an owner-defined prompt plus one of two schedules:

- `once`: runs at the next due tick, then disables itself;
- `interval`: runs every positive bounded number of minutes.

Cron is intentionally not a product language. A task stores title, prompt,
schedule, next run, enabled state, completion notification preference, archive
preference, optional “only with new user messages” policy, activity cursor and
last run status/chat/time.

Wire timestamps are ISO. Repository scheduling arithmetic uses epoch
milliseconds from the injected clock. Bodies are strict and interval schedules
without valid minutes are rejected.

## Scheduler lifecycle

One application scheduler owns the injected 30-second timer and starts after
the server is listening. `start()` is idempotent. Deployment drain can pause
new admission, await idle and resume without losing persisted task definitions.

Each tick:

1. reads due enabled tasks in deterministic repository order;
2. deduplicates against already queued/running task IDs;
3. pumps one serialized FIFO;
4. runs due internal maintenance jobs.

Manual Run now enters the same FIFO and upgrades an already queued scheduled
item. It never starts a parallel task. A deleted queued task is skipped. A tick
that overlaps a long pump observes the existing pump instead of creating a
second worker.

Task serialization is separate from the global chat-run ceiling. Every task
creates a full chat/run and process group, so parallel task execution could
exhaust a small personal server even when ordinary chat admission remains
within its limit.

## Running a task

A run creates a normal chat, renames it through the manual-title path, submits
the prompt through `RunService`, and waits for the specific run outcome through
`whenRunEnds`. All ordinary behavior applies: provider/model resolution,
failover, usage, tools, taint, compaction, persistence and terminal error state.

The task title cannot be overwritten by automatic title generation. The task
records the chat ID as soon as it exists, then records final status after run
settlement. A total catch converts unexpected failure to `operation_error` and
the queue continues.

`notifyOnFinish` controls only push notification. Health/accounting completion
still occurs. `archiveChat` archives after settlement without changing the run
status if archiving fails. A once task disables after the attempt. An interval
is parked one interval from finish, preventing a slow run from accumulating
missed copies.

## Activity-gated tasks

When `runOnlyWithNewMessages` is enabled, the scheduler compares the persisted
activity cursor with the newest durable user-message row ID. A scheduled run
with no new user activity is recorded as a skip, advances the cursor and parks
the next interval without creating a chat or spending a model call.

Run now is explicit owner intent and bypasses only this no-new-message skip. It
does not bypass disabled/admission safety or any execution guard. Activity
tracking uses durable user messages, not SSE/browser presence.

## API, UI and agent tool

Guarded routes provide list/create, get/update/delete, toggle and asynchronous
Run now. A change to schedule or switch back on reparks from current time.
Responses expose the last status and chat link.

Tasks are the third primary navigation area. On phone the list is the screen;
create/edit is a full route with Save and Cancel, never a drawer. Rows show a
human schedule, enabled state, next run and linked last outcome. Permanent
delete confirms.

The agent's scheduled-task tools list and manage the same server-owned tasks.
Tool calls do not own timers and cannot create a hidden second scheduler.
Scheduled invocations run with the prompt persisted by the owner and otherwise
follow ordinary security/tool policy.

## Maintenance jobs

A `MaintenanceJob` is internal housekeeping, not a user task: no task row,
chat, agent-tool listing or UI card. Jobs share the scheduler tick and declare a
cadence. Each runs on the first eligible tick after boot; in-process last-run
tracking prevents every 30-second execution. Failure is logged and cannot kill
the scheduler or block later jobs.

Current jobs include Auto-Skill distillation/collection and workspace orphan
sweeping according to their focused policies. A maintenance job that requires
persistence across restart must store its own durable watermark rather than
relying on scheduler RAM.

## Orphan sweep

The daily sweep deletes only:

- attachment directories whose chat no longer exists;
- regular scratch files directly in workspace root, older than 30 days, with an
  explicit known temporary extension (`.png`, `.yaml`, `.mjs`).

It never follows symlinks, enters arbitrary workspace project directories,
touches Files, removes live-chat attachments or deletes chats/messages/pi
session history. Deletion failure is best effort. Every sweep journals counts,
including zero.

## Failure and restart behavior

Task definitions, next-run values, last outcome and activity cursor survive
restart in SQLite. The in-memory FIFO/running turn does not. Boot reconciliation
marks interrupted product runs through ordinary startup policy; a due task may
be admitted again only according to its persisted schedule/state.

Scheduler stop prevents new timer ticks but does not pretend to abort an active
run. Deployment uses pause-and-drain. Process shutdown still aborts active agent
runs through global runtime shutdown.

## Test obligations

Focused tests use injected clock/timer and prove:

- start idempotence and 30-second tick registration;
- deterministic FIFO, no duplicate queued/running task and Run-now upgrade;
- once disable and interval-from-finish scheduling;
- activity skip/cursor behavior and manual bypass;
- normal run outcome, early admission failure and thrown failure recording;
- notification/archive independence;
- delete-while-queued and admission pause/drain;
- maintenance cadence, first tick and failure isolation;
- orphan-sweep root, age, extension, live-chat and symlink boundaries;
- strict API schedules and UI navigation/state.
