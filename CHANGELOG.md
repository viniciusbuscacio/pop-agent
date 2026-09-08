# Changelog

## Unreleased

- Encrypt new backup archives with an independent, confirmed password saved in encrypted secret storage for reuse; authenticate archives before offline restore, support legacy backups, and label their encryption status in Settings.

- Document the distinction between encrypted new backup archives and unencrypted live server data: SQLite, user files and pi-managed sign-in tokens are not encrypted at rest by Pop. Legacy `.tar.gz` backups remain unencrypted and are labeled in Settings; creating encrypted backups does not retroactively encrypt them.

- Keep archived skills in Auto-Skill deduplication without routing or restoring them; exclude incoming A2A conversations from learning and defer active, queued, or changing source conversations.

- Supply the current chat ID directly in each pi session system prompt, so answering its identity does not require a memory lookup.

- Give incoming A2A message bubbles a distinct theme-aware background while preserving their authorship labels.

- Distinguish direct owner A2A messages from Pop-authored requests and peer responses, retain authorship across continuations/restarts, and label incoming A2A chats.
- Add independent A2A Server and Client controls, an authenticated A2A 1.0 text-task server, dedicated access key/IP policy, copyable agent instructions and explicit private-destination permissions for configured peers.

- Ignore stale session renewal/rejection responses across login changes, sign-out and token replacement, including uploads and downloads.
- Refresh canonical chat state after foreground SSE reconnection opens; prevent older Files listings from overwriting newer refreshes.
- Preserve Unicode download filenames and stream file responses with bounded buffering and cancellation.
- Bound stateful HTTP MCP session cleanup so an unresponsive DELETE cannot indefinitely delay tool results.

## 0.2.78 — 2026-09-07

- Present interactive installation as concise English stages; press D or use --verbose for technical output. Retain private redacted transcripts, keep sudo password input separate, and restore the terminal on interruption.
- Simplify the chat composer: compact Send inside the message box, Add outside on the right, Show Thinking and Plan mode switches, and an in-place model selection page. Remove input/Add accent focus halos.
- Move batch release builds to the owner-managed Ubuntu 24.04 AMD64 Docker builder; reuse verified dependency/audio/gate caches and explicitly publish verified bundles without hosted GitHub Actions.

## 0.2.77 — 2026-09-07

- Remove Chat message and conversation-header overflow buttons, their click triggers and reserved spacing on every viewport and display mode, including installed PWAs.

- Wait up to five minutes for the Ubuntu package manager lock when installing prerequisites or Tailscale, instead of failing immediately during automatic upgrades.

## 0.2.76 — 2026-09-07

- Pause ARM64 server builds/publication and ship only the native AMD64 server package; reject unsupported prebuilt installation before host changes.

- Start REST API Server and Client disabled on fresh installations; preserve explicit existing settings. Publish the accumulated interface and installer updates as matching prebuilt packages.

- Fix prebuilt installation from a shallow main clone by selecting the latest published stable release and its runtime pins in an isolated source checkout, then verifying matching source and prebuilt manifests; preserve the caller checkout and exact source/binary integrity checks.

- Simplify REST Server settings by removing port/HTTPS and extended examples, keeping Download OpenAPI visible, and adding an enforced IP/CIDR allowlist defaulting to 127.0.0.1/32.

- Initialize the REST access key automatically before serving or enabling the API, reuse it across restarts, and prevent deleting the current key without replacement.

- Replace REST Server token management with one persistent encrypted access key and ready-to-copy agent instructions; generating a key invalidates all previous tokens.

- Hide per-message overflow buttons and their reserved gutter in mobile Chat.

- Use the go-notepad Settings SVG arrow for the shared Back button across Pop Agent.

- Make signed-in UI tabs follow the REST API Server switch automatically; remove manual tab naming, connection, Stop UI and screenshot-sharing controls.

- Align REST API Server configuration with go-notepad: Start/Stop, connection cards, copyable agent instructions and scoped API tokens, keeping shared port/HTTPS settings informational.

- Add opt-in live PWA UI control through REST: discover connected tabs, inspect visible controls, click, double-click, type and send application keys; capture real PNG screenshots after browser screen-sharing consent.

- Show the go-apps green pulsing REST API Server indicator beside Settings while enabled and reachable; click opens server configuration.

- Cover blank space below conversations and the Files folder tree with contextual actions, sharing folder creation with the main Files pane.

- Add shared keyboard-accessible contextual menus to Files, Chat, explorer sidebars, Agent resource lists and Trash, with visible overflow controls, selection-aware actions and draft-preserving quotes.

- Support dropping entire folders into Files, preserving nested and empty folders with cancellable discovery and the existing upload pipeline.

- Retry manual app refresh up to ten times at ten-second intervals, replacing the fixed error with a top notification only after retries stop.

- Add isolated HTML previews with Source mode, fitted image previews including SVG, and PDF browser/download actions.

- Make the Files top bin delete selected items with confirmation instead of navigating to Trash; label both modes explicitly.

- Show Select all items in the Files top toolbar during selection, keeping its width stable for double-click navigation.

- Use mouse single-click selection and double-click opening in Files, while retaining touch tap-to-open/hold-to-select and keyboard Space/Enter actions.

- Add a minimal UTF-8 text editor to Files with Save/Cancel, retained drafts on failure and revision checks that reject stale saves.

- Make Files multi-selection discoverable with Select and touch-and-hold, tap rows to select, and preserve failed items when batch trashing only partly succeeds.

- Prevent REST API overview controls from squeezing descriptions into narrow columns on phones; hide repeated switch labels visually while retaining accessible names and align REST section typography.

- Use the shared Enabled switch in Skill and MCP editors, matching A2A and REST API.

- Align Agent editor headings and mobile navigation, keep Cancel beside Save, and use compact secondary navigation so Agent sections fit the sidebar.

- Unify Agent and provider back controls with the Settings arrow button, including a consistent 40px touch target and accessible Back label.

- Let Skill, Task, MCP and A2A creation/edit forms use the full pane width with the same 24px outer padding as their overviews.

- Reset task and MCP editors when switching destinations so New starts blank and another MCP loads its own fields.

- Prevent REST configuration actions (including Add/Remove operation and Cancel) from implicitly submitting their forms.

- Fix New skill opening the overview instead of the editor on the explicit creation route; include Agent screens in the isolated UI button crawl.

- Keep New task in the task explorer only; remove the duplicate overview action.

- Make the footer refresh fetch a fresh app document from the server, bypass the PWA navigation cache and report connection errors.

- Align Agent overview typography, headings, spacing and card widths with MCP/A2A; show Tasks and Skills summaries with links to their editors.

- Collapse the REST Server token list behind its active count; show only unrevoked, unexpired tokens, at most ten per page.

## 0.2.75

- Simplify Agent REST API into Server and Client cards with persisted switches and Edit, preserve Settings navigation, move configuration behind Edit and remove the client Delete action.

## 0.2.74

- End successful first-run bootstrap output with the command to replace an expired setup code: popman onboarding-code.

## 0.2.73

- Separate the final installation-log path from setup instructions with a blank line.

## 0.2.72

- Default OpenAI Codex and GitHub Copilot subscriptions to GPT-5.6 Sol for chat and GPT-5.6 Luna for service work, preserving explicit saved choices and the follow-chat option.

## 0.2.71

- Add Refresh models to connected OpenAI Codex and GitHub Copilot forms, preserving unsaved selections and retaining the previous list when reload fails.

- Refresh server health immediately after confirmed provider sign-in or configuration save, then ten more times at ten-second intervals before restoring normal polling. Ignore older health probes so a stale warning cannot replace the refreshed status.

## 0.2.70

- Keep Copilot login on pi native OAuth without bulk model-policy activation. Preserve valid credentials when the optional catalog is rate-limited or temporarily unavailable; retain last-known model availability on refresh. Authentication errors and cancellation still fail.

## 0.2.69

- Clarify HTTPS setup progress: “Preparing your secure connection. You will be redirected when it’s ready.”

## 0.2.68

- Persist private installation journals from source acquisition and host bootstrap through prebuilt runtime verification and systemd activation. Print the log path on start and completion/failure; record UTC stages, release identity, command exit codes and duration without capturing terminal output, credentials or setup pairing codes.

## 0.2.67

- Use the same transparent, muted Pop balloon as the chat empty state during setup and application loading, instead of the app icon with a solid background.

## 0.2.66

- Let setup own connection recovery: hide the global reconnect banner and keep setup controls interactive. Retry state reads with per-request timeouts, show branded Working progress, and offer Try again after bounded failures instead of requiring reload. Avoid duplicate boot/setup state requests.

## 0.2.65

- Show the Pop balloon and animated Working indicator while activating and checking HTTPS. Verify actual server HTTPS readiness with bounded retries, then continue directly to secure password setup without another confirmation or refresh.
- Keep subscription provider Save disabled until server status confirms OAuth credentials. Reject unauthenticated subscription configuration at the API before changing models or priority.

## 0.2.64

- Open Tailscale sign-in automatically from the initial setup click. Reserve the tab before asynchronous preparation, show progress, fall back to the current tab when pop-ups are blocked, and close unused tabs after errors, navigation or an already-connected result.

## 0.2.63

- Bundle a verified audio-only FFmpeg runtime instead of installing Ubuntu's multimedia package and its graphical/video dependencies. Keep Whisper and browser voice transcription available by default. Install only missing base/runtime apt prerequisites.
- Fetch client launchers, Local Access and official Node archives on demand through the existing server URLs, with manifest size/SHA-256 checks and a durable cache. Keep private GitHub release access through the server owner's existing gh authentication.
- Validate real speech conversion and Whisper transcription across eight formats on both native release architectures before publication. Distribute FFmpeg source and license with the release.

## 0.2.62

- Install verified prebuilt Ubuntu server releases instead of compiling and running the full development gate on each host. Native amd64/arm64 release builds run the full gate and probe the production package before publication.
- Keep FFmpeg and Whisper installed by default; omit Python, compilers and Go from normal installation. Download Node and Whisper in parallel and retain verified downloads for retries.
- Ship prepacked CLI/PLA downloads and only the target architecture's ONNX CPU binaries, without unused CUDA/TensorRT libraries. Preserve an explicit developer source-build path.

## 0.2.61

- Default OpenAI Codex and GitHub Copilot subscriptions to GPT-5.6 Sol. Retain explicitly saved provider model selections.


## 0.2.60

- Show the Pop balloon above the shared Working animation during application boot and setup loading.


## 0.2.59

- Reuse the Settings Add Provider flow during first-run setup, including API keys, subscriptions and custom endpoints. Preserve cancellation and skipping, and advance only after a successful save.


## 0.2.58

- Preserve the service owner as the explicit Tailscale operator during browser-driven login, including the restricted subprocess environment.


## 0.2.57

- Share the onboarding token header between browser and server so paired browsers can start Tailscale sign-in and enable HTTPS. Add coverage for the full network setup request sequence.


## 0.2.56

- Launcher 1.1.5 supports verified Windows ZIP runtimes; publish the Node runtime matrix for Windows, Linux and macOS on amd64/arm64.

- Server installation now packages client downloads and the managed Node runtime before activation, avoiding missing installer/runtime manifests on a fresh server.

- Inherit pi native compaction defaults and document authenticated HTTPS Git clone for private installations.

- Windows PLA installation provisions the managed Node runtime instead of requiring Node on PATH, and terminates the existing process tree before upgrading.
- Explicit MCP isError results now surface as failed tools while preserving their untrusted-content envelope.


## 0.2.55

- Preserve discovered MCP argument schemas in model tools and omit redundant structured result copies only when identical JSON is already present in a text block. Distinct data, annotations and errors remain intact.


## 0.2.54

- Create or repair the Pop Local Access Start menu shortcut with the Pop icon as part of the Windows installer. Build the Windows tray as a GUI application so opening it does not leave a console window.


## 0.2.53

- Fix tray shutdown leaving the Windows Node local-access transport alive after its launcher exited. Terminate the process tree before cancelling and apply tree termination to context cancellation too.


## 0.2.52

- Accept conversation messages and queue edits when the selected known local machine is offline. Preserve its routing binding and expose clearly unavailable local tools without executing local work on the server.


## 0.2.51 — 2026-09-05

- Add Agent → REST API with Server tokens/reference and outbound Clients on one page.
- Scope integration reads, sends and cancellation; persist idempotent responses and content-free activity with authenticated SSE.
- Expose configured REST operations to the agent with encrypted credentials, public HTTPS screening and Plan Mode/taint restrictions.


## 0.2.50 — 2026-09-05

- Exclude transport metadata from skill routing and reject procedural skill matches for social-only messages.
- Frame routed skills as task-scoped reference, never as a new request or permission to execute procedures.


## 0.2.49 — 2026-09-05

- Add per-chat CLI model selection with a searchable `/model` picker, explicit provider/model arguments and `/model default`.
- Synchronize model selection across clients, preserve drafts on failure, and serialize model changes with fresh-chat creation and message submission.
- Show unavailable persisted selections and sanitize model labels against terminal control sequences.


## 0.2.48 — 2026-09-05

- Fix local file reads and directory creation hanging because the CLI dropped access and mkdir prerequisite calls.
- Return an explicit error for unsupported local operations instead of silently discarding valid call envelopes.


## 0.2.47 — 2026-09-05

- Launcher 1.1.4 checks native updates for `pop --chat` as well as bare chat launches.
- Restore titles, history and live state when resuming a chat, including archived conversations; reject missing or unknown IDs.
- Ignore stream events already covered by the history snapshot and prevent late sends from replacing a newly selected conversation.


## 0.2.46 — 2026-09-05

- Launcher 1.1.3 checks updates without reinstalling an equal CLI version. Use `pop update --repair` for explicit repair.
- Successful interactive login opens chat immediately; local-access installers use login-only mode to continue setup.


## 0.2.45 — 2026-09-05

- `pop update` updates both the native launcher and CLI with verified artifacts and native rollback.
- Launcher 1.1.2 forces verified CLI repair/update before bare `pop` opens chat, without downgrading a newer installed version.

- Validate CLI authentication and the event stream before showing a conversation; preserve session errors with actionable sign-in guidance.
- Use renewed credentials for subsequent API requests and background local-access renewal; resume refused local access after a new same-server login.
- Explain how to install/open Pop Local Access or explicitly choose Server only when the selected computer is offline.


All notable changes to Pop Agent. Dates are ISO. Current normative rules start
at `docs/specs/Spec-Pop-General.md`; detailed migrated decision history lives in
`docs/specs/History-Pop-Spec.md`.

## v0.2.44 — 2026-09-04

### Added

- **Fresh Ubuntu installs now continue in a guided private-network setup page.**
  The installer prints a private-LAN HTTP URL and 15-minute one-time code; that
  restricted surface can only pair the browser, authorize Tailscale and enable
  tailnet-only Serve HTTPS. It never mounts password, login, recovery or product
  APIs. Master-password creation begins only at the verified `https://…ts.net`
  origin, conflicting Serve configuration is preserved, Funnel is never used,
  and `popman onboarding-code` recovers an expired pairing code.

## v0.2.43 — 2026-09-01

### Changed

- **`pop version` is now the canonical CLI version command.** It prints the
  installed client version locally before profile, API or local-access setup.
  The native launcher follows the same offline fast path, while `--version` and
  `-v` remain available as compatibility paths for existing probes.
- **Archived conversations are now server-enforced read-only until restored.**
  New messages are refused without persistence, queueing or agent work, and
  single or bulk archive actions refuse chats that are still answering or have
  pending input instead of hiding active work or partially filing a batch.
- **The interactive CLI keeps an externally archived chat visible and read-only.**
  Archive events and server refusals retain unsent drafts without false transcript
  rows, while explicit `/unarchive` restores the same conversation in place.

## v0.2.42 — 2026-09-01

### Added

- **The interactive CLI can archive its current conversation with `/archive`.**
  The command is discoverable through help and autocomplete, refuses unpersisted
  or busy sessions without a request, and resets like `/new` only after the
  archive succeeds.
- **Fresh Ubuntu installs now include the local voice runtime and an optional
  Tailscale Serve helper.** The recommended public path is clone plus one
  bootstrap command with safe default data/workspace locations. Repository-
  pinned, hash-verified whisper.cpp binaries and apt-managed ffmpeg make voice
  ready with the server, while the separate Tailscale helper acts only after
  local health and an existing authenticated tailnet are verified.

- **The repository is prepared for a deliberate public launch.** Public
  onboarding, support/security/contribution policies, issue and pull-request
  templates, a release/cutover runbook, least-privilege commit-pinned CI,
  Dependabot, package metadata and a gate-enforced publication-readiness check
  are included without changing repository visibility or publishing a release.
- **Fresh GitHub servers now have a fail-closed installer.** The root POSIX
  installer supports ordinary non-interactive public HTTPS Git acquisition and
  optional authenticated GitHub CLI access for private repositories and forks.
  It resolves a completed clone to one exact branch, tag, or commit; validates
  secure destination ancestry plus a clean non-symlinked checkout before and
  after no-replace activation; uses a minimal explicit environment for bootstrap
  handoff and retry; and preserves failures with an exact retry command. Public
  v0.2.42 instructions retrieve the planned immutable installer into an
  owner-only temporary file and invoke it with the same release ref instead of
  using a producer-to-shell pipeline; offline fixtures cover both acquisition
  paths.
- **Clean commits can be acquired from verified local Git bundles.** A release
  packager emits immutable commit/version-named bundle and SHA files, while the
  non-root local installer verifies SHA-256 and bundle integrity, clones exactly
  the requested commit through staging, and hands the clean checkout to the
  existing host bootstrap without HTTP or remote manifests.
- **Existing Ubuntu checkouts can prepare a private server toolchain before systemd installation.**
  A small non-root POSIX bootstrap supports Linux amd64/arm64, optionally installs
  narrowly scoped apt prerequisites only after explicit opt-in, and stages exact
  repository-pinned official Node/Go/whisper.cpp archives after size, SHA-256, path/link and
  executable checks. It preserves matching verified runtimes, puts managed npm
  and Go on the installer `PATH`, supports preparation without systemd handoff,
  and does not acquire source or configure network exposure or accounts.
- **Prepared Linux/systemd checkouts now have a real production installation step.**
  The non-root TypeScript installer validates the existing host and clean
  checkout, runs locked dependencies and the full gate, generates and activates
  a loopback-only production unit through narrowly scoped sudo, and performs a
  bounded health check. It does not bootstrap system packages or network/TLS
  infrastructure; the old ubuntu-home source-level development unit was removed.
- **Outbound Agent2Agent (A2A) client integration.** Agent → A2A now manages
  owner-configured remote agents beside MCP, discovers A2A 1.0 Agent Cards,
  persists foreground text tasks, exposes bounded normal-mode A2A tools and
  protects credentials and network calls with encryption, SSRF screening,
  DNS pinning, cancellation and external-content taint policy. Custom
  same-origin Agent Card paths and server-renewed Microsoft Entra client
  credentials add direct Microsoft Foundry v1 interoperability.

### Changed

- **Uploads have explicit beta limits and recovery controls.** Files accepts
  100 MiB per file and starts immediately in the open folder, sends
  sequentially, retries transient failures once, and supports cancel/retry.
  Chat accepts eight combined uploads/Files references, 25 MiB each and
  100 MiB total; audio remains capped at 25 MiB.
- **PWA updates are automatic while server activation is deliberately manual.**
  Every PWA checks every ten minutes and on foreground resume, activates a ready
  worker automatically, and shows retry only on failure. Unsafe automatic
  server activation settings and their background coordinator were removed;
  manual server and pi activation now require confirmation, and every server
  candidate requires an exact green-gate receipt.
- **MCP configuration now matches the A2A security boundary.** Strict transport,
  endpoint, header and secret validation, write-only credential presence,
  explicit credential clearing, stable not-found errors, sanitized diagnostics
  and removal of internal working paths are covered at the HTTP boundary.

- **Production systemd installs keep pi catalog bookkeeping offline.** The
  generated unit now carries the required `PI_OFFLINE=1` setting, matching the
  runtime contract and avoiding a network-dependent post-login stall.
- **PWA local access on macOS and Windows now requires the visible tray runtime.**
  Interactive CLI connections no longer make those machines appear online to
  the PWA or receive PWA-selected local tool calls; tray reconnects preserve the
  selected machine without ever falling back to an interactive connection.
- **Legacy npm-global CLI updates now follow the packed release instead of the server version.**
  `pop update` and generated migration commands use the same-origin non-cacheable
  `/cli-latest.tgz` alias, with truthful output when the packed CLI trails the
  server. CLI packaging retains immutable historical tarballs at their existing
  versioned URLs while the manifest and alias select the current pack.
- **The interactive CLI now reserves Escape for interrupting runs.** Escape
  never starts a new chat, while an open picker retains ownership of it. Ctrl+C
  first clears the editor and only a second consecutive press within 500 ms uses
  the clean quit path; `/new` remains the genuinely clean conversation action.
- **Chat messages can contain attachments without text.** The PWA composer and
  HTTP API now accept uploaded attachments or Files references on their own,
  including durable queued input and queued-message edits, while still rejecting
  a completely empty message.
- **Worker delegation can now fan out up to five implementation tasks.** Each
  packaged worker runs concurrently in its own Pop-managed worktree from the
  same source HEAD, returns an independent patch handoff and records its own
  usage row; the single-task facade remains compatible.
- **Worker delegations now have their own Subagents card in the chat timeline.**
  Progress, completion, failure and handoff details no longer mix with the
  agent's ordinary tool-run card.
- **Tool-run cards now match the quieter Thinking card color.** Their arrow and
  labels use the same darker muted text instead of the brighter treatment.
- **The project specification is now modular.** `docs/specs/Spec-Pop-General.md`
  is the normative entry point, subsystem rules live in focused specifications,
  and detailed decision history is separate from current requirements. The old
  monolithic root specification was removed after every tracked reference and
  normative section was migrated; the gate now validates the specification set.
  The General overview was then reconciled with the current code: it now maps
  capabilities and state ownership, corrects runtime paths and removes obsolete
  roadmap, multi-user and development-environment assumptions.
- **The Backend specification is now a complete server guide.** It defines the
  TypeScript process model, clean-architecture boundaries, composition, ports,
  SQLite ownership, migration discipline, persistence invariants, deletion,
  failure handling, performance rules and backend test obligations without
  duplicating the exact migration-owned schema.
- **The Frontend specification is now a complete PWA guide.** It defines boot,
  routes, responsive navigation, state ownership, service/store boundaries,
  SSE reconciliation, IndexedDB cache, streaming performance, offline health,
  install/update lifecycle, push, accessibility and device test obligations;
  server-owned Files, pi and queue internals now route to their focused specs.
- **The pi integration specification is now a complete engine guide.** It defines
  adapter boundaries, isolated runtime loading, SQLite/JSONL ownership, prompt
  and tool construction, Plan Mode, session freshness, events, steering,
  concurrency, Stop, compaction, failover, native commands, SDK update contracts
  and test obligations. The supporting end-to-end agent flow now describes the
  current durable FIFO and SDK behavior without historical build phases.
- **The real-time events specification is now a complete synchronization guide.**
  It defines the SSE/HTTP/PLA boundaries, ticket and revocation lifecycle,
  connection uniqueness, retries and foreground recovery, event catalog,
  ordering and batching, bounded backpressure, snapshot convergence, polling
  policy, Local Access integration, security and test obligations.
- **The installation specification now covers every delivered channel.** It
  defines PWA, CLI/launcher, managed Node, Pop Local Access, server checkout,
  pi candidate and deployment-supervisor boundaries, plus public artifact,
  caching, integrity, rollback, removal and release-test obligations.
- **The Local Access specification is now a complete privilege-boundary guide.**
  It defines stable machines versus transient transports, disabled-first policy,
  WSS/HTTPS fallback, selection and routing, tray/CLI lifecycles, local tool
  projection, limits, cancellation, safety, failure behavior and platform tests.
- **Every modular normative specification has completed the final code review.**
  API, background tasks, CLI, providers/models and deployment/operations now
  join the previously reviewed subsystem guides. Stale proposal claims such as
  a delivered IP allowlist, `/v1/ax` control plane or live HTTP restore were
  removed; the 16-document set now describes the shipped product boundaries.
- **Pop Local Access has one synchronized permission per computer.** The PWA,
  tray and CLI now share the same persistent **Allow access to local files**
  switch. Access is disabled by default and enforced by both server and PLA;
  turning it off keeps ordinary messages working with server tools. The tray no
  longer confuses a connected control channel with enabled file access, and
  duplicate CLI/tray connections remain one stable computer identity.
- **The installed PWA is the desktop app.** The native WKWebView/WebView2
  wrapper, tray helper and Setup packages were removed. Browser installation
  and service-worker updates now own the desktop experience; Pop Local Access
  remains a separate optional capability.
- **CLI installation commands can stay current.** The stable, non-cacheable
  `cli-latest.tgz` URL redirects to the server's exact immutable CLI package,
  so setup instructions do not need a version edit after each update.
- **Windows can install the CLI from one server-specific command.** The new
  same-origin `install.ps1` bootstrap installs a compatible Node LTS when
  needed, installs this server's exact CLI package, and prints the login
  command. CLI self-update now invokes `npm.cmd` correctly on Windows.
- **CLI reasoning now matches the web.** It is visible by default, stays in the
  transcript after an answer settles, survives steering boundaries, and
  `/think` redraws both live and historical answers immediately. The choice is
  remembered in a device-local preferences file separate from login tokens.
- **The built-in skills got a review: 17 became 7.** The generic ones
  (writing, summarizing, translating, explaining, brainstorming, math,
  planning) are gone -- any current model does that natively, and each one
  was a candidate competing with YOUR skills in the router. What remains is
  what only Pop Agent knows: the manual, the codebase map, web research,
  notes, shell safety, the daily review and code work. Built-ins you never
  edited that left the roster are cleaned up on boot; one you edited becomes
  yours. And every skill can now be switched off without deleting it --
  built-ins included.
- **The skills list has a filter.** All Skills / Personal / Auto / Pending /
  Built-in, with the count of skills waiting for your approval right on the
  filter, so an auto-skill never waits invisibly.

### Fixed

- **First-run and recovery credentials now fail closed.** The setup token can
  acknowledge the displayed recovery key but cannot reach any other API while
  setup is pending; resuming setup rotates a lost key, password changes and
  recovery issue a new one-time key, and passkey sign-in now honors **Keep me
  signed in**. Browser recovery screens retain a new key only for the page that
  must acknowledge it.
- **Uploads now have one consistent, recoverable contract.** Binary downloads
  and multipart uploads share session renewal and invalid-session handling;
  Files uploads run sequentially, continue past individual failures and reload
  authoritative state. Chat enforces eight attachments, 16 MiB each and 20 MiB
  total, while Files and audio use explicit 25 MiB limits and voice prevents
  overlapping transcriptions.
- **Independent Settings controls no longer overwrite each other.** A strict,
  atomic PATCH contract updates only named fields, provider cards save their
  credential/models/priority in one validated request, and cancelled custom
  provider drafts create no hidden provider. Memory, backup, security,
  Auto-skills, voice, PWA update and server-update actions now expose errors,
  confirmation and cancellation states instead of failing silently.
- **MCP and navigation edge cases are now explicit.** MCP is a first-class
  explorer with loading/not-found/error states and guarded toggles; stdio
  arguments are one exact argv item per line so spaces are preserved. A2A is
  documented in the shell route map rather than incorrectly listed as a
  Settings destination.
- **Web clients now surface deployment restarts as connection recovery.** A
  failed transport immediately shows **Server reconnecting…**, keeps loaded
  content readable but actions inert, preserves send drafts/attachments with a
  specific notice and probes after 1 second with exponential backoff capped at
  10 seconds. Unsafe non-idempotent requests are never replayed automatically.
- **Installed-PWA sends no longer depend on Local Access automatically.** PWA
  upgrades migrate former automatic selections to Server only; enabling access
  does not route messages until the user explicitly chooses a computer. Explicit
  local sends and queue edits retain one stable machine through a bounded
  30-second reconnect window, distinguish offline from unknown selections,
  preserve exact drafts/attachments and emit content-free diagnostics.
- **The composer model picker no longer looks toggled on.** The **M** control
  keeps the same neutral visual state while the selected model remains active;
  opening it still shows the active provider/model with its selection mark.
- **Migration and internal-file collisions now fail safely.** Boot validates all
  migration names and rejects duplicate versions before touching SQLite. Voice
  transcription claims its temporary input/output names exclusively and redraws
  on collision instead of allowing an existing file to be replaced.
- **Cached pi sessions no longer retain stale prompt or tool context.** Changes
  to Auto-skills policy, living/recent memory, enabled MCP capabilities or the
  selected local computer now reopen the same JSONL before the next operation.
  The pi candidate gate also verifies the complete session, tree, resource,
  local-tool, completion and auth API surface Pop Agent actually uses.
- **The shared SSE channel now survives lifecycle races without stale access.**
  Ticket requests and EventSources are generation-controlled, foreground/BFCache
  recovery replaces suspended sockets, old sources cannot trigger extra retries,
  and ticket-bound session revocation stops existing streams. Slow clients have
  a bounded backlog, while archive and provider/model changes now converge on
  every connected device. The unused software-update wire event was removed.
- **Client installation now fails closed and repairs running Windows trays.**
  Release manifests are validated before scripts are rendered, remote launcher
  profiles require HTTPS, managed Node archives are consumed from the verified
  same-origin release, Mac PLA bootstrap can install that runtime before login,
  and Windows tray replacement preserves/restores the previous executable.
- **Long-lived Local Access transports now have bounded replay and backpressure.**
  WebSocket frames and decoded fallback bodies share a 12 MiB ceiling,
  long-poll queues enforce aggregate bytes, replay IDs and completed call
  results use bounded windows, overflow unregisters the transport, and attach
  protocol/metadata are validated before persistent machine state is written.
- **Web retrieval is pinned to its screened public DNS answers.** This closes
  the DNS-rebinding gap between SSRF validation and connection, refuses
  credential-bearing URLs/redirects, and stops reading at the response cap.
- **Backup and durable-memory boundaries now fail closed.** SQLite snapshots
  include committed WAL state through the asynchronous online backup API; live
  HTTP restore is refused in favor of stop/extract/start through `popman`; and
  both Settings and agent memory writes redact deterministic credential shapes.
- **TypeScript runtime boundaries are stricter.** API bodies are rejected before
  parsing above the global 30 MiB ceiling, PLA call frames use a discriminated
  runtime parser instead of an unsafe assertion, backup creation leaves the
  event loop free, and type-aware promise/type-import linting covers all
  production TypeScript, including the PWA.
- **Self-changes now consult the normative specifications by default.** The
  permanent system prompt starts at `Spec-Pop-General.md`, narrows to relevant
  focused specs, and requires comparison with current code and tests before
  implementation, even when no architecture skill is routed for the turn.
- **High-risk TypeScript modules now have narrower responsibilities.** Chat-list
  explorers, run state, provider catalog resolution, pi event translation,
  pi session adaptation and shared wire contracts live in focused modules;
  dated implementation-history comments were removed while current invariants
  remain next to the code they protect.
- **Login and logout survive denied browser storage.** Session access is guarded
  against browser `SecurityError`/quota failures and falls back to memory for the
  current page, while logout still clears credentials and transcript cache.
  Slow PWA installation and IndexedDB eviction paths now have direct regression
  coverage rather than relying only on Settings/component tests.
- **PLA installation survives server version bumps and zsh.** The launcher
  manifest now advertises the latest immutable packed CLI release instead of
  404ing whenever the server version moves ahead of its artifacts, and the
  copied macOS command no longer assigns zsh's read-only `status` variable.
- **`pop update` works on Windows.** It now runs npm's JavaScript entrypoint
  through the current Node executable instead of asking `spawn` to execute the
  `npm.cmd` shell wrapper, which failed with `EINVAL`.
- **CLI answers no longer appear above their local command log.** `ran here: …`
  notices stay inside the active assistant block, before its prose, instead of
  accumulating below the completed response in Windows Terminal.
- **The provider surface, end to end** (a review pass, nineteen findings):
  - Removing the provider that was answering no longer leaves the app pointed
    at nothing -- the head of the list is re-elected as the default the moment
    its key is cleared or the provider is deleted.
  - A provider that keeps failing now waits longer each time before being
    tried again (1, then 5, then 15, then 60 minutes) instead of a flat five
    -- and a connection test that passes, a saved key or one successful run
    forgives it at once.
  - Titles, summaries and voice cleanup now respect the same failover order
    as chat, skip a provider that is sitting out, and count what they spent:
    background work lands in the Usage ledger as `service` rows, with a
    subscription's token counts kept but its cost zero.
  - Retrying an answer on another provider no longer asks the model the same
    question twice -- the conversation is rewound before the retry, and a run
    that had already started thinking or calling tools is never silently
    re-executed somewhere else.
  - A provider whose sign-in expired shows it: a "sign in again" badge on the
    card instead of a run that only fails when you send it.
  - The model list for a provider is refetched when you change its key or
    endpoint, instead of showing yesterday's catalog.
- **Subscription sign-in completes the moment it completes.** The device-code
  card used to stay on "waiting" after approval: pi's login promise resolves
  only after post-login bookkeeping (remote catalogs, availability) that can
  stall on the network without a timeout. Now the flow resolves the instant
  the credential lands in `pi-auth.json`, bookkeeping runs in the background,
  and a saved-but-not-yet-visible provider appears in the list on save
  because configured-ness reads the auth file, not pi's lagging snapshot.
  The service also runs with `PI_OFFLINE=1`, so the bookkeeping is local by
  construction (catalog updates ride pi package upgrades).
  - A negative OpenRouter balance renders as `-$0.10`, the balance is fetched
    once per visit instead of once per redraw, and the enable/disable switch
    is back on each provider card.

### Added

- **Pop Agent learns from conversations you did not flag.** Every few minutes it
  reads one conversation that has gone quiet and, if something in it was a
  procedure worth keeping, writes it down as a skill. Nothing to press and
  nothing to remember -- and if there is nothing to learn, which is the usual
  answer, it costs nothing at all: a round with no new conversation makes no
  request to a model. Anything it writes waits for you on the Skills screen,
  the same queue as a skill you asked for.
- **A skill Pop Agent already knows gets a rewrite, not an overwrite.** When what
  it learned matches a skill you have, the new version waits beside the old
  one with the text laid out, and the skill you approved keeps working until
  you say yes. A conversation that read a web page is never learned from at
  all.
- **Learned skills have a ceiling.** Past fifty, the ones the router never
  reaches for are archived -- listed at the bottom of the Skills screen with
  a button to bring any of them back. Archived, never deleted: a skill used
  once a year is exactly the one a "delete what is idle" rule would throw
  away.
- **A line on the Skills screen says what Pop Agent has been doing**: when it last
  looked and how much is waiting on you. Settings → Skills can slow it down
  or switch it off.
- **A conversation can become a skill, by asking.** Say "vira skill" -- or
  the same thing in English or Spanish, or any way you phrase it -- and Pop Agent
  distils what just worked into a skill that comes back on its own the next
  time it is relevant. There is no button and no command to remember: the
  request is understood as a request. New skills wait for you on the Skills
  screen by default; a setting there lets them go live on their own if you
  come to trust them.
- **The Skills screen shows where each skill came from and what it earns.**
  A badge for built-in and for learned, a queue for anything waiting on your
  approval, and a use count per skill -- so a skill nothing ever routes is
  visible as such.
- **A Service Model per provider.** The model Pop Agent uses for its own work --
  naming conversations, summaries, tidying voice notes -- now sits beside
  each provider's key instead of being one global choice. It follows that
  provider's chat model until you pick something cheaper. The old single
  setting could not be right: a model id only means something inside one
  provider's catalogue, so an install that named a Moonshot model asked
  OpenAI for it the moment a chat ran there.

### Changed

- **The Skill Router picks better.** It now fuses its word-matching and its
  meaning-matching with the same reciprocal-rank fusion the memory search
  uses, and the bar for a semantic match is read from each request rather
  than being a fixed number -- measured against the real vault, that took
  routing from 4 correct out of 10 to 7, without adding a single wrong pick.
  Skill vectors are also kept on disk now, so the first message after a
  restart no longer waits for the whole vault to be re-read (16s to 2s).

### Fixed

- **A key pasted into a conversation can no longer leak into a skill.** The
  scrubber only caught secrets carrying a label ("api_key = …"); a bare
  `sk-…`, `ghp_…` or AWS id pasted on its own line sailed through into a
  skill body that future prompts would replay. The shapes recognizable by
  form alone are now redacted whole-line too.
- **"Don't create a skill" no longer creates a skill.** The explicit-request
  matcher heard the order inside the refusal ("não cria uma skill" contains
  "cria uma skill"). A negation word before the phrase now cancels it.
- **A small skills vault no longer admits its luckiest member.** With fewer
  than five skills to measure there is no spread to read, and the fallback
  floor sat inside the embedding model's noise band. The floor rises to the
  band's measured p90 there instead.
- **A revision proposed on a name collision no longer records a perfect fake
  score.** The similarity column exists to retune the dedup bars with real
  measurements; it now gets the measured cosine or nothing at all.
- **The learning tick no longer reads every conversation to learn nothing
  changed.** One query answers "anything new anywhere?" against the
  watermarks; histories open only when something actually moved.
- **A skill whose steps contain a command no longer gets thrown away.** Pop Agent
  asked itself for the procedure in a format where every quote and brace had to
  be escaped, so the moment a skill contained a real `curl` line the whole thing
  was discarded as unreadable. It now writes the procedure plainly, with nothing
  to escape.
- **A skill Pop Agent was writing no longer vanishes when the answer runs long.**
  If the model ran out of room mid-sentence, everything it had written was
  discarded and the conversation was marked as read, so a procedure it had
  just worked out was lost without a trace. It now keeps whatever finished and
  comes back for the rest.
- **Pop Agent no longer refuses to learn from conversations about itself.** The
  check that keeps it from learning anything out of a page it read was also
  reading your own messages, and it treats the words "system prompt" as a
  warning sign -- so the conversations most worth learning from, the ones
  about how Pop Agent works, were quietly the ones it always skipped. It now looks
  only at what a tool brought back from outside.
- **The injection detector stops flagging ordinary API notes.** Text like
  "send an Authorization header, and a session token" read as an attempt to
  steal a credential. It now also reads instructions it used to miss
  altogether: a secret smuggled out inside an image URL, a few more
  Portuguese phrasings, and an instruction hidden as base64.

- **Editing a learned skill really does make it yours.** The promotion was
  written to disk and then read straight back as "learned", so the automatic
  housekeeping still considered it its own.

- **Files is a plain folder on disk.** `POP_AGENT_DATA_DIR/files/` with real
  names is the single source of truth. The Files tab -- its own sidebar tab
  next to Chats and Tasks -- renders the disk: nested folders with a `+`/`−`
  toggle, "New folder", uploads landing in the open folder, rename and move
  as one path edit, and search (`GET /v1/files/search`, the agent's
  `files_search`) matching a name or any path segment live across the whole
  tree. The agent works in the same folder -- `Files/` inside its workspace
  -- so a file it saves there is immediately visible, downloadable through
  an HMAC-signed link that signs the path, and @-mentionable in the
  composer. Deleting moves to `files/Garbage/` (restorable from the Trash
  screen; a daily sweep empties it after 30 days), and the agent's
  `delete_file` makes the same move -- never a hard remove. "Which chat made
  this file" is `file_provenance`, an append-only log. The artifact catalog
  this replaces -- id-named blobs, the `artifacts` table, versions,
  `save_artifact`/`read_artifact` -- is gone; re-saving a name overwrites,
  as a folder should.
- **`pop` -- the terminal client, with hands.** A chat in the terminal is
  an ordinary Pop Agent chat (same memory, budget, taint guard, PWA visibility),
  but a message typed in a terminal hands the agent a second set of tools --
  `local_bash`, `local_read`, `local_write`, `local_edit` -- running on the
  machine that typed it, over a dedicated WebSocket hands channel with a
  heartbeat. Hands belong to the message, not the chat: each message runs on
  the machine it was typed on; a phone message gets the server's tools only.
  TUI built on pi-tui, one-shot mode (`pop "…"`), login and per-server
  profiles. The server serves its own client
  (`npm i -g https://your-pop/cli-X.Y.Z.tgz`) and the attach compares
  versions: silent when compatible, one line when merely behind, refused
  below the server's minimum.
- **`popman` -- the operator's tool.** `start | stop | restart | status |
  backup | backups | restore | reset-password | update`, shipped with the
  server and running only there; the only thing that touches systemd, SQLite
  and the backups directory.
- **Every message remembers where it came from**: `client`
  (`web | pwa | desktop | cli | api | task`), platform and IP are recorded
  per message, not per connection.
- **The agent sees its own scheduled tasks** (`list_scheduled_tasks`).
- **Delete every archived conversation in one step**, and a refresh button
  beside Settings.

- **Deleting a chat now stops what it was doing first**: the running answer is
  aborted (which kills the agent's process group) and anything of that chat
  still queued is dropped, before a single row is deleted. The chat's
  attachment folder in the workspace goes with it, as before.
- **Daily orphan sweep**: attachment folders whose chat no longer exists, and
  scratch files (*.png, *.yaml, *.mjs) sitting in the workspace root untouched
  for thirty days, are removed once a day. It never touches a live chat's
  files, a project directory, or anything outside the workspace — conversation
  history is never swept, only files derived from it.
- **Background tasks**: a sidebar tab next to Chats and Files. A task is
  a prompt with a schedule — once, or every N minutes/hours. Each run opens its
  own conversation named after the task and goes through the normal chat
  pipeline, so failover, compaction and error messages all apply and the result
  is readable like any other chat. Task runs are serialised: never two at once.
  Run now, an enabled switch, and a full-screen create/edit form.
- **Home list redesign**: search reaches archived chats (badged); archived
  browsing moved to the ... menu.
- **Swipe on a chat row** (touch): right = delete (confirmed), left =
  archive/unarchive.
- **Composer strip**: thinking visibility toggle (per device) and the model
  picker, under the composer instead of the header.
- **Font size** in Settings -> Appearance: Small/Default/Large/Extra large,
  remembered per device.
- **Restart resilience**: a server restart stores the partial answer of any
  in-flight run, marked as interrupted, instead of losing it.
- **Settings -> Updates**: three cards -- the PWA update check, the Pop Agent
  server card (latest origin tag + the update command, with a push
  notification per new version that deep-links here), and the environment
  versions (pi, Node, ffmpeg, poppler, tesseract, whisper.cpp).
- **Multimodal image input** (RF-014): when the conversation's model accepts
  images, image attachments are sent to the model inline instead of only being
  saved to the workspace. Gated on the model's declared input modalities, so a
  text-only model (the default) is untouched and still reads files with its
  tools.

### Fixed

- **PWA update prompt now actually appears.** An installed PWA (and an
  already-open desktop tab) only re-checked its service worker on
  navigation, so a shipped fix could sit unseen for days. The client now
  checks on a device-chosen interval (Settings → Appearance → App updates,
  default 10 minutes), whenever the app is resumed, and on a manual
  "Check now" button. The server marks `sw.js` and the HTML shell
  `no-cache` while keeping hashed assets `immutable`, so a stale worker can
  no longer be pinned by a heuristic cache.
- **Embeddings die with their messages**: deleting a chat no longer leaves
  its embedding rows behind.
- **A ghost chat can be deleted**, and the chat lists follow the foreground
  app instead of going stale.
- **Applying an API key no longer waits on provider catalogs**, and the
  elected provider pair follows the card it points at.
- **The danger zone says what each switch actually switches.**
- **The Files search box was a sliver on a phone**: the toolbar buttons filled
  the line and left it squeezed. It now drops to its own full-width line below
  them on a phone, and shares the row from `sm` up.
- **Push notifications never arrived on iPhone**: everything was in place — the
  service worker, the Settings opt-in, the subscription, the send when a run
  finishes — but the notifications were signed with a contact address ending in
  `@localhost`, which Apple rejects outright (403 BadJwtToken) without telling
  anyone. Pop Agent now signs with a real URL, and `POP_AGENT_PUSH_SUBJECT` lets the
  operator use their own address.
- **Every delete from the UI looked dead**: the API layer parsed JSON out of
  every ok response, but a DELETE answers 204 with no body, so the parse threw
  after the server had already deleted — the row never left the screen. Chats,
  files, skills, backups and passkeys were all affected.
- **Unarchiving a chat made it vanish from both lists** until a reload: the
  store only removed it from the active list and refreshed the archived one.
  Both lists refresh now.
- **The composer showed a scrollbar on a single line**: the auto-grow height
  missed the 2px of border (border-box) and left the box permanently 2px short
  of its content. The scrollbar now appears only once the composer hits its
  one-third-of-the-screen cap, like aw's.

## v0.2.0 — 2026-07-31

Everything on the v0.2 roadmap.

### Added

- **Skills and the Skill Router** — markdown skills the agent pulls in when a
  request calls for them, chosen by a pure lexical router; fifteen defaults led
  by *know-thyself*; a full-screen editor in Settings.
- **Backup and restore** — the data directory as a tar.gz (the encryption key
  excluded), created, downloaded, restored and deleted from Settings.
- **Web Push** — the server tells your phone an answer is ready even with the
  app closed; opt in per device.
- **Passkeys (Face ID / fingerprint)** — register a device and unlock with it
  instead of the password.
- **Local voice** — record a note, transcribed on the server with whisper.cpp,
  no tokens.
- **Cost dashboard** — total spend, tokens and runs, by model and by day.
- **Update status** — the installed versions and whether a newer pi exists,
  with the one-line update command.

### Notes

- Attachments reach the agent through its workspace; it extracts what it needs
  with its own tools rather than a bundled PDF/OCR pipeline.
- Pop Agent does not update itself from the running process; the update is a gated
  shell command.

## v0.1.0 — 2026-07-31

The first usable cut: a personal agent you talk to from your phone, that runs
real tools on your own server, remembers across conversations, and keeps notes.

### Added

- **Chat over HTTP + SSE** — streaming answers, thinking and tool cards, a
  queueing composer with attachments and voice, one run per chat with a global
  queue, Stop, and per-run usage accounting.
- **pi agent bridge** — the Kimi K3 model via OpenRouter, persistent sessions
  that survive a restart, the built-in read/bash/edit/write tools.
- **Provider configuration** — OpenRouter key (encrypted, write-only), a live
  model catalog with a labelled source, and a key test.
- **Auto-titles and summaries** written by the service model.
- **External-content safety** — a pure sanitizer (invisible-strip, injection
  patterns EN+PT) and a per-turn taint that pauses a destructive command in a
  tainted turn for an inline Allow/Deny.
- **Notes vault** — the agent's own markdown vault behind a path jail, with
  list/read/search/write tools.
- **web_fetch** — a public page in, its readable text out, with SSRF protection.
- **Memory** — full-text search over every message, tools to search and open
  past conversations, and a living document Pop Agent keeps about you.
- **Local voice** — record a note, transcribed on the server with whisper.cpp,
  no tokens spent.
- **PWA** — installable, offline shell, update prompt, the final Pop Agent icon.

### Security

- Deleting a chat deletes everything it left behind: rows, pi's JSONL session,
  and the chat's attachments.
- The provider key never leaves the server; the secret key file is excluded
  from backups.
