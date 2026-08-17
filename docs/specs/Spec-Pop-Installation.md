# Pop Agent — installation and update channels

**Status:** normative
**Legacy coverage:** §15 updates
**Primary implementation:** launcher, update services, installer routes, PWA update services
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
### Updates — two channels, one discipline

Server and pi versions are pinned exactly. The terminal client is the deliberate
exception to server-side update cadence: its native launcher checks its already-
configured personal server on each normal startup so CLI and server do not drift.

**pi channel** (npm, the sensitive one — a pi release can break Pop Agent):

The durable account setting `piUpdatePolicy` has three values:

- `keep-current` — preserve the exact active pi version;
- `recommended` — use the exact version approved by the active Pop Agent
  release; this is the default for old and new settings documents;
- `latest` — evaluate the latest stable npm release as an advanced channel.

**Current delivered phase (isolated staging and manual activation):** Settings →
Updates shows active, Pop-recommended and latest stable pi versions and persists
the policy. Active and recommended are currently the same exact dependency from
`server/package.json`. An authenticated owner can prepare the policy target:
Pop installs the exact package and production dependency graph under
`POP_AGENT_DATA_DIR/pi-runtime/`, with lifecycle scripts disabled, records npm's
integrity, then starts a separate zero-token Node probe. The probe checks the SDK
exports and methods Pop imports, the offline default-model catalogue, an
in-memory session, custom-provider registration, one streamed fake-provider turn
that calls and receives a custom tool, and abort of an in-flight provider request.
Candidate state is durable and an interrupted install becomes an explicit
failure on next boot. Preparation never opens or modifies live sessions.

A prepared candidate is `ready`. Manual activation passively waits for current
runs and tasks, closes admission, then hands the exact validated version to a
transient systemd supervisor outside the server cgroup. The supervisor snapshots
pi session JSONL, atomically writes the active-runtime pointer, restarts, and
accepts only when both HTTP health and a boot-time import stamp name the target
version. The server strictly validates the pointer, candidate integrity and SDK
entry before health can answer; `SdkPiEngine` then loads that isolated ESM graph.
On failure the supervisor stops the candidate, restores both the previous pointer
and session snapshot, restarts, and verifies the previous version. The update
status reports every activation and rollback phase; current pi is the version
selected at this process boot. `keep-current` refuses preparation; `recommended`
stages the release pin; `latest` refreshes npm metadata and stages the latest
stable exact version. A failed lookup, gate, handoff or boot never silently
changes runtime.

**Later phases:**

1. **Probation**: a version that passes startup stays on probation for
   24h; repeated pi bridge crashes trigger rollback and notify the owner.
2. A future exact-version action provides manual pin and rollback but may never
   bypass candidate validation.

**Pop Agent channel** (its own repo):

- Settings → Updates separates **This device**, **Your server**, and a collapsed
  **AI runtime · Advanced** section. Published release availability belongs to
  the server card rather than a separate section; the manual shell command is
  disclosed inside that card. Node and manually managed environment tools live
  under Settings → Server & Connections → Software, not Updates. The server
  card checks the repo's release tags and distinguishes the **boot commit** from
  checkout `HEAD`. Fetch/install/gate still happens before activation. A clean committed checkout can be
  handed to the safe deployment coordinator: it refuses new runs, drains live
  conversations and tasks, then launches a transient systemd supervisor outside
  the server's cgroup. The supervisor restarts, health-checks, records
  last-known-good and, on failure, preserves the candidate under a
  `failed-update-*` ref, restores last-known-good, rebuilds and restarts again.
- Operator CLI: `popman update` does the same from the server shell.
- The terminal chat client's installed `pop` command is a precompiled Go
  launcher. Before a normal TUI start it reads the selected server, fetches the
  public no-store `/cli/manifest.json`, diagnoses connectivity and Node/npm,
  installs a newer immutable tarball under `~/.pop/cli/<version>`, verifies size,
  SHA-256 and `--version`, atomically activates it, then execs the Node CLI.
  `pop update` forces that same non-LLM repair path; `pop doctor` works even when
  Node or the CLI is broken. An unreachable server stops before the useless TUI.
- Plain `git pull && npm ci && npm run build && restart` remains
  documented for local-on users.

**PWA client freshness** (the installed frontend, distinct from the two
channels above):

- An installed PWA only re-checks its service worker on navigation, so the
  client drives the check itself. Settings → Updates → This device has a
  device-local **Check automatically** switch and, while enabled, a frequency
  select (default **10 minutes**; the shipped factory default drops to **once
  a day**). Automatic checks run on that interval and on
  `visibilitychange → visible`; disabling the switch stops both while keeping
  manual **Check for updates** available. The choice is device-scoped in
  `localStorage`, never sent to the server.
- The registration lives in one module (`web/src/services/pwa-update.ts`);
  `registerSW` runs exactly once. A found update raises the reload banner
  (`registerType: 'prompt'` — never a silent swap).
- The server serves `sw.js` and the HTML shell with `Cache-Control:
  no-cache` (always revalidate) and only the hashed `/assets/*` with
  `immutable`, so a heuristic cache can never pin a stale worker or shell.
