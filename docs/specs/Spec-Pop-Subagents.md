# Pop Agent — Worker subagent delegation

**Status:** normative
**Primary implementation:** `server/src/infrastructure/agent/worker-subagent.ts`, `server/src/infrastructure/agent/pi-engine.ts`
**Related:** [`Spec-Pop-Pi-Agent-Integration.md`](Spec-Pop-Pi-Agent-Integration.md), [`Spec-Pop-Security.md`](Spec-Pop-Security.md)

## Purpose and first scope

Pop Agent may delegate one bounded implementation task, or fan out one request
into at most five independent tasks, to the `worker` profile provided by the
exactly pinned `pi-subagents` package. Delegation is foreground-only and exists
to isolate implementation work from the parent conversation and checkout. It
does not deliver arbitrary user-defined agents, background missions, schedules
or A2A.

The model sees only the Pop-owned `delegate_worker` facade. Its parameters
require an absolute `repository` and exactly one of `task: string` or
`tasks: string[]`; the array contains 1–5 tasks. Single-task calls remain
compatible. Invalid neither/both/empty/over-five input fails before worktree
creation or package invocation. The package's broad `subagent`, management,
scheduling and fleet tools remain inactive.

The facade fixes every child to packaged `worker`, context `fresh`, user agent
scope, foreground execution, a 30-minute runtime, a hard 80-call tool budget
and Pop-managed Git worktree isolation. Callers cannot relax those decisions.
For fan-out Pop generates a trusted `workflowScript` itself and uses the
package's audited `runs.all` workflow API; model-authored workflow scripts and
package-native tools are never exposed.

## Isolation and authority

Each worker operates in a distinct temporary managed worktree created by Pop
around the foreground `pi-subagents` call. All worktrees in one fan-out detach
from the same source `HEAD`; workers never share a mutable checkout. After the
children settle, Pop captures one bounded binary patch and private handoff
manifest per child, removes every worktree, and returns all handoff paths to the
parent. Preparation failure, package failure and parent cancellation use the
same capture-and-cleanup path. The source checkout remains unchanged.

Handoffs are not final product state. The parent agent must inspect and
integrate each patch, resolve any overlap, run the repository's final validation
and satisfy ordinary commit/delivery rules.

The child receives neither the parent's transcript nor Pop's Files, Notes,
memory, MCP capabilities, PLA tools or ambient host extensions. Nested
subagents, schedules and background runs are disabled. Runtime policy admits at
most five children per delegated run and at most five tasks with concurrency
five in the package parallel runtime. Depth remains one.

`delegate_worker` is absent in Plan Mode. Worker output is still tool output and
therefore passes through the ordinary external-content sanitizer and per-turn
taint guard before it can influence later high-impact calls.

## Runtime and credentials

`pi-subagents` is loaded by explicit absolute package path while pi's ambient
extension discovery remains disabled. Its version is exact in the server
manifest and lockfile. The child command is the CLI beside the exact SDK active
for the server, including a validated isolated runtime candidate.

The child pi process points at Pop's isolated pi agent directory. Its conventional
`auth.json` path is a controlled symlink to Pop's existing `pi-auth.json`, so an
OAuth/subscription credential is not duplicated. Pop-stored API keys are
in-memory overlays and must never be copied into a child config or temporarily
placed in global process environment. Consequently this first slice fails
closed unless the selected provider has a saved pi OAuth credential.

Task text is delivered through a private temporary file rather than argv.
Extension configuration and artifacts stay under Pop-owned paths. Host `~/.pi`
and project-local agent definitions do not become authority; the facade selects
the packaged worker under user scope and keeps the package pinned and reviewed.

## Cancellation, failure and observability

Stopping the parent run propagates its abort signal through the facade into the
foreground extension call and child process group. A failure, timeout, invalid
repository or missing OAuth credential returns a tool failure/result to the
parent without silently falling back to direct writes. Each child's reported
usage is booked exactly once as its own `subagent:worker` chat ledger row; the
aggregate is used only as a single-worker compatibility fallback when child
detail is unavailable. Subscription token counts remain visible while their
billed cost remains zero.

The existing tool event stream is the first UI surface and its wire and durable
`ToolCallDTO` shape remains unchanged. In the assistant timeline, calls named
exactly `delegate_worker` render in a dedicated quiet, collapsible **Subagents**
card instead of the ordinary **Ran tools** card. The inline card shows the
existing active spinner, done check, failure or interrupted state and reveals
worker progress and the final handoff when expanded. It remains ordered by the
first delegation call relative to the ordinary tool group. A floating fleet UI
or durable background-run table is outside this slice.

## Update and test obligations

A pi runtime candidate is not compatible merely because the base SDK probe
passes; releases that change extension or child CLI contracts must extend the
candidate probe before activation. Updating `pi-subagents` is a reviewed runtime
change, never an automatic package self-update.

Tests must prove that:

- the facade accepts exactly one of one task or 1–5 tasks and rejects invalid
  bounds before worktree creation or package invocation;
- five tasks use trusted `runs.all`, launch concurrently and receive hard-coded
  worker, fresh-context, user-scope, foreground, runtime and tool-budget policy;
- every child receives a distinct worktree at the same source `HEAD`, every
  patch and manifest is captured, cleanup leaves the source checkout unchanged,
  and cancellation reaches the upstream call;
- relative repository paths and missing OAuth fail before child launch;
- package-native model-facing tools are removed from the active catalogue;
- Plan Mode excludes delegation;
- policy caps depth, spawn count, global and parallel concurrency, disables
  background/schedules and keeps private-file task delivery;
- the auth link targets only Pop's isolated OAuth store and no API key is
  persisted;
- five child usages create five separate rows without booking their aggregate.

## Explicit Pop Loop

Pop remains a normal, fully capable agent. Only an explicit owner request such
as “call Loop” or “chama o Loop” invokes the Pop-owned `run_loop` tool. There is
no automatic complexity detection. Loop is a workflow, not a fourth agent:
**Pop > Planner/Reviewer > Worker**. Ordinary `delegate_worker` remains unchanged.

The initial Loop accepts only an absolute Git repository path and a bounded
task. Models, roles, tools, limits and workflow scripts are not caller options.
The server reads the live parent session's resolved provider/model when Loop
starts. Planner/Reviewer uses that Chat Model; Worker uses the current Service
Model setting for the same provider, including its dynamic follow-chat policy.
Missing models or configuration fail actionably; Loop never silently chooses a
different model/provider or retries a write through failover.

Loop uses dedicated in-process pi SDK child sessions, not simulated role prompts
inside Pop and not the packaged delegate worker. Each phase has a fresh,
in-memory context with only its task/plan/corrections and role-specific tools.
There is one Planner/Reviewer role and one Worker role, executing sequentially;
no parallel workers, nested agents, parent transcript, ambient extensions,
host/project prompt discovery, Pop memory, MCP, PLA or background jobs enter
these contexts. The shared Pop ModelRuntime supplies credentials in memory;
no key is copied into a child file, argv or global environment. This SDK path
supports configured API-key, OAuth and custom providers; the separate packaged
`delegate_worker` OAuth restriction still applies to that feature only.

The server creates one detached managed Git worktree from source HEAD for the
whole workflow. Worker corrections preserve earlier work in that same worktree.
These are checkout/context boundaries, not an OS sandbox: the Worker has the
normal server coding tools and owner-authorized shell access. Worker instructions
limit work to the worktree and prohibit commits, publication and activation.

Planner/Reviewer receives only `loop_inspect` and `loop_read`, not shell, write,
edit or arbitrary extensions. Reads are bounded regular files jailed to the
worktree, excluding Git metadata and symlink escapes. Nonblocking opens reject
special files such as FIFOs without waiting for another process. Before each read-only
phase, the server captures the actual binary diff, file inventory and Worker
tool-call/result evidence. The inspection tool only returns that snapshot;
it does not execute commands or change even the Git index. Reviewer must use
both inspection and file reading before its verdict is accepted. Worker final
prose is not review evidence. Reviewer examines actual files/diff and captured
validation results and must block or request corrections for missing checks.
Large diffs/evidence fail closed rather than silently truncate review coverage.

The sequence is plan → execute → review → bounded corrections. Plan and review
responses use strict JSON. Review returns approved, blocked or corrections;
malformed output or child failure ends the workflow without retry. Up to three
corrections (four Worker executions) are allowed; exhaustion returns `limit`.
There is a 30-minute execution deadline, 80 attempted tool calls per phase and
320 total. Count attempts before SDK name/schema validation, including unknown
tools and invalid arguments; an over-budget batch must not execute.
Git preparation/capture/cleanup commands have independent 30-second timeouts;
cleanup can finish after the execution deadline.
Cancellation aborts the active SDK session (including native bash process-group
cancellation); automatic provider retries and compaction retries are disabled.
Each terminal child model message is accounted once under its actual
provider/model and `loop:plan`, `loop:worker` or `loop:review`, never additionally
as a child aggregate.

All settled outcomes, including failure and cancellation, attempt a private
patch, manifest and `loop-evidence.json` handoff before removing the worktree.
Artifacts include actual tool/test evidence and phase responses and are retained
in the private temporary handoff directory, like delegated worker patches.
Artifact capture failure cannot return approval. Pop must inspect the handoff,
integrate deliberately and run final validation; Loop approval does not commit,
publish, release or activate anything. Temporary handoffs are not durable product
storage and can be lost to host temporary-directory cleanup.

`run_loop` is excluded from Plan Mode and classified high-impact under taint.
Child tools share workflow-scoped taint across fresh role contexts; child answers
are also scanned before they can influence another phase. Fresh contexts do not make
repository or tool content trusted. Loop results remain external tool data.

Tests must cover server model mapping and live changes, real SDK tool registration,
read-only enforcement, separate contexts, actual patch/test evidence, correction
preservation and approval, bounds, malformed output, failure/cancellation,
worktree cleanup, usage deduplication, credential non-persistence and Plan/taint
exclusion. Candidate-runtime probes check the explicit child tool allowlist.
