# Pop Agent — deployment and operations

**Status:** normative
**Legacy coverage:** §18
**Primary implementation:** `server/src/main.ts`, `server/src/manager/`, `server/src/application/update/`, `server/src/infrastructure/update/`
**Related:** [`Spec-Pop-Installation.md`](Spec-Pop-Installation.md), [`Spec-Pop-Security.md`](Spec-Pop-Security.md), [`Spec-Pop-Pi-Agent-Integration.md`](Spec-Pop-Pi-Agent-Integration.md)

## Delivered deployment model

The current server is an operator-managed Node/TypeScript checkout on Ubuntu,
normally supervised by `pop-agent-service` under systemd. The normal fresh-host
entry point is a Git clone followed by `deploy/bootstrap-server.sh`. The root
`server-install.sh` remains a fixed-ref acquisition alternative. Public repositories can
be acquired through non-interactive public HTTPS Git. An already authenticated
GitHub CLI session is optional for private or access-controlled repositories and
forks; when available, the installer uses `gh repo clone` and `gh api`
exact-commit confirmation. Each route resolves a branch, tag, or full commit
from a completed clone, rejects branch/tag name ambiguity, checks out one exact
detached commit, validates a
complete clean non-symlinked checkout (including its pinned toolchain manifest)
before and after no-replace activation, validates secure destination ancestry,
and retains an activated checkout if downstream setup fails. The script accepts
no token argument and never puts tokens in URLs, argv, or logs. Handoff and retry
use a minimal explicit environment without inherited token/askpass/Git-config/
SSH-agent variables, but do not claim to hide host credential files. A fixed
clean commit can alternatively be moved into the host as an
immutable local Git bundle: Pop verifies the operator-supplied SHA-256, bundle
integrity and exact commit before atomically activating a new checkout without
network acquisition.

Both acquisition paths hand explicit checkout/data/workspace/port values to the
delivered non-root Ubuntu amd64/arm64 bootstrap. The fresh-host path
explicitly opts in to the same narrowly scoped apt build/download prerequisite
allowlist needed for a fresh supported host. The bootstrap installs an exact
repository-pinned Node/whisper.cpp runtime per user, installs ffmpeg and
Tailscale for the default guided path, then hands the checkout to the
prebuilt installer. Native release builders run the full gate; the host verifies
the exact architecture package, native dependencies and built application with
disposable data, then
generates/activates the production unit through narrowly scoped sudo, and
verifies loopback health. On a fresh data root it assigns the non-root service
user as Tailscale operator, creates an owner-only pairing record and prints a
temporary `http://<RFC1918-IP>:8788/setup` URL plus 15-minute code. The paired
browser owns Tailscale authorization, the Certificate Transparency notice and
private Serve HTTPS activation. This server installer does not provision Linux,
open a firewall, enable Funnel, alter tailnet policy, or create an account.
`--skip-network-onboarding` keeps TLS entirely operator-managed. A separate
explicit helper remains available for manual/repair Serve configuration.

A production checkout is built and gated before activation. Runtime data lives
outside the checkout through `POP_AGENT_DATA_DIR` and workspace configuration.
Deployments do not overwrite data, secret key, notes, skills, Files or backup
archives.

## Network exposure and TLS

The application binds loopback by default. Production HTTPS is terminated by
a reverse proxy/tunnel:

- public VPS: Caddy (recommended) or equivalent with a stable domain and ACME;
- the default guided fresh install: `tailscale serve` for tailnet-only HTTPS;
- inbound ports unavailable/CGNAT: the same tailnet-only Serve shape;
- optional intentional public tunnel/funnel according to operator policy.

The proxy must preserve streaming responses, disable buffering for SSE, allow
WebSocket upgrade for PLA, pass the original Host/proto correctly and use idle
timeouts longer than event/PLA heartbeats. Compression/caching must not coalesce
live streams.

Remote plain HTTP is unsupported after installation. Loopback HTTP remains for
smoke/development. The only non-loopback HTTP exception is the fresh-install
restricted listener on one RFC1918 address and separate port. It mounts no
credential or product route and is removed after first-owner setup.
A stable HTTPS origin is required for installable PWA, WebAuthn RP binding,
service worker and remote launcher profiles.

Pop currently has no CIDR/IP access-list product and no `/v1/ax` control plane.
Historical proposals naming those features are non-delivered. Access control is
password/passkey session auth plus the network boundary chosen by the operator.

## Service process

The generated systemd unit runs `server/dist/main.js` with the checkout owner's
absolute Node executable under that non-root user, keeps the validated Node and
Whisper directories on the service `PATH`, and uses a fixed absolute checkout working
directory, explicit data/workspace paths, loopback binding and `PI_OFFLINE=1`
so pi catalog bookkeeping cannot stall service-side subscription sign-in. It
restarts unexpected failures with bounded backoff/start limits, receives SIGTERM
on planned stop and journals stdout/stderr. Rerunning the installer regenerates,
reinstalls and restarts the same named unit rather than accumulating services.
While owner-only `server-onboarding.json` exists, it also carries the validated
private bootstrap bind/port. The runtime refuses public, wildcard or same-port
bootstrap binds. Tailscale Serve is accepted only when port 443 HTTPS has one
handler proxying exactly to `http://127.0.0.1:<app-port>`; any other existing
Serve state is a conflict and remains unchanged.

The process opens/migrates SQLite, reconciles recoverable publications/state,
loads services, starts HTTP, then starts timers/background admission. Startup
failure before readiness exits nonzero. `/healthz` means the process answers;
`/v1/health` adds cheap server/database/provider status and never spends a paid
model call.

Shutdown stops new admissions, closes listeners/streams, aborts active runs and
child process groups, closes MCP/PLA/pi resources and then SQLite. Deployment
drain pauses task/run admission and waits only within bounded policy; it does
not leave the service indefinitely half-stopped. Chat-run durability does not
depend on receiving a shutdown signal: each visible partial projection is
journaled before broadcast, and boot reconciles journal rows left by SIGKILL,
process crash or host loss.

## Observability

Primary observability is systemd journal plus authenticated Settings snapshots.
Logs use stable operation/run/provider codes, duration and non-secret IDs.
Passwords, bearer/provider/OAuth tokens, recovery keys, authorization URLs with
secrets, raw provider error pages and private content are not logged.

Operational diagnosis starts with:

```text
systemctl status pop-agent-service
journalctl -u pop-agent-service
curl http://127.0.0.1:<port>/healthz
```

The health endpoint and service state are checked after every activation. Zero
telemetry means no logs/metrics leave the host unless the owner explicitly
configures an external system.

## Source deployment coordinator

The in-product deployment coordinator is still constrained by the operator
checkout and supervisor. An accepted deployment:

1. serializes against another deployment/pi activation;
2. records pre-deploy commit/version and marks deployment state;
3. pauses new scheduled/run admission and drains bounded accepted work;
4. fetches/validates the intended source candidate;
5. installs with lockfile discipline;
6. runs the repository gate/build in candidate context;
7. stages activation rather than mutating the live checkout piecemeal;
8. asks the supervisor/service manager to activate/restart;
9. verifies health and expected version;
10. commits success or rolls back to the exact prior state.

No update is declared complete because `git pull` returned zero. Gate, service
activation and post-restart health are separate mandatory evidence. Untracked or
unrelated working-tree changes are never silently overwritten.

## Update supervisor and restart handoff

A process cannot reliably validate its own replacement after it exits. The
manager/supervisor persists deployment intent and performs restart/health/rollback
outside the retiring server process. State files are atomic and contain no
secrets.

Startup reconciliation distinguishes prepared, activating, healthy, failed and
rolled-back outcomes. A crash or host reboot must resume/rollback deterministically
rather than losing which commit was active. Rollback restores source/build
activation; durable database migrations require their own forward-compatible
policy and are never reversed by copying a hot DB.

Server stop/restart requested from Settings is an authenticated operator action
but still delegated outside the HTTP process. The frontend must honestly show
connection loss/recovery rather than a false synchronous success.

## Pi runtime activation

Pi SDK/runtime candidates are independent from source deployment. Candidates
are acquired into isolated exact-version directories, checked for package
integrity and forbidden install scripts, then tested by static SDK contract and
offline behavioral probe. Only a passing candidate becomes active; failure
keeps the prior runtime and process.

A new SDK call requires both bundled contract and candidate probe updates.
Activation invalidates/disposes applicable sessions only after candidate state
is durable. Full policy lives in the pi integration spec.

## PWA and client release relationship

The PWA is built with the server and distributed by the same origin. Service
worker update/activation is browser-owned and independent from SSE. Native
launcher, CLI, managed runtime and PLA artifacts have exact immutable manifests
and may be released only when all required platform packs exist and verify.

A server code activation does not imply every open PWA has reloaded. The PWA
waits for the newest service worker installation, activates it automatically
and reloads once after controller change; old clients remain subject to
advertised wire minimum/event version.

## Backup and disaster recovery

Source deployment never substitutes for data backup. Before risky operator
changes, create/download a consistent snapshot. Backup excludes the encryption
key, so host recovery also requires preservation of the key through a separate
secure operator process or re-entry of SecretsRepo credentials. Archives are
not encrypted and can include pi-managed provider sign-in tokens; their storage
and transfer require protection independently of `secret.key`.

Restore is offline through `popman restore <name>` and restarts the service
around extraction. After restore, verify migration, health, Files/notes/skills,
provider configuration and a fake/low-cost chat path before declaring recovery.

## Security and privilege

The service and checkout are not run as root. Per-user client/tray installation
never writes system locations without explicit operator action. Release scripts
contain no secrets. Deploy keys and repository credentials remain in host-owned
files inaccessible to model context and are not printed by update checks.

Reverse proxy limits and OS resource controls are defense in depth; application
limits for runs, SSE, PLA, uploads, tools and queues remain required. Firewall
exposure should be the proxy/tunnel only, not the loopback application port.

## Test and release obligations

- clean candidate checkout passes full gate and production build;
- GitHub installer tests use only fakes/local fixtures and cover public HTTPS
  and authenticated private/access-controlled acquisition, deterministic exact
  branch/tag/commit resolution, root/platform/tool refusal, secure destination
  parents, existing destinations, dirty/incomplete/symlinked clones,
  credential-environment scrub,
  exact bootstrap arguments and actionable downstream retry;
- local source-release tests cover clean deterministic packing, immutable output,
  SHA corruption, bundle verification, exact-commit checkout, unsafe paths and
  refusal to overwrite an existing destination;
- host-bootstrap tests exercise platform/root refusal, explicit apt opt-in,
  pinned archive integrity and unsafe-link refusal, idempotent activation,
  prepare-only behavior and managed-PATH handoff through local fixtures/fakes;
- installer tests exercise systemd generation, prerequisite/dirty-checkout
  refusal, non-root build ordering, exact sudo calls and bounded health failure
  through fakes that never mutate the host service manager;
- service smoke covers setup/auth/settings/frontend/chat/SSE/tool/Stop;
- deployment tests cover serialization, pause/drain, timeout and rollback;
- supervisor tests cover crash/reboot state reconciliation and health failure;
- pi candidate contract/behavior failure preserves active runtime;
- release manifests contain every supported immutable artifact with matching
  size/hash;
- reverse-proxy staging verifies SSE keepalive/reconnect and PLA WSS upgrade;
- post-activation verifies systemd active, `/healthz`, expected version and
  clean/understood git status;
- disaster-restore drills use a stopped service and a real consistent backup.
