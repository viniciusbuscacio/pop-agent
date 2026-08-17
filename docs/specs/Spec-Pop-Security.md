# Pop Agent — authentication, secrets and external-content safety

**Status:** normative
**Legacy coverage:** §§9–10
**Primary implementation:** server/src/application/auth, server/src/domain/safety
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
## 9. Auth and secrets

- **Password only** (no username) — vault-style login. Hash: argon2id at
  64 MB / 3 passes / 4 lanes, stated explicitly so a future library
  default cannot quietly weaken existing installs. Length is the only
  rule: 10–128 characters, no composition requirements.
- First run: `/setup` wizard — password → recovery key → provider
  (skippable) → done. The key is shown exactly once, with a mandatory
  "I saved it" confirmation, a copy button and a `.txt` download.
- **Recovery key format**: 24 symbols in six groups of four, drawn from a
  31-character alphabet that omits the pairs people misread (no `0/O`, no
  `1/I/L`) — roughly 118 bits. Symbols come from rejection sampling rather
  than folding random bytes with `%`, which would make the first eight
  measurably more likely. Input is normalised (upper-cased, separators
  stripped) so case and hyphens do not matter when typing it on a phone.
  Only a SHA-256 of the normalised key is stored: the key is
  CSPRNG-generated, so there is no low-entropy guess space for a slow hash
  to defend.
- **Recovery spends the key**: a successful recovery mints a *new* key and
  invalidates the one used. A key that stayed valid after use would be a
  permanent master password nobody remembers handing out.
- **Session token**: stateless, HMAC-SHA256 signed
  (`base64url(payload).base64url(sig)`, payload `{epoch, iat, exp}`,
  constant-time compare, ~60 lines over `node:crypto`). No JWT lib —
  evaluated and rejected. Exp 7 days. **Sliding renewal**: a token
  over 24h old comes back refreshed in the `x-pop-agent-token` response header
  and the client swaps what it stored — somebody who opens Pop Agent weekly
  never meets the login screen, while a token idle for the full week
  still dies. **Epoch** increments on password change, on recovery and on
  **"Sign out other devices"** (Settings, v0.1): every other session
  drops, and the device that acted receives a token on the new epoch,
  because signing yourself out of the button you just pressed is a
  confusing way to be told it worked.
- **Rate limit and lockout**, both in memory (one process, one account):
  10 requests per minute per origin on the credential routes, plus a
  progressive lockout on wrong answers — four free misses, then 30s
  doubling per failure to a fifteen-minute ceiling, reported as exact
  seconds so the UI counts down honestly. A correct password or a valid
  recovery key clears it. A restart clears it too: that is a deliberate
  trade against writing an attacker-driven counter to disk.
  `GET /v1/auth/state` is exempt from the rate limit — it reveals nothing
  and the app asks for it on every boot, so throttling it would let a
  user lock themselves out by refreshing the page.
- Frontend storage: `sessionStorage` by default; "Keep me signed in"
  checkbox → `localStorage` (essential on mobile PWA).
- **Biometric unlock via WebAuthn/passkey** (Face ID on iOS 16+ installed
  PWA; fingerprint/face on any recent Android Chrome — same code): after a
  password login, Settings offers "Enable Face ID unlock" →
  `navigator.credentials.create()` registers a passkey
  (`@simplewebauthn/server`; credentials in SQLite, single-use challenges
  with short TTL). Login screen then offers "Unlock with Face ID" →
  `navigator.credentials.get()` → server verifies → issues the SAME HMAC
  session token. Passkey only replaces typing the password; password +
  recovery key remain the fallback. Requires a stable HTTPS hostname
  (`rpId` is bound to it — changing hostname invalidates passkeys) and
  feature detection (`window.PublicKeyCredential`) to hide the button
  where unsupported. Never `getUserMedia` — biometrics stay in the
  device's secure hardware.
- **Provider secrets**: SQLite is not fully encrypted (your own VPS, honest
  threat model). Secrets column is encrypted with the key in
  `~/.pop-agent/secret.key` (0600), which is **excluded from backups** — a
  leaked backup leaks no keys; restore on a new machine = re-enter keys. The
  session HMAC secret lives in the same table for the same reason.
  Root-level attackers are out of scope and the README says so.
- **Type-enforced route protection**: an unauthenticated URL must not
  compile. Route groups reach the app only through `mountApi()`
  (interface/http/route-registry.ts), which accepts branded
  `SessionGuardedRoutes` or a `publicSurface(reason, …)` — a bare Hono
  does not typecheck, so going public is a loud, greppable act with a
  written reason. `PUBLIC_V1_PATHS` in the same file is the single
  source of truth for guard exemptions (the auth middleware derives its
  allowlist from it; no duplicated literals). The runtime half: the
  probe in route-guard.test.ts walks every registered /v1 route and
  fires it without a session — anything not on the declared list must
  answer 401, and the HMAC download surface must answer 4xx without a
  valid signature. Future compile-time invariants on the same pattern:
  SecretString branding, so key material cannot flow into a log or a
  response type.

## 10. External-content safety (`domain/safety/`)

Mandatory because the agent runs full-power (§5). Deterministic layer (no
LLM) over everything from outside — web, files, notes, tool output:

- Strip invisible characters (zero-width, bidi, tag chars); NFC
  normalization; flag long base64 blobs; extract URLs.
- Multilingual prompt-injection regex table (PT included; aw's table as
  conceptual reference, rewritten).
- Untrusted-data envelope with delimiters ("data, never instructions").
- **Per-turn taint**: if a turn consumed suspicious external content it
  becomes tainted for the rest of that turn. Under YOLO mode (the owner's
  call, 31/07) there is no confirmation card and the user is never asked;
  the brake is automatic instead. This is the ONLY brake on yolo mode.
- **YOLO is about the AGENT, never about the person's thumb** (Vinicius,
  03/08). It means a run does not stop mid-task to ask permission. It does
  not mean the UI is free of dialogs: a destructive tap the *user* makes —
  deleting a folder and everything under it, a batch delete — still asks
  first, because a ⋯ menu on a phone puts Delete a few millimetres from
  Rename and there is no undo behind it. A confirm must state the real
  blast radius (the whole subtree's file count, not the direct children's).
- **Implemented via pi's own `tool_call` / `tool_result` extension hooks**
  (an inline extension Pop Agent registers; `noExtensions` still keeps the
  host's out). A run whose tool output sanitizes as suspicious/high
  becomes tainted; in a tainted turn a bash command that would **exfiltrate
  or read a secret** (curl/wget uploading a file, `curl -d/-F @file`,
  pipe-to-network, scp/rsync out, netcat, or reading secret.key / .env /
  pi-auth.json / id_rsa / .ssh) or **destroy irreversibly** (rm -rf, sudo,
  dd, mkfs, chmod/chown -R, pipe-to-shell, fork bomb, redirect outside the
  workspace) is refused right there: the tool call returns an error telling
  the model this turn is tainted, so it carries on without that command. No
  dialog, no `POST /v1/chats/:id/confirm`. A clean turn runs anything (full
  YOLO). Every refusal is logged (`onFailure` code `turn_tainted`), so the
  trail survives. Only the exfil/secret/destruction shapes are gated —
  gating every command would cripple ordinary tainted work.
- Plan Mode is independent defense-in-depth, not a taint verdict: its reduced
  pi tool catalogue applies from the start of the turn even when every input is
  trusted. MCP `readOnlyHint` is the configured server's advisory contract;
  absence is denial, and MCP output remains untrusted/taintable as usual.
