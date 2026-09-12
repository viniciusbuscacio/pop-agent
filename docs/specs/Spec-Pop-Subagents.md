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
