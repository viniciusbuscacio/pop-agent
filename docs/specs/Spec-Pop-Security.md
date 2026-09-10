# Pop Agent — security

**Status:** normative
**Legacy coverage:** §§9–10
**Primary implementation:** `server/src/application/{auth,onboarding}/`, `server/src/domain/safety/`, `server/src/interface/http/`, `server/src/infrastructure/{auth,crypto,agent,onboarding,web}/`
**Related:** [`Spec-Pop-General.md`](Spec-Pop-General.md), [`Spec-Pop-API.md`](Spec-Pop-API.md), [`Spec-Pop-A2A.md`](Spec-Pop-A2A.md), [`Spec-Pop-Installation.md`](Spec-Pop-Installation.md), [`Spec-Pop-Local-Access.md`](Spec-Pop-Local-Access.md)

## Threat model and permanent rules

Pop Agent is mono-user and self-hosted. It protects the owner from remote
unauthenticated access, credential disclosure, unsafe public surfaces,
malicious external content, path escape, confused machine routing and release
replacement. A root-level attacker on the host can read process memory and the
key file and is outside the cryptographic threat model.

Permanent rules:

- no telemetry;
- no unrelated or unasked network calls;
- no secrets in logs, notes, memory, chat-visible status, URLs, argv, bootstrap
  scripts; new backup archives must not expose plaintext secrets;
- server-side authorization remains authoritative;
- all external content is data, never instructions;
- deterministic controls fail closed and do not depend on model judgment.

Public deployment requires HTTPS at the reverse proxy/origin. Plain HTTP is
acceptable only for explicit loopback development and the fresh-install
private-LAN bootstrap listener. That listener binds one RFC1918 address (or
loopback for SSH forwarding), runs on a separate port, mounts only bounded
network-onboarding routes plus static UI, and never accepts a password,
recovery key, provider credential, product request, download or WebSocket.
Pop serves one same-origin PWA/API and does not enable broad cross-origin
credential access.

The installer prints a 12-symbol ambiguity-free one-time pairing code valid for
15 minutes. Only a salted SHA-256 digest is stored owner-only; the raw code
never enters a URL, argv, environment, unit or journal. Five failed guesses
lock pairing for one minute. A successful exchange consumes the code and puts a
256-bit token only in that origin's `sessionStorage`. The master password route
remains unavailable until Tailscale Serve HTTPS is verified, and a guided
install accepts it only through the loopback proxy carrying
`X-Forwarded-Proto: https`.

## Backup confidentiality

New `.popbackup` archives encrypt their complete compressed payload using an
independent owner-chosen backup password. The saved password uses SecretsRepo
field encryption and is never returned through HTTP. The excluded `secret.key`
is not needed to decrypt an archive with its password. Legacy `.tar.gz` archives
remain unencrypted and can contain pi-managed sign-in tokens; the UI identifies
them explicitly. Archive authentication must finish before restore touches live
data. See Memory and Storage for the versioned format and restore policy.

## Password setup and recovery

There is one account and no username. Password length is 10–128 characters with
no composition rules. Passwords are Argon2id-hashed with 64 MiB memory, three
passes and four lanes; these parameters are explicit and may not silently fall
to library defaults.

First run requires password creation, one-time recovery-key presentation and a
mandatory acknowledgement before setup completes. The recovery key contains 24
symbols in six groups, uses an ambiguity-free 31-symbol alphabet and rejection
sampling, and carries roughly 118 bits. Input is case/separator normalized.
Only its SHA-256 digest is stored.

Before acknowledgement, the account remains explicitly pending and password or
passkey login cannot turn it into a completed setup. The page-scoped token
issued beside the displayed key may only acknowledge that pending setup while
the account is pending; after acknowledgement it becomes usable as the first
session. If the tab loses the one-time key, submitting the same password resumes
setup by burning the lost key and issuing a new one.

Successful recovery spends the key, sets the new password, increments the
session epoch and returns a new one-time recovery key. Password change does the
same. Recovery material is never retrievable later.

## Sessions

Browser response side effects are scoped to the session generation and token
that issued the request. A late renewal or rejection cannot overwrite a newer
login, restore credentials after sign-out, or invalidate a replacement token.
This applies equally to JSON requests, uploads and downloads.

A session token is a compact HMAC-SHA256 signed payload containing epoch,
issued-at and expiry. Signature comparison is constant-time. Lifetime is seven
days. An authenticated request using a token older than 24 hours may receive a
replacement in `x-pop-agent-token`; clients atomically replace their stored
copy. Renewed tokens carry the original authenticatedAt timestamp (falling back
to iat for older tokens); renewal must not simulate a fresh sign-in for local
computer removal policy.

The PWA defaults to `sessionStorage`. “Keep me signed in” uses `localStorage`
for both password and passkey unlock.
Denied/quota browser storage falls back to page memory without breaking login
or logout. Bearer tokens are never cookies and therefore never rely on ambient
cookie CSRF behavior.

Epoch increment invalidates every old token. “Sign out other devices” increments
the epoch and returns a replacement token to the caller. Open SSE and PLA
connections are bound to validated session epoch/expiry and are revoked rather
than surviving only because they authenticated once.

Credential routes have a per-origin 10/minute limiter plus progressive
in-memory lockout: four free misses, then 30 seconds doubling to 15 minutes.
Responses report remaining seconds. Correct authentication clears the lockout;
process restart also clears it. The setup-state endpoint is exempt because it
reveals no credential and is needed on every boot.

## Passkeys

Passkeys are an optional password-unlock replacement, not a second account.
Registration requires an authenticated password session. Login challenges are
single-use and short-lived. Server verification binds RP ID and expected origin
and issues the same HMAC session token after success.

The PWA feature-detects WebAuthn and requires a stable HTTPS hostname. Changing
RP ID invalidates existing credentials. Biometrics stay in platform hardware;
Pop never uses camera APIs. Password and recovery remain available.

## Secret storage and redaction

Credentials stored through SecretsRepo and session-signing material are encrypted
at rest in SQLite using `POP_AGENT_DATA_DIR/secret.key`, created owner-only (`0600`). The
key is excluded from backups, so an archive alone cannot decrypt those fields.
Restoring to a new host without the original key requires re-entry of credentials
from SecretsRepo. Pi-managed provider sign-in tokens are stored separately in
owner-only, unencrypted `pi-auth.json`; they are not covered by this encryption
and are included inside the encrypted payload of new backup archives. Legacy
archives can contain these tokens without encryption. The database and backup
still contain private conversations/files and must be handled as sensitive.

Durable prose stores are not secret stores. Living-memory writes from both UI
and tools deterministically redact labeled credentials, known token formats and
private-key blocks. Auto-Skills scrub before review and before publication.
Agent instructions prohibit writing secrets into notes or memory.

Logs use stable codes and sanitized summaries. OAuth transcripts expose
progress/prompt state but never access/refresh tokens, authorization headers or
provider error pages containing credential material.

## Route authorization

Every route group reaches the app through `mountApi` as either:

- branded `SessionGuardedRoutes`; or
- `publicSurface(reason, routes)` with a written security reason.

A bare route group cannot compile into the registry. `PUBLIC_V1_PATHS` is the
single allowlist used by auth middleware. Runtime route-guard tests probe every
registered `/v1` route without a session; undeclared routes must return 401.
HMAC download routes must reject an absent/invalid/expired signature.

Public surfaces are intentionally narrow: liveness/setup/login/recovery,
one-time-ticket SSE entry, pre-session passkey login and immutable public
installer/runtime artifacts. Files downloads always require a current owner
session in addition to their path/expiry signature, including previously issued
links. A copied URL alone grants no file access; session revocation and password
changes invalidate further downloads using the old session. Public bootstrap contains code,
origin, version, hash and size only—never a bearer token.

Bodies, query limits, path parameters and protocol metadata are validated and
bounded at the HTTP edge. Product/application layers receive typed values, not
raw transport objects. Stable error payloads must not disclose stack traces,
paths, SQL or provider secrets.

## Files and content serving

Filesystem operations use canonical root jails and reject absolute paths,
traversal and symlink escape. User HTML/SVG and other active content is forced
to download rather than rendered inline on Pop's origin, preventing an uploaded
file from reading browser session storage. Download signatures bind path and
expiry together, but never replace session authorization. The PWA fetches bytes
with its bearer header and uses revocable local object URLs for previews. Tokens
never enter download URLs or redirects.

Destructive user-interface taps retain explicit confirmation when there is no
undo and must state the real subtree blast radius. Agent deletion in `Files/`
uses recoverable trash. YOLO removes intermediate agent confirmations; it does
not remove owner-facing UI safeguards.

## External-content sanitization

Every web result, file/note/history retrieval, MCP result and tool output is
external data. The deterministic sanitizer:

- strips soft-hyphen, zero-width, bidi and Unicode tag controls;
- normalizes NFC and accent-folds only for pattern matching;
- extracts URLs and flags long Base64 payloads;
- decodes a bounded number/size of plausible Base64 text runs once;
- detects multilingual instruction override, persona hijack, prompt/secret
  exfiltration, covert action, markup smuggling and destructive bait;
- returns cleaned text, URLs, warnings and `low | suspicious | high` risk;
- wraps content in explicit source-labeled untrusted delimiters.

Sanitization does not claim to make hostile text trusted. It labels and bounds
it so model context and the per-turn guard treat it correctly.

## Per-turn taint guard

Pi extension hooks observe tool results and later tool calls. Once suspicious
or high-risk external output is consumed, the turn remains tainted. The guard
then refuses only high-impact shapes:

- exfiltration/upload/pipes to network clients;
- reads/copies/encodings of known server or local-machine secrets;
- privilege escalation and destructive commands;
- recursive permission/ownership changes, filesystem formatting, pipe-to-shell,
  fork bombs and clobbering protected system paths;
- any legacy `skill_write` capability if one reappears.

Server and `local_bash` use machine-specific secret patterns. Ordinary reads,
analysis and safe edits continue. Refusal is automatic and logged with
`turn_tainted`; there is no confirmation endpoint. A user-authored dangerous
request can be executed only in a fresh turn that has not consumed untrusted
content.

Taint is turn-scoped and the guard is removed in `finally`. It complements—not
replaces—tool schemas, path jails, authentication, local permission and Plan
Mode. Plan Mode reduces the catalogue from turn start regardless of taint. MCP
`readOnlyHint` is advisory input to fail-closed selection; missing means denied.

## Outbound network and SSRF

`web_fetch` accepts credential-free HTTP(S) only. It resolves the host, rejects
any private/loopback/link-local/reserved address, and pins the connection to the
screened address set so DNS rebinding cannot swap the destination after policy
validation. Redirects are refused and body/time limits stop resource abuse.
Results are untrusted.

MCP, A2A and provider network calls occur only for owner-configured
capabilities or an active model operation. Outbound A2A additionally requires
HTTPS, public screened and pinned addresses, no redirects, origin-bound
authorization and bounded bodies/deadlines; manually trusting an agent does not
permit private-address access. Static A2A credentials and Microsoft Entra
client secrets use encrypted secret storage. Short-lived Entra tokens are
acquired only after destination screening, sent only to the configured exact
origin, and never logged or returned; tenant, client and scope metadata are not
secrets. All card/task text remains external untrusted content. Update checks are
explicit product behavior and can be disabled where offered. Zero telemetry
remains independent of those functional calls.

PLA opens authenticated outbound connections to the personal server; it does
not expose a local listener. Machine selection, disabled-first permission,
session revocation, payload limits and backpressure are normative in the Local
Access specification.

## Supply chain and activation

Install/update artifacts use exact versions, size and SHA-256 verification
before activation. Release manifests fail closed on malformed, duplicate,
missing or traversal-like entries. Remote origins require HTTPS. Staging,
transactional replacement and rollback precede cleanup. Pi candidates remain
isolated until package, SDK-contract and behavioral probes pass.

GitHub source acquisition accepts no token argument and puts no token in source
URLs, argv, or logs. Public HTTPS Git works in an isolated Git home with
prompting, askpass, and credential helpers disabled. An already authenticated
GitHub CLI session is optional and enables private or access-controlled
repositories and forks; when available, acquisition uses `gh repo clone` and
exact-commit `gh api` confirmation. Both paths clone first, deterministically
resolve a branch, tag, or full commit from that completed clone, reject a name
shared by a branch and tag, check out one exact detached commit, and verify the
commit and clean tree before activation.
Mutable refs changing after clone cannot change the selected commit.

The canonical destination parent must be owned by the invoking uid. Every
ancestor is root- or invoking-user-owned and not group/world writable, except a
root-owned sticky directory. Source staging is owner-only, activation cannot
replace an existing destination, and exact commit/cleanliness are revalidated
immediately afterward. Required files, including the pinned toolchain manifest,
must be regular non-symlinks, and the canonical bootstrap must stay inside the
activated checkout. Source staging is
always removed, while the activated checkout remains available with an exact
retry command if the pinned toolchain, full gate, service activation, or health
check later fails.

Handoff and its printed retry command use the same minimal explicit environment,
excluding inherited GitHub token, askpass, Git configuration, Git SSH, and SSH-
agent variables. This does not make host credential files inaccessible; host
access controls remain authoritative. The
verified SHA-256 local Git bundle remains the credential-free, no-network
acquisition alternative.

The network acquisition entry point stays non-root and supports only the same
Ubuntu amd64/arm64 boundary as the downstream bootstrap. Its explicit
fresh-host invocation opts in only to the bootstrap's fixed apt allowlist. Node,
Go and whisper.cpp remain pinned by repository size/hash metadata and smoke verification;
the prepared-checkout installer must still run the complete repository gate
before narrowly scoped systemd activation.

Secrets never enter package-manager URLs or bootstrap scripts. Stdio MCP
children receive a safe environment plus only that server's encrypted
variables. Child processes are cleaned up on cancellation/shutdown.

## Security test obligations

The gate must include focused tests for:

- password/recovery/session epoch, expiry, renewal, lockout and constant-time
  token rejection;
- passkey challenge replay/origin/RP binding;
- public-route inventory and signed downloads;
- path traversal, symlink and active-content download policy;
- sanitizer Unicode/Base64/multilingual patterns and taint command matrices for
  server/local machines;
- credential scrub through every durable-memory write surface;
- SSRF private ranges, credential URLs and screened-address connection pinning;
- PLA revocation, limits and policy;
- public-HTTPS and authenticated private/access-controlled exact-commit acquisition,
  missing/invalid auth behavior, mutable refs, bad/incomplete/dirty/symlinked
  clones, secure destination parents, handoff environment and arguments;
- malformed release metadata and rollback.

Security-sensitive changes require the complete repository gate, not only their
focused unit test.

## REST integrations

REST API Server uses one separate, non-expiring access key, authenticated by its hash and stored recoverably through encrypted SecretsRepo. Owner-only endpoints return it with no-store for copying instructions. Rotation atomically invalidates all previous tokens. The key grants all REST operations, including owner actions through authenticated UI tabs, while direct owner administration endpoints remain blocked. REST calls also enforce an IP/CIDR allowlist, defaulting to 127.0.0.1/32. Only local loopback proxies may supply a trusted last X-Forwarded-For hop; remote peers cannot spoof the source through headers. Legacy scoped credentials retain their restrictions until replaced. Outbound REST client secrets use encrypted SecretsRepo storage and screened public HTTPS transport. See [Spec-Pop-REST-API.md](Spec-Pop-REST-API.md).


## Skill maintenance and detector precision

Owner-requested personal skill writes use the Normal Mode `skill_write` tool;
that tool remains refused under external-content taint. Built-in source
maintenance follows the authorized repository workflow. Automatic learning
retains its independent review and deterministic checks.

A bare technical mention of "system prompt" is not an extraction request.
Explicit prompt-extraction language remains detected. A directly negated
command such as "Never run ... rm -rf" is not destructive bait; separate
positive execution instructions, including later instructions in the same text,
remain checked. No file path, source label or code fence exempts content from
scanning. Owner-requested retries of tainted distillation windows re-evaluate
all checks against the immutable source without clearing the historical verdict.
