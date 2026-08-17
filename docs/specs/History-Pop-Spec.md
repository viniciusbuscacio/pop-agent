# Pop Agent — Historical specification decisions

**Status:** historical, non-normative
**Source:** changelog migrated verbatim from the former `pop-agent.spec` version 2.06

> Current rules live in the normative specification set entered through
> [Spec-Pop-General.md](Spec-Pop-General.md). Entries below explain how rules
> evolved and may describe superseded behavior.

## Changelog

- 2.04 (2026-08-15): **The installed PWA replaces the native Desktop product
  (§14, §17.1).** Pop Agent no longer ships or serves WKWebView/WebView2 hosts,
  tray helpers, DMG/Setup artifacts or native session bridges. The browser owns
  installation and updates. PLA remains optional and separate; PWA messages
  never inherit a machine without explicit selection.

- 2.03 (2026-08-15): **The PWA exposes the browser's real installation action
  in Settings (§14).** The app captures Chromium's install event at boot,
  presents an explicit Install Pop Agent button while eligible, recognizes its
  standalone installed state, and falls back to accurate browser instructions
  where programmatic installation is unavailable. The browser retains the final
  confirmation and the page never simulates a successful install.

- 2.02 (2026-08-15): **v0.2.30 makes the footer refresh the device's force-update
  control (§14, §15).** One press reloads active and archived conversations,
  checks the service worker, and immediately activates/reloads a newer PWA when
  one exists. When already current it remains a quiet data refresh; update
  activation still flows through the single PWA registration owner.

- 2.01 (2026-08-15): **In-app notices no longer disappear into the dark
  surface (§14).** The shared toast skin uses a restrained blue-grey notice
  surface and border, while preserving the normal text and accent-action
  colours. Plan Mode, thinking, trash undo and every other transient app notice
  receive the same treatment through design tokens rather than private colours.

- 2.00 (2026-08-15): **v0.2.29 publishes synchronized Plan Mode (§5, §13,
  §14).** The P toggle is durable chat state and follows the existing lifecycle
  broadcast path to every connected device; reconnecting clients recover the
  canonical value through `ChatDTO`. Each message still snapshots the mode for
  its pi tool policy and durable queue boundary. This release exists so installed
  PWAs can identify and activate the synchronized frontend through the normal
  update flow.

- 1.96 (2026-08-14): **v0.2.24 is a release-only launcher canary (§17).**
  No product behavior changes from 0.2.23; the new immutable CLI tarball exists
  specifically to exercise the native launcher's real startup update path —
  manifest check, download, size/SHA-256 validation, private atomic activation
  and immediate execution of the new CLI.

- 1.95 (2026-08-14): **`pop` gets a native, failure-independent update launcher
  (§15, §17).** A precompiled Go binary now owns the command, checks the selected
  server before normal startup, installs the exact CLI privately with size,
  SHA-256 and smoke validation, atomically activates it and execs the Node TUI.
  It diagnoses missing Node/npm and offline/DNS/TLS/HTTP failures without
  depending on the broken component; offline stops before the useless TUI.
  Public no-store launcher installers and manifests join immutable launcher and
  CLI artifacts; the npm-global alias remains only for legacy migration.

- 1.96 (2026-08-15): **Plan Mode is a real pi-enforced, synchronized read-only
  policy (§5, §10, §13, §14).** The composer gained P beside M; the selected
  mode is durable chat state broadcast to every device through the existing SSE
  lifecycle path, while each sent/queued message snapshots `normal|plan` and
  mode changes form steering barriers. Pi receives both a reduced active-tool
  catalogue and an explicit runtime note. Native `read/grep/find/ls`, Pop read
  tools, `local_read`, and MCP tools explicitly advertising `readOnlyHint: true`
  remain; writes, bash, deletes, unknown tools and unannotated MCP capabilities
  fail closed.

- 1.93 (2026-08-14): **PLA detects a silently lost WSS stream (§17).** An
  attached local-access client now requires inbound server traffic within its
  45-second lease, terminates a stale socket and reconnects. This prevents a
  long-lived client from looking connected after the server has lost its
  registry entry. The changed CLI ships as 0.2.20.
- 1.92 (2026-08-13): **CLI setup has a stable latest URL (§17).** The public,
  non-cacheable `cli-latest.tgz` alias redirects to this server's exact immutable
  versioned tarball. Installation Guide uses the alias, so copied macOS/Linux
  setup commands remain valid after server updates. This ships as 0.2.19.
- 1.91 (2026-08-13): **Settings carries a personal installation guide (§14, §17).**
  PWA and CLI access instructions live in one Settings section. Commands derive
  the current server origin and include one-click copy.
- 1.90 (2026-08-13): **CLI self-update works on Windows (§17).** The updater
  executes npm's JavaScript entrypoint through the current Node runtime instead
  of spawning `npm.cmd`, which Node rejects with `EINVAL` without a shell. The
  changed CLI ships as 0.2.18.
- 1.89 (2026-08-13): **CLI local-run notices precede the answer (§17).** The
  `ran here: …` lines now live inside the assistant segment rather than being
  appended after it, so the final prose follows the commands that produced it.
  The changed CLI ships as 0.2.17.
- 1.88 (2026-08-13): **Windows can bootstrap the CLI from its own server (§17).**
  Public `GET /install.ps1` derives the personal server origin from the request,
  installs a compatible Node LTS through winget when absent, invokes `npm.cmd`,
  installs the server's exact immutable CLI package and leaves the exact login
  command. CLI self-update now also selects `npm.cmd` on Windows. The changed
  server and CLI package ship as 0.2.16.
- 1.87 (2026-08-12): **Composer focus never changes horizontal containment
  (§14).** The conversation pane and viewport now clip their horizontal axis,
  the composer constrains its flex chain, and its textarea explicitly suppresses
  horizontal overflow in both idle and focused states.
- 1.86 (2026-08-12): **Chat titles wait for the conversation (§14).** A new
  conversation keeps its deterministic `Chat N` name through the first two
  user messages. After the third, one service-model call creates a short title
  and summary; there is no first-message word picker, periodic regeneration or
  deterministic rename when the LLM is unavailable.
- 1.85 (2026-08-12): **The app viewport cannot become a horizontal scroller
  (§14).** Horizontal containment now reaches `html`, `body` and `#root`, not
  only the transcript, closing the outer overflow that focus could shift out of
  view while leaving bounded code and table scrolling intact.
- 1.84 (2026-08-12): **Horizontal overflow stays inside its content (§14).**
  The chat transcript now clips its horizontal axis and constrains every flex
  layer; ordinary long tokens wrap, while code and tables keep bounded local
  horizontal scrolling. Native vertical touch scrolling is unchanged.
- 1.83 (2026-08-12): **The CLI farewell is quiet grey (§17).** The complete
  `Bye!` and continuation-command block now uses the terminal's grey ANSI
  colour. The changed package ships as 0.2.9.
- 1.82 (2026-08-12): **The CLI leaves a continuation command (§17).** Ctrl+C,
  `/quit` and `/exit` now print the current `pop --chat <id>` command after the
  TUI closes; a not-yet-created conversation only says goodbye. The CLI ships
  this as 0.2.8.
- 1.81 (2026-08-11): **Pop Local Access replaces the user-facing hands concept (§17).**
  The CLI carries the TypeScript executor. WSS `/v1/local-tools` has an
  authenticated HTTPS long-poll fallback; session expiry/revocation,
  cancellation, process-tree cleanup and transport limits are explicit. The
  breaking wire ships as 0.2.6.

- 1.78 (2026-08-11): **CLI hands reconnect instead of disappearing silently (§17).**
  A dropped hands WebSocket leaves chat running, emits one visible reconnecting
  line and retries with bounded exponential backoff; reattach gives subsequent
  messages the new hands id. Explicit shutdown cancels retries. The CLI already
  identifies every request as `cli` + platform; that metadata contract is
  unchanged.
- 1.77 (2026-08-09): **Pending-message wording reflects delivery (§14).** A
  steering bubble carries the quiet `Sending:` status because it is entering
  the current run; the explicit follow-up strip says `Queued:` because it waits
  until that run ends. Neither label exposes the internal steering vocabulary.
- 1.76 (2026-08-09): **Steering stays in the transcript (§14).** An ordinary
  message sent during a live answer appears once as a normal user bubble after
  that answer; the redundant “Guiding this run” strip above the composer is
  gone. Native steering, persistence and delivery order are unchanged, while
  the explicit `/queue` follow-up keeps its editable queue strip.
- 1.75 (2026-08-09): **OpenAI subscription allowance on its own provider card
  (§15).** Settings → Model → OpenAI subscription now shows each rolling Codex
  usage percentage as a progress bar, its reset time and the plan. The guarded
  provider route returns only those allowance fields; the engine refreshes the
  OAuth credential through pi before reading OpenAI, and strips account
  identity and token material at the infrastructure boundary.
- 1.74 (2026-08-08): **The built-in roster review (§8).** Seventeen shipped
  skills became seven: the generic text ones (writing, summary, translation,
  explanation, brainstorm, math, planning) only added routing noise against
  the user's own skills; the survivors merge into `pop-agent-manual`
  (pinned manual, absorbing privacy), `pop-agent-codebase` (the generated
  self-map), `web-research` and `code-work` (rewritten against the real
  tools). A boot sweep removes built-ins that left the roster — deleted when
  pristine, promoted to `user` when edited. And every skill, built-ins
  included, can now be switched off (`enabled`, routed and pinned sets both
  respect it), exposed in the sidebar with a source filter (All / Personal /
  Auto / Pending / Built-in) whose button carries the pending count.
- 1.73 (2026-08-08): **The provider review fixes (§15).** Nineteen findings
  from a full read of the provider surface, closed in three lanes.
  Provider core: deleting or clearing the active default's key re-elects the
  head; `completeAsService` now penalizes a refused provider and forgives a
  recovered one (it silently bypassed the cooldown before); the model catalog
  cache invalidates when the account or endpoint changes instead of serving
  a stale list; a green connection test forgives the cooldown; auth failures
  surface as `authErrorAt` on the status DTO; the cooldown escalates
  (1 → 5 → 15 → 60 min) instead of a flat 5; the order route validates with
  `schemaError` like its siblings and caps at registry size; the legacy
  `custom` alias follows the canonical default. Completion path: retries
  rewind the pi session instead of replaying the user prompt; thinking or
  tool output gates the failover; an abandoned attempt's late usage is
  booked and its session discarded; a success clears the cooldown; gateway
  `complete` returns usage so background work lands in `llm_runs`
  (`kind: 'service'`, migration 032). Interface: negative OpenRouter
  balances render as `-$0.10`; credit lookups are cached per provider list
  load; the enable/disable switch is back on the provider card; an
  auth-error badge offers the sign-in again.
- 1.72 (2026-08-08): **The auto-skill review fixes (§8).** Five findings from
  a read of the router + auto-skill code, all closed: (1) the candidate
  scrubber now catches unlabeled tokens by shape (`sk-…`, `ghp_…`, `AKIA…`,
  JWTs, private-key blocks) — a bare pasted key no longer survives into a
  skill body that gets replayed into future prompts; (2) `asksForSkill`
  ignores a phrase preceded by a negation word — "não cria uma skill" is not
  a request; (3) with fewer than five measured skills the semantic leg uses
  `max(floor, 0.80)` (the noise band's p90) instead of the bare 0.75 floor
  that sits inside the band; (4) a revision proposed on a slug collision
  records the measured cosine or none at all — never a hardcoded 1 — and
  `skill_revisions.similarity` is nullable (migration 031); (5) the
  distiller's tick finds chats with new messages in one query
  (`lastMessageIds`) instead of reading every conversation's tail.
- 1.71 (2026-08-08): **One completion path, for every provider (§15).** A
  subscription has no API key to hand an HTTP gateway, so everything built on
  `gateway.complete` quietly excluded it: `completeAsService` required a
  gateway *and* a key, and skipped the provider otherwise. Chat worked, because
  chat goes through the engine. Nothing else did. With the ChatGPT subscription
  first in the chain, every title, every distilled skill and every cleaned-up
  transcription fell through it to the paid provider behind -- silently, and
  visibly enough that Settings still offered the subscription a Service Model
  that could never run. It only looked healthy because something paid was
  always there to absorb the fall-through.
  So the engine gets a completion of its own: `AgentBridge.complete`, over
  pi's `completeSimple`, resolved through the same `authenticatedRuntime` that
  already answers for an API key and a subscription alike. `completeAsService`
  takes the gateway when there is a usable key and the engine otherwise, and
  the connection test does the same -- which means a subscription is now tested
  by a real, timed round trip like everyone else. That reverses 04/08, which
  refused to print a millisecond figure for a trip that never happened: the
  objection was to inventing the number, so the trip is made instead. A
  subscription is not billed per token; it costs a moment.
  `checkProviderAuth` went with it, from the port down to the fake: once the
  test makes a real request, a second way to ask "does this provider work?" is
  one way too many (Vinicius, 08/08: "nao tem sentido ter 2 caminhos pra mesma
  coisa").

- 1.70 (2026-08-08): **The sign-in card reconciles against the provider's
  status when its poll cannot answer (§15).** The ChatGPT subscription signed
  in -- the credential was on disk at 16:02:33, complete -- and the card sat on
  "Waiting for the provider…" until it was reloaded. The transcript poll
  swallowed every failure (`.catch(() => undefined)`), so one refused request
  left the card waiting forever on a sign-in that had already landed: no error,
  no retry limit, no way out. Three unrelated faults end in that same wrong
  answer -- the service restarting takes the in-memory flow with it, a
  backgrounded PWA freezes its timer, one fetch loses the network.
  So the poll no longer owns the truth alone. After two consecutive misses the
  card asks the provider's own status instead (configured means the sign-in
  landed, the same news by another route), and it polls immediately on
  `visibilitychange` rather than waiting out another interval. The happy path
  was never broken and is now pinned by a test that had never existed: of the
  three added, it is the only one that passes against the old code.

- 1.69 (2026-08-08): **Popy is renamed Pop Agent, as a clean break.** The
  display name is `Pop Agent` — UI strings, PWA manifest, WebAuthn RP name,
  the agent's own system prompt and the self-knowledge skill. The slug is
  `pop-agent`: repo, npm packages (`pop-agent`, `@pop-agent/*`), data
  directory `~/.pop-agent`, database `pop-agent.db`, workspace
  `~/pop-agent-workspace`, systemd unit `pop-agent-service`, CLI profiles in
  `$XDG_CONFIG_HOME/pop-agent/`, env prefix `POP_AGENT_*`. The two binaries
  drop the project name and take the short form: `pop` (chat client) and
  `popman` (operator), so the thing typed all day stays two syllables.
  `POPY_AGENT` became `POP_AGENT_ENGINE` rather than `POP_AGENT_AGENT`; the
  wire field `popy` on `GET /v1/update/status` became `popAgent`.
  **No compatibility layer, on purpose** — no `POPY_*` fallback, no reading
  `~/.popy` when `~/.pop-agent` is absent. The instance is single-user and
  pre-release, so a shim would be permanent cost for one migration. The cost
  paid instead: the session token header is `x-pop-agent-token` and the
  browser keys are `pop-agent.*`, so every client re-authenticates once and
  loses its theme and drafts; the PWA must be re-added to the iPhone home
  screen to pick up the new name and push. Passkeys survive — they are
  anchored to the `rpId` (the domain), and only the display `RP_NAME`
  changed. The timing is deliberate: Docker (§18) and the Go client would
  each freeze another set of names.
  Not migrated, and left visibly stale: conversations, the memory document
  and the distilled auto-skills still say "Popy", because they are the
  user's content and rewriting them is not the rename's business.

- 1.68 (2026-08-08): **The dedup bars are measured, and the distiller may only
  revise its own work (§8).** Found by testing the 1.66 request path against
  the live instance: "vira skill" on a restart-the-service procedure produced a
  good skill, and it was filed as a revision of `self-change` at cosine 0.9017.
  Accepted it would have replaced an unrelated skill; refused it left the new
  one in a table with nothing on the Skills screen.
  So the 0.90 that §10 admitted was a guess got its measurement: 406 pairs of
  distinct vault skills against the 36 pairs of known duplicates. The cosine
  distributions **overlap** — 0.895 to 0.936 — so no cosine can separate them,
  and the answer is a second signal. Shared vocabulary does separate them, and
  `0.88 / 0.25` catches 32 of 36 duplicates while merging none of the 406.
  `tools/skill-dedup-calibrate.ts` is that measurement, kept.
  Verified live three times after the change: each request was picked up within
  a minute, each produced a pending skill, and each logged the neighbour it
  correctly declined to merge into — including `renovar-certificado-cloudflare-ssl`
  against `renovar-certificado-mikrotik-hex`, two certificate-renewal procedures
  at cosine 0.85 that share 2% of their words.
- 1.67 (2026-08-08): **`tools/live-skills.ts` loses its replay mode.** The
  `--offline` flag fed the loop a recorded answer so the router half could be
  exercised for free. It had been broken since 1.64 changed the answer format
  and the fixture was not changed with it: every offline run printed "nothing
  learned" and read as a finding about the distiller. Deleted rather than
  repaired (Vinicius, 08/08). The file exists because a fixture can agree with
  the code that wrote it and disagree with the code that reads it — which is
  exactly what the stale replay did — so a mode that passes without calling a
  model defeats the only thing it is for. The gate is where fixtures belong.
- 1.66 (2026-08-08): **Skills leave the conversation (§8).** Vinicius read a
  transcript where he was choosing a name for Pop Agent and got, turn after turn, a
  paragraph explaining why no skill was being created. The log says why:
  `skill-creator` was routed into nine of sixteen turns, every one at
  `lex=0.00` and cosine 0.79–0.84 — inside the e5 noise band this spec already
  documents — and its own procedure told the model to announce the decision.
  A skill whose trigger is a sentence should never have been reachable by
  meaning, and an internal check should never have had a voice.
  So fase (b) is withdrawn. `skill_write` is off the agent's hand, the
  `skill-creator` skill is out of the built-ins, and the system prompt says
  plainly that Pop Agent does not write skills and must not narrate the subject.
  The distiller is the only writer. An explicit "vira skill" survives as a
  **separate path**: matched by phrase list on the user's own messages, it
  makes that chat jump the queue, skip the idle wait, and forbids the empty
  answer — a request must not be able to lose, which a score always can.
- 1.65 (2026-08-08): **The dedup was comparing against a table the pending
  skills were missing from (§8).** Found by reading the instance, not the
  tests: `skills/auto/` held twelve skills and nine were the same procedure
  under nine invented slugs. The router filtered `pending` before it built
  the vector index, and the distiller's dedup reads that index — so every
  candidate was measured against a set its predecessors had never entered,
  and the 0.90 threshold never got a chance to fire. Only the slug leg ever
  caught anything, and a model naming its own skill never repeats a slug.
  The index now covers the whole vault and the filter moved to the
  selection; the distiller stores a candidate's vector when it writes the
  skill, because a job on a ten-minute timer cannot wait for a user message
  to index its own output.
  The load that exposed it was a scheduled task, hourly since 02/08: 153
  runs, 49 of the database's 55 chats, and three proposals that were the
  same observation three times. It stays hourly — it is the only thing
  generating enough distiller traffic to have found this, and it will be the
  thing that proves the fix. What it also revealed is that the router's
  entire observability record is 125 identical log lines, one query repeated:
  there is not yet real routing data to retune `0.90` or `z ≥ 2.1` from.
- 1.64 (2026-08-08): **The distillation format stops being JSON (§8).** Two
  more live runs, this time against the instance's real provider chain through
  `completeAsService`. The first version of `tools/live-skills.ts` called
  OpenRouter directly with a hardcoded model id, which bypassed the very
  Service Model resolution it existed to exercise -- and produced a wrong
  conclusion from an out-of-credit error on a provider this instance does not
  even reach first.
  Through the real chain the model answered well and the skill was still lost,
  twice. Once because the body held a `curl` line with
  `--data '{"purge_all":true}'`, whose unescaped quotes made a complete and
  plausible document invalid. Once because the model wrote `--- body` without
  the closing dashes, and an exact-match parser dropped a well-formed skill
  over it. Hence markers and lines, nothing escaped, markers matched loosely.
  The loop then ran end to end on `custom-8e4e682bfd / sabiazinho-4`: the skill
  was distilled and held pending, was **not** routed until approved, was
  selected first afterwards (`cos=0.81`) for a Portuguese question sharing none
  of its English words, and was archived by the collector.
- 1.63 (2026-08-08): **The auto-skill loop verified against a real model, and
  the bug that verification found (§8).** `tools/live-skills.ts` runs the whole
  loop on a throwaway database and vault — plant a conversation, distil it,
  approve what comes out, ask the router a question the skill should answer —
  and it is out of the gate because it spends money, like `live-check.ts`.
  The first run found that the distiller was silently discarding good skills.
  A reasoning model spends most of its token budget thinking and the JSON
  stopped mid-field; `JSON.parse` rejected the lot; the empty result read as
  "nothing to learn"; the watermark advanced. The conversation was gone for
  good and the skill with it. The parser now scans complete objects out of the
  array and reports `truncated`, the distiller treats truncated-with-nothing
  like a provider failure, and the ceiling went to 6000 tokens.
  What the run then proved, with the real embedder: a pending skill is **not**
  routed before approval, and after it, a question sharing none of the skill's
  words — "as paginas do site continuam mostrando conteudo velho depois que
  publiquei" against a skill written in English about Cloudflare 404s — brings
  it back first, `cos=0.83`, ahead of the built-in it was competing with. The
  router's semantic leg works across languages, which the fixtures in the gate
  could not have shown.
- 1.62 (2026-08-07): **The safety layer measured, and the distiller's taint
  check corrected (§8, §10, Backlog #8).** The injection corpus had only ever
  been tested in the flattering direction — write a payload, watch it match —
  so `tools/safety-scan.ts` (`npm run safety:scan`) now runs it over the
  repo's own prose and prints every flag with the text that caused it. The
  first measurement found three benign documentation lines reading `high`
  ("send an Authorization header, and a session token", `POST /v1/login {
  password }`, `POST /v1/auth/change-password`): the exfiltration patterns
  allowed sixty characters between the verb and the noun, which reference
  prose crosses constantly. The gap is now short and may not cross a newline,
  a table pipe, a brace or a slash, and the noun may not be the tail of a
  hyphenated word. 351 paragraphs, 11 flags, all of them the deliberate bare
  `system prompt` at `suspicious`.
  **The correction that mattered more** is in the distiller: it was reading
  the whole window — the user's messages included — through `sanitize`, which
  made the detector's own vocabulary radioactive. A bare "system prompt"
  flags nine paragraphs of this spec, so every conversation about how Pop Agent
  works would have been skipped, silently and permanently, since the
  watermark advances on a taint. It now reads **only tool output**, which is
  what §10's threat model was ever about: indirect injection is text that
  came from outside, and what the user typed is not that.
  New coverage the measurement showed was missing: **URL exfiltration** (a
  markdown image whose query string interpolates a secret — nothing is
  "sent", so every verb-based pattern was blind to it), four **Portuguese**
  phrasings ("a partir de agora você deve", "seu novo objetivo é"), and
  **base64** — encoded runs are decoded once and re-read with the same
  patterns, reported as `injection:<label>:encoded`. One level only: a
  decoder that follows its own output is a decompression bomb waiting for a
  hostile page.
- 1.61 (2026-08-07): **Auto-skill fase (c): the background distiller and the
  archiving collector are BUILT (§8, §13, §21).** The half nobody has to ask
  for. A maintenance job on the task scheduler's tick reads one idle
  conversation per tick — no idle conversation, no provider call, so the cost
  follows use — and distils what is procedural in it. A watermark per chat
  (`skill_distillation`) means a conversation that continues comes back with
  only its new messages; it advances on every outcome except a provider
  failure, so a bad minute at a provider costs a retry rather than a skipped
  conversation. `sanitize` gates the window before the model sees it: anything
  above `low` and the conversation is never distilled, which is the guard fase
  (b) got from the taint guard and a finished turn had from nothing. A
  candidate matching an existing skill (slug, or 0.90 cosine) lands in
  `skill_revisions` rather than the vault, so the approved version keeps
  serving the router until the user accepts the rewrite —
  the approval policy governs the update path too, without which the pending
  flag would guard the front door and leave the update path open. The
  collector is a cap (50 auto-skills, least used archived to
  `skills/_archive/`, never deleted), which keeps the annual procedure that
  any "idle for 90 days" rule would destroy. The original Settings gained
  `distillSkills` (on) and `distillIntervalMinutes` (10); the Skills screen gains the two
  queues, the archive, and one status line — no card, no push.
- 1.60 (2026-08-07): **Auto-skill fase (b), the router rebuilt on RRF, and
  the Service Model corrected to a per-provider pair (§2, §6, §7, §8, §15).**
  - **`sqlite-vec` removed from the spec.** It was never installed and is not
    a dependency; what exists everywhere is FTS5 + a `Float32Array` BLOB +
    a dot product in JS. The spec had been promising an extension the code
    never had, in four places, since 1.0.
  - **The Skill Router fuses with RRF**, reusing `fuseRankings` from the
    memory search rather than introducing a second mechanism. The
    hand-tuned blend it used to carry (a cosine turned into lexical points
    by a constant nobody could justify) is gone. Measured against the real
    24-skill vault: an absolute cosine bar cannot work in e5's compressed
    band, so the semantic gate is now a **z-score over each request's own
    spread** (z ≥ 2.1, 0.75 kept as a floor) — 7/10 on ten labelled
    requests with zero false positives, against 4/10 for the old blend. The
    same measurement settled "why not just match words?": lexical alone
    scores 2/10 here, because the user writes Portuguese and the skills are
    English, and no better lexical engine crosses that.
  - **Skill vectors persist** (`skill_embeddings`, migration 028), keyed by
    slug and stamped with the routing text they came from. Cold start 16.3s
    → warm 2.0s.
  - **`source: builtin | auto | user`** replaces the `builtin` boolean, with
    `builtin: true` still read from files written before today. Editing an
    auto skill promotes it to `user`; approving one does not. (The promotion
    had a bug found by its own test: `serialize` omitted `source: user` as
    "the default", and a promoted skill lives under `auto/`, where the path
    answers when the front matter does not — so the promotion was written
    and read straight back as `auto`.)
  - **"Vira skill" works, in any language** (fase b): a built-in
    `skill-creator` carrying its trigger sentences, and `skills_list` /
    `skill_write`. A tainted turn cannot write a skill — the only taint
    block keyed on a tool name, because a skill outlives its turn.
  - **Approval** (`autoApproveSkills`, default off), honoured by the router
    filtering `pending`, with `POST /v1/skills/:slug/approve` and a queue on
    the Skills screen. **`use_count`/`last_used_at`** (migration 029) record
    what earns its slot, for the collector that is not built yet.
  - **Service Model is a per-provider pair**, beside the credential, empty
    meaning "follow the chat model". `resolveServiceModel` /
    `resolveServiceChain`; titles and voice cleanup stopped reading a global
    setting, and the global `serviceModel` is gone from Settings. This
    supersedes 1.55, which had moved it to General — recorded there rather
    than silently overwritten.
  - Still open: the background distiller (fase c) and the archiving
    collector.

- 1.59 (2026-08-05): **Files as a plain folder is BUILT (§4, §6, §14 -- lands
  1.58).** Four commits, gate green throughout: the FilesService core
  (Garbage/ + `.garbage.json`, path-signed links, `file_provenance`,
  migration 026); the agent side (Files/ symlinked into the workspace,
  `save_artifact`/`read_artifact` retired for the built-in tools,
  `delete_file` that moves instead of removing, `files_search` as a live
  name walk, the provenance walk on run end); the path-based API and UI
  (`/v1/files` serves the real tree, uploads land in the open folder,
  rename and move are one path edit, composer @-mentions carry paths);
  and the removal (migration 027 drops the five catalog tables after
  bootstrap exports live rows to `files/<path>`, trashed rows to
  `Garbage/`, and seeds provenance -- then `artifacts/` is deleted).
  Verified against the real install: the two catalog rows landed with
  their names, the agent wrote `Files/resumo-redesign.txt` from a chat
  and provenance logged it, the tab lists the disk, a ⋯ → Download
  serves the exact bytes through the signed URL, and delete→trash→
  restore round-trips from the chat to the Trash screen and back.
  Caveat found live: the PWA's waiting service worker did not activate
  from the update toast (the button click left `waiting: true`); the
  session was fixed by unregistering the SW + clearing caches, and the
  update flow deserves a look of its own.

- 1.58 (2026-08-05): **Files becomes a plain folder (§4, §6, §14).** The
  catalog design — id-named blobs under `artifacts/<chatId>/`, an
  `artifacts` table, versions, a path index, trash rows — was carrying
  features this install does not want: Vinicius wants to `tree` his files
  over SSH, wants a re-save to overwrite, and wants the trash to be a
  folder he can open. So `POP_AGENT_DATA_DIR/files/` with real names is now the
  single source of truth; the tab renders the disk, uploads and the agent
  write straight into it, and `save_artifact`/`read_artifact` retire in
  favour of the built-in file tools. What survives, survives simpler:
  signed downloads sign the *path*; "which chat made this" is
  `file_provenance`, an append-only log that cannot desynchronize because
  history does not move; the trash is `files/Garbage/` plus a hidden
  `.garbage.json` (`{originalPath, deletedAt}`, the desktop `.trashinfo`
  idea) with a daily 30-day sweep; and the agent deletes through
  `delete_file(path)`, a tool whose real effect is the move to Garbage — a
  rule enforced by a tool beats a rule taught in a prompt (Vinicius,
  05/08). `files_search` drops to live name matching, names only for now.
  Versions, content search and the live file↔chat link are given up on
  purpose, not forgotten. Design recorded; implementation pending — this
  entry supersedes the artifact half of 1.47–1.53.

- 1.57 (2026-08-04): **Two CLIs, and a server that hands out its own
  client (§17).** `pop` is the chat client and `popman` the operator's
  tool; keeping them one command would drag `better-sqlite3`, `argon2`
  and code that knows where `secret.key` lives onto every laptop that
  wants to chat from a terminal. `popman` ships with the server and is
  the only thing touching systemd, SQLite and the backups directory;
  `reset-password` lives there and NOWHERE else, because it proves
  nothing and owning the machine is the proof -- an HTTP route with the
  same power would be a password reset for anyone who found the URL.
  `access-list` is named in §18 and is **not built**; the command says so
  rather than pretending.
  Distribution: `npm i -g <server>/cli-X.Y.Z.tgz`, chosen because for
  self-hosted software the thing you run should hand you the thing you
  talk to it with, and the install line then carries its own address. It
  is NOT what prevents client/server drift -- that was the earlier
  reasoning and it only holds on the day of the install; the server moves
  on and the laptop keeps what it was handed. **The attach compares the
  versions**: silent when compatible, one line when merely behind, and
  refused with the install command below `MIN_CLIENT_VERSION`, which is
  set by hand and moves only when the wire changes. Packing bundles every
  `@pop-agent/*` into `dist/` and leaves the two public dependencies external,
  which is what makes the tarball installable at all (`npm pack` alone
  404s on `@pop-agent/shared`).
  Also: **hands belong to the message, not the chat** (docs/cli.md). A
  chat used to have an owner, so a message from the phone ran commands on
  whichever laptop had opened it -- possibly one that is shut. The
  terminal now names itself on each message (`x-pop-agent-local-connection`), which
  deleted the ownership map, the claim frame and the spectator rule.

- 1.56 (2026-08-04): **Every message remembers where it came from (§13).**
  Migration 024 adds `client`, `client_platform` and `client_ip` to
  `messages`. **Per message, not per connection**, because a conversation
  moves between devices and the value is reading that back later; a
  connection only ever answers "where are we right now", which is the one
  thing the user could have said out loud (Vinicius, 04/08).
  Vocabulary: `web | pwa | desktop | cli | api | task`. **`mobile` is
  deliberately absent** -- a form factor is not a client, and "PWA on an
  iPhone" would otherwise be two answers at once; the phone half is the
  platform. Named `client`, NOT `source`: that word is already an
  artifact's `agent`/`upload` and a title's `auto`/`manual`.
  Carried in `x-pop-agent-client` / `x-pop-agent-client-platform`, set once in each
  client's api layer so every call has it, and validated at the edge --
  an unknown value is recorded as nothing rather than passed through into
  the model's context. NULL is the honest value for the 427 rows that
  predate this and for every assistant and system message, which no client
  sent. A header is **forgeable by anyone holding the token**, which on a
  single-user install means the owner: it is context, never a security
  decision.
  **The agent is told only when the channel CHANGES** (`channel-note.ts`),
  plus once at the start of a conversation. Repeating "this came from the
  CLI" on all fifty turns is fifty copies of a fact that mattered once,
  paid for on every request. **The IP never reaches the model**: it answers
  "who connected", which is an audit question, and nothing she says would
  change for it -- what enters the context enters the memory and the
  backups forever. It is read from `x-forwarded-for` behind a proxy and
  from the socket otherwise; reading only the header recorded nothing for
  every direct connection.
- 1.55 (2026-08-04): **Providers are added, not configured (§14, §15).** The
  Model screen used to show every provider Pop Agent knows about, configured or
  not, each an open form -- six cards to read before finding the one you had
  set up, plus a separate drag-to-reorder priority list. Now the screen says
  what you HAVE: an **Add provider** button, then one card per configured
  provider with Edit and Delete. Adding walks a wizard -- pick from the six
  (OpenRouter / OpenAI / OpenAI subscription / Anthropic / GitHub Copilot /
  Custom), give it what that one needs, choose a **Priority**. A builtin
  already set up is offered greyed as "already added"; custom instances can
  be added as often as you like.
  **Priority is a 1..N dropdown over the configured providers**, replacing
  the drag list (`priority-list.tsx` deleted): "who answers first" is the
  question a person asks, and a drag gesture answers it only once learned.
  N counts configured providers only -- "priority 3" has to mean the third
  thing that answers, not the third row of a list including providers never
  set up. It writes the same `provider.order` the fallback chain already
  reads (§15 fase 2), so the engine did not change at all.
  Every provider can be **tested**, subscriptions included -- the server
  checks those with pi's own auth check rather than a paid probe, so hiding
  the button there made no sense. **Model** is a searchable picker over the
  provider's own catalogue, falling back to a typed field where the endpoint
  publishes none (a custom Ollama, typically) -- an empty picker is a dead
  end. `MAX_CUSTOM_PROVIDERS = 256` caps how many custom instances exist **at
  once**, never how many ever existed: deleting frees its place (Vinicius,
  04/08). The service model (titles, summaries) moved to General; it is a
  background behaviour, not a provider. **Superseded by 1.60**, which moves
  it back beside the credential as a per-provider pair — the reasoning above
  was right about it being a background behaviour and wrong about what that
  implies, because a model id is meaningless outside one provider's
  catalogue. Recorded rather than silently overwritten, at the owner's
  request.
- 1.54 (2026-08-04): **Audio is its own Settings section (§14).** "Voice
  model (whisper)" and "Improve transcripts with AI" were the last two
  cards under Model, where Model means the one that answers you -- so a
  transcription model and a cleanup pass sat under a heading about
  something else, and anyone looking for the microphone had no reason to
  open it. Both cards move to a new **Audio** section, unchanged; they were
  already self-contained, so the move is a relocation, not a rewrite.
- 1.53 (2026-08-03): **The Trash is a place inside Files, not a screen you
  were sent to (§14).** It carries the same breadcrumb -- `Files > Trash`,
  with `Files` as the way back, which is why the Back button it used to
  have is gone (Vinicius, 03/08). The breadcrumb moved out of files-page
  into `ui/Breadcrumb` (crumbs + limit + onOpen, owning its own collapse
  menu) and `MenuItem` moved to `ui/controls`, its real home: two screens
  had to look identical, and this codebase already has the lesson written
  down about a look that gets hand-copied into a second place (FIELD_BASE).
  The Trash entry in the Files toolbar is the drawn bin, no word -- among
  four worded buttons "Trash" read like a fifth action rather than a place.
- 1.52 (2026-08-03): **Files has a trash (§14, §6, §21).** Deleting a file
  or a folder is reversible for **30 days** -- the number Drive, Dropbox and
  iOS use, so nobody has to learn a new one. Migration 021: `deleted_at` on
  `artifacts` and `folders`. **Soft delete, never a move**: the bytes stay
  where they are under the same id, because moving them into a `trash/`
  directory would double the paths one file can live at and a crash halfway
  would leave an orphan nobody can find.
  Four decisions worth keeping. (1) **The index goes immediately.** A
  trashed file's chunks and embeddings are dropped the moment it is deleted
  (`onDeindexed`, wired in main.ts) -- thirty days of the agent still finding
  and citing a file the user threw away is the worst kind of bug, silent and
  embarrassing. A restore reindexes through `onStored`. (2) **The bin never
  reaches into the live tree**: `folders_sibling_name` became a partial
  unique index (`WHERE deleted_at IS NULL`), so a deleted folder cannot stop
  you creating another with its name. Restoring into a name that was taken
  meanwhile answers **409 `name_taken`**, not a crash and not a silent
  rename. (3) **A subtree is one thing.** Deleting a folder stamps its whole
  subtree with ONE instant, so it expires together, lists as a single entry,
  and comes back together. Restoring anything also restores its trashed
  ancestors -- a folder's parent is fixed at creation (§6), so dropping an
  orphan at the root would be moving something the user only asked to
  undelete. (4) **A purge takes the archived versions too**, via a new
  `ArtifactStore.removeVersion`; freeing only the current bytes would leave
  copies on disk under a name nothing points at. `TrashSweeper` (a
  MaintenanceJob on the daily tick) empties what is past its window;
  thirty days is a floor, not a deadline. `GET /v1/trash`,
  `POST /v1/trash/{files,folders}/:id/restore`,
  `DELETE /v1/trash/{files,folders}/:id`, `DELETE /v1/trash`, and a Trash
  screen reached from the Files toolbar that says how many days each thing
  has left.
- 1.51 (2026-08-03): **Measure the disk before limiting it (§14, §16).** A
  trash and a quota for Files were asked for; this lands the measurement
  first, on the principle that a limit chosen without looking caps the
  wrong thing. New `GET /v1/storage` + Settings -> Storage: one line per
  kind of weight, heaviest first, with the filesystem's own free space
  beside it. `application/storage/storage-service` composes two new ports
  -- `StorageRepo` (what only SQL knows: live files vs archived versions,
  and how much of the db is derived index) and `DiskUsage` (directories,
  files, statfs; every method answers instead of throwing, because a
  directory that does not exist yet is a normal install state worth a
  zero). Nothing is counted twice: the artifacts directory is measured
  once and split by the database's own size column, and the index is
  shown as a slice of the database file rather than added to it. Backups
  are counted although they live OUTSIDE the data directory -- they are
  ten full copies of it (§16), which is the point.
  **The first install it was pointed at settled the argument**: 1.7 GB of
  downloaded whisper weights against 224 KB of files, and 1.5 GB of that
  a `medium` model that is not even the configured default. Downloaded
  weights therefore get their own line rather than sitting inside
  "everything else" -- the biggest number on a disk must be the most
  legible one, not the least. Open questions the numbers now inform, not
  yet decided: the trash itself, a Files quota, pruning old versions,
  removing unused voice models, and whether backups should keep ten full
  copies of the artifacts at all.
- 1.50 (2026-08-03): **Pull down to refresh, on the phone (§14, §15).** An
  installed PWA has to build this itself: Safari's own pull-to-refresh
  exists in a browser tab and NOT in standalone display mode, which is how
  Pop Agent runs on a phone, so the gesture every phone user knows was simply
  missing. `lib/pull-to-refresh` + `ui/PullToRefresh` wrap a scroll area;
  the chat list and Files use it. Chrome's model, not iOS's -- the list
  stays put and a spinner slides over it, because translating the scroller
  would fight the row menus that position against it. The gesture is
  decided once and never taken back, the same rule the chat rows' swipe
  follows: it must start at `scrollTop` 0, go downward, and be more down
  than sideways, or it belongs to the scroll or to the row's own
  delete/archive. Once it is ours, `preventDefault` on a non-passive
  `touchmove` is also what stops iOS rubber-banding the whole app.
  **A pull refreshes the data AND asks the server for a new build**, which
  is the other thing a phone cannot find out on its own (§15: an installed
  PWA only re-checks its worker on navigation). The two run under
  `allSettled` -- a server that is down must not stop the cached list from
  redrawing. New `services/update-signal` keeps that reachable without
  spreading the poison: `services/pwa-update` imports
  `virtual:pwa-register`, which resolves only inside a vite build, so
  anything importing it becomes unimportable from a test (the reason
  oauth-section was carved out of settings-page). `ui/update-prompt` stays
  the single door and registers the real checker on mount.
- 1.49 (2026-08-03): **Files acts on the row you point at (§14, §6).** The ⋯
  beside the breadcrumb is gone: it held one entry, "Select files", and a
  menu next to the title was a second place to look for something the row's
  own ⋯ could offer. Selection now starts from the item itself -- "Select
  folder" first in a folder's menu, "Select file" second in a file's -- and
  **folders are selectable too**, with their own checkbox and their own set,
  so a batch can mix both. Move to… hides while a folder is ticked, because
  a folder's parent is fixed at creation (§6) and moving one is not a thing
  that exists. **"Open file"** is the new first entry of a file's menu: the
  download route takes `?inline=1` and, for types
  `domain/artifacts/inline-view` allows, serves `Content-Disposition:
  inline` so the browser displays it -- PDF, image, plain text, audio,
  video, with text-ish types (markdown, csv, json) relabelled `text/plain`
  so they are read rather than saved. An **allowlist, never a denylist**:
  `text/html` and `image/svg+xml` are excluded on purpose, because uploaded
  markup rendered inline on Pop Agent's own origin can read the session token;
  anything unrecognised downloads, as before. `nosniff` and a `sandbox` CSP
  ride along. A web page cannot hand a file to the operating system's
  default application -- that door is closed to every website -- so "open in
  the system viewer" means the browser's, and the share sheet from there.
  The flag sits outside the HMAC on purpose: it authorises nothing the
  signature did not already, and signing it would void every link already
  handed out.
- 1.48 (2026-08-03): **A server that is down says so (§14).** A 12px dot at
  the bottom of the sidebar was the only sign that the app could not reach
  its server, and in a PWA that is nearly invisible: every screen still
  paints from the service worker's cache, so the app looks alive and only
  the answers stop coming. New `ui/connection-banner` -- a full-width bar
  at the top of every screen, mounted above the router so the failed boot's
  fallback to login carries it too. Three states rather than one, because
  the user's next move differs: "You're offline." (their network),
  "Server is offline. Your internet is working -- the problem is on the
  server. Nothing you typed was lost. Trying to reconnect..." (naming the
  culprit is the point: otherwise the first suspect is always the wi-fi),
  and "Back online." for 3s, so an outage does not end in silence. A bar,
  never a modal -- the conversations already loaded stay readable, and
  taking them away would remove the only thing that still works. The health
  dot keeps the *degraded* diagnoses, which are the ones a user could act
  on. `services/health` becomes the connection monitor: a 60s keepalive
  while healthy, a 5s-doubling-to-30s retry while unreachable (so "trying
  to reconnect" is true, plus a "Try now" button), `navigator.onLine ===
  false` short-circuiting the request and separating the two failures, and
  a hard stop while the page is hidden -- iOS freezes a backgrounded PWA
  within seconds, so a surviving timer would resume holding a verdict from
  whenever the system suspended it. It wakes on `pageshow`/visible like
  `services/events` already did: the wake-up probe matters more than the
  interval. `services/api` now doubles every request as a probe, so a send
  that never landed raises the banner immediately instead of a minute later.
- 1.47 (2026-08-02): **Folders nest, and Files search has an index (§14, §6,
  §21).** Folders were flat with a global `UNIQUE(name)`; they gain a
  `parent_id` (migration 020) so a folder holds folders as well as files,
  and "unique among siblings" (a `UNIQUE(COALESCE(parent_id,''), name)`
  index) replaces the global one, so `Projetos/specs` and `Clientes/specs`
  coexist. The parent is fixed at creation and never moves, so no cycle can
  form; deleting a folder takes its whole subtree -- descendant folders and
  their files, records and bytes both (files first, folders deepest-first,
  so no FK dangles). Rebuilding `folders` while `artifacts.folder_id`
  references it needed care: RENAME rewrites the child FK to follow the
  renamed table, so the migration builds the new table under a temp name,
  drops `folders`, then renames the temp *into* `folders` (the child FK text
  stays `REFERENCES folders`, now resolving to the rebuilt table),
  `defer_foreign_keys` covering the window -- verified against the real db
  (`foreign_key_check` clean). The Files list is now a tree in both the
  sidebar and the content pane: a folder with children carries a `+`/`-`
  toggle that opens it in place, while its name still navigates in. Search
  no longer filters the loaded list in the browser (which hid folders and
  missed anything below the open folder); a materialised `path_index` table
  holds every folder and file with its full path, and `GET /v1/files/search`
  matches a name or any path segment across the whole tree, returning
  folders first then files, each with its path. The index is a cache:
  `PathIndexService.reindex` rebuilds it whole after every Files mutation
  (an `onFilesChanged` hook on the artifact service), once at boot, and once
  a day at 01:00 local as a safety net (a `FilesReindexJob` maintenance job
  on the scheduler's tick). On a phone the Files search box drops to its own
  full-width line so the toolbar buttons no longer crush it.

- 1.46 (2026-08-02): **The field controls are primitives now (§14).** Two
  layout bugs had just been fixed in one shared component each and
  disappeared from five screens at once; an audit then found the places
  where that leverage did not exist — eight hand-rolled `<select>`, five
  `<textarea>`, five raw checkboxes, each carrying its own copy of the
  field class string, already drifted. `Select`, `TextArea` and a shared
  `Field` shell join `TextField`/`CheckField` in `ui/controls.tsx`, with
  the skin in one constant and size as a prop. `<Button>` was measured
  too and left alone: none of the 41 raw `<button>` imitate it — they are
  icon buttons and list rows. One real a11y hole closed on the way: the
  file-row checkbox had no accessible name, and the interval unit select
  answered to "Schedule", the same name as the group around it.
- 1.45 (2026-08-01): **A task can run without shouting (§21), and a note
  can be added to (§11).** Both came out of the same job: a task on a
  ten-minute interval writing to one markdown file. It buzzed the phone
  every ten minutes and opened a chat in the sidebar every ten minutes,
  so the schedule that worked was the one you switch off; and the only
  way to write was `notes_write`, which replaces the file, so "add to
  this note" meant read-glue-write — silent truncation above the 64 KiB
  read cap and a full copy of the note in context for a two-line
  addition. Tasks gain `notifyOnFinish` and `archiveChat` (migration
  018); `startRun` gains `{ notify }`, which silences the push alone and
  still counts the run for health. The vault gains `append`, exposed as
  `notes_append`, which writes past the end of the file without reading
  it and guarantees the added text starts its own line.
- 1.44 (2026-08-01): **The list is the only priority, and a dead
  endpoint no longer freezes the chat (§15).** Two faults met in one
  bug report: the failover chain still put the stored global default
  ahead of the user's list — a hidden #0 — and one install's default
  was an Ollama endpoint on a machine that was switched off. Every new
  chat went there and hung forever: no answer, no error, no journal
  line, because the chain can only act on an error that returns and a
  hung socket never returns. The chain now follows the list alone, and
  an attempt that says nothing for 60 s is abandoned for the next
  provider.
- 1.43 (2026-08-01): **The provider priority is the user's to edit
  (§15).** The failover order was hardcoded — definition order, after a
  global default that lived in its own Settings control — so there was
  no way to say "try this one first" or "never this one", and the
  default could name a provider the chain did not start with. Settings
  now shows one numbered list: #1 is the default, the order below it is
  the failover order, and each row has an on/off switch. Ported from
  aw, including its lesson that activation and #1 must be one lever.
- 1.42 (2026-08-01): **The subscription sign-in stops reading as broken
  (§15).** pi offers two login methods and advertises the browser
  redirect as the default; on a self-hosted install that is the one
  method that cannot finish by itself, and it dead-ends on a blank
  `localhost` page whose address the user is expected to copy out of
  the bar. The card now names the choice in Pop Agent's own words with the
  code method first, and the redirect path reads as three steps that
  warn about the failed page before asking for its address. Both paths
  still work; an API key remains the third way in.
- 1.41 (2026-08-01): **A sign-in survives the round trip (§15).** The
  OAuth card only rendered flows started in that same mount, so coming
  back from the provider -- a reload, a new tab, the PWA resumed --
  showed "Sign in" again while the server sat waiting for the code, with
  no way to hand it over. The card now adopts a running flow on mount,
  and spells out that the blank `localhost` callback page is expected
  and is itself what must be pasted back. The section moved into
  `oauth-section.tsx` so it can be tested at all: the settings page
  pulls in the PWA registration virtual module, which no test
  environment can resolve.
- 1.40 (2026-08-01): **iOS push actually arrives (§14).** The whole chain
  existed — service worker with `push`/`notificationclick`, the Settings
  opt-in, `/v1/push/*`, the send on run finish — and delivered nothing on
  iPhone, because the VAPID `sub` claim was `mailto:pop-agent@localhost` and
  Apple validates it: measured against web.push.apple.com, that subject
  answers 403 `BadJwtToken` while a real public URL answers 201. Pop Agent now
  signs with its own project URL by default, `POP_AGENT_PUSH_SUBJECT` takes an
  operator `mailto:`/`https:` URI, and an override that would be rejected
  upstream is dropped for the default rather than honoured — a typo must
  not silently switch every notification off. §14 gains the end-to-end
  description so the next reader does not have to rediscover the trap.
- 1.39 (2026-08-01): **A deleted chat takes its work with it (§6), and a
  daily orphan sweep (§21).** `DELETE /v1/chats/:id` now stops the chat's
  run *before* the first row goes: new `RunService.discardChat` aborts the
  started attempt (pi kills the process group) and drops anything of that
  chat still queued. The order is asserted in a test — abort, delete,
  purge — because a run streaming into rows about to disappear keeps a
  process group alive, keeps spending credit, and ends on a foreign-key
  failure; the unwinding run now finds its chat gone and stores nothing.
  The workspace attachment purge is wired into the test fixture too, so
  "the folder is gone" is a claim with a test behind it. New internal
  maintenance job `WorkspaceSweeper`, daily on the scheduler's tick:
  removes `attachments/<chatId>/` for chats that no longer exist plus
  root-level scratch older than 30 days (`.png`, `.yaml`, `.mjs` only),
  never a live chat's attachments, never a directory, never a symlink,
  never anything outside POP_AGENT_WORKSPACE, never the database. One journal
  line per sweep with the counts. Session history is forever: sweeps touch
  only derived workspace files.
- 1.38 (2026-08-01): **Background tasks (§21).** New third sidebar tab —
  a prompt with a schedule (`once` or every N minutes), table `tasks`
  (migration 017), repo port + SQLite adapter. The scheduler lives in
  `application/` with the clock and the timer both injected
  (`ports/timer.ts`), ticks every 30s from main.ts, and works one single
  FIFO queue — never two task runs at once, because every run is a full
  agent turn and each opens its own chat. A run opens a fresh
  conversation, renames it to the task title through the manual-rename
  path (so `auto_title` goes off and no titler ever overwrites it), and
  goes through the normal RunService for failover, compaction and error
  persistence. Finishing records last_run_at / last_status / last_chat_id,
  parks an interval task one interval from when it *finished*, and
  switches a `once` task off; a failing run is a recorded status, never an
  exception that stalls the queue. New `RunService.whenRunEnds(runId)`
  answers "how did this run end?" in code, which an SSE broadcast cannot.
  Routes `GET|POST /v1/tasks`, `GET|PATCH|DELETE /v1/tasks/:id`,
  `run-now` (202, queued) and `toggle`, all session-guarded, strict Zod,
  new code `task_not_found`. Editing a schedule or switching a task back
  on re-parks it from now. UI: Chats | Files | Tasks, the list in the
  sidebar with switch / Run now / Delete, create and edit as a full-screen
  route. Also: the first-message title fallback now respects `auto_title`,
  so a hand-picked name is never overwritten even when it looks generic.
  New `ports/maintenance-job.ts`: internal housekeeping rides the same
  tick without being an agent-visible task.
- 1.37 (2026-08-01): **Type-enforced route protection (§9).** Routes
  mount only through `mountApi()`: branded `SessionGuardedRoutes` vs
  `publicSurface(reason, …)` — an unauthenticated URL no longer
  compiles by accident. `PUBLIC_V1_PATHS` becomes the single source of
  truth for guard exemptions (auth middleware derives from it), each
  with a written reason. A probe test walks every registered /v1 route
  sessionless and demands 401 unless declared, and asserts the HMAC
  download surface answers 4xx without a valid signature. healthz and
  /v1/health moved into their own mini-app to be blessed explicitly.
  Listed future: SecretString branding on the same pattern.
- 1.36 (2026-08-01): **Unlimited custom providers (§15).** The single
  fixed `custom` slot becomes a registry of user-created
  OpenAI-compatible instances (`provider.custom.registry`), ids
  `custom-` + 5 hex bytes with collision re-roll, one sealed key per
  instance under `provider.<id>.apiKey`, deleted with it. Definitions,
  statuses, resolve, the failover chain and the catalog all consume
  builtins + synthesized instance definitions (customs after builtins,
  registry order); pi registration is lazy per instance, no restart to
  add or edit. New routes `POST /v1/providers/custom`,
  `PATCH|DELETE /v1/providers/custom/:id`; the legacy
  `PUT /v1/providers/custom/config` is removed with its UI. Settings
  gains "Add custom provider" cards (name, endpoint with live
  "requests go to" normalization, model, write-only key, Test,
  Delete; add-then-cancel discards). Boot migration turns the legacy
  slot into one instance, moves the key, clears the legacy entries and
  aliases `custom` → the new id for old chat overrides.
- 1.35 (2026-08-01): **Automatic provider fallback (§15, fase 2).**
  The run loop iterates a failover chain (override → default → every
  usable provider, deduped, each with its default model) instead of
  calling the bridge once. Failures are classified TYPED
  (`shouldFailOver`): fail-forward on 401/402/403/404/408/429/5xx,
  transport errors and `provider_not_configured`; never on 400, Stop
  or a tainted turn; unknown stays put — the bridge now parses the
  HTTP status out of provider refusals and tags network failures.
  Mid-stream failures never fail over (tokens already rendered) but
  penalize. New in-memory advisory `ProviderCooldown` (5 min): the
  chain skips penalized providers unless all are; key save / sign-in
  forgives; restart resets. Failover is loud: persisted system message
  in the chat + `pop fallback:` journal line; every billed attempt
  books its own `llm_runs` row (`<runId>-f<n>` for retries). Context
  overflow keeps its §7 compact-and-retry path, same provider.
- 1.34 (2026-08-01): **Subscription providers via OAuth (§15, fase
  1.5).** `openai-codex` (ChatGPT subscription) and `github-copilot`
  (Copilot subscription) join the declarative list with
  `authType: "oauth"`. pi's `ModelRuntime.login` runs the whole flow;
  Pop Agent adds a single-active `OAuthFlowService` (10-minute timeout, new
  flow cancels the old), five `/v1/providers/:id/oauth/*` routes
  (start/state/input/cancel/logout), and the Settings card swaps the
  key input for Sign in / Disconnect with the flow's transcript inline
  (auth_url link, device code, one pending question). Credentials live
  only in pi's store (`pi-auth.json`); no token material on the wire;
  status reports `source: "oauth"`, resolve counts a signed-in
  subscription as usable, test wraps pi `checkAuth`, and an oauth
  session opens keyless.
- 1.33 (2026-08-01): **Health where the user can see it (§13, §14).** New
  public `GET /v1/health` reporting `{server, provider, db}` from cheap
  cached signals (key configured + last run outcome, `SELECT 1` on the
  database), and the sidebar's app bar moves to the bottom as a floating
  strip the chat list scrolls behind, gaining a gently pulsing red health
  button that only appears when something is wrong. Backend first; the
  frontend strip lands in the same change.
- 1.31 (2026-07-31): **Agent-written skills are English (§8).** The agent
  authors its own skills in English, like the rest of the repo; end-user
  skills stay free-language. Decided live: the agent's first two
  self-authored skills (`self-change`, `field-lessons`) date from today —
  it created the self-change flow unprompted after being taught
  edit→gate→commit, and the router picked both up within minutes.

- 1.30 (2026-07-31): **A real browser, and a crawler that hunts dead
  buttons.** Playwright + headless Chromium land as a dev dependency. Two
  uses: (1) the agent can browse the internet — a routed **web-browsing**
  skill teaches it to drive Chromium from bash for javascript pages,
  clicks and screenshots, with the rules spelled out (untrusted content,
  web_fetch's address policy, close the browser, prefer web_fetch for
  static pages); know-thyself mentions the capability. (2)
  `npm run ui:crawl` (tools/ui-crawl.ts) boots a throwaway pop (temp
  data dir, fake agent), logs in through the real form at a desktop and a
  phone viewport, clicks every visible button on every screen, and
  reports NO-OP buttons and console errors with screenshots — the class
  of bug Download just was, hunted by machine. Not part of the gate.

- 1.29 (2026-07-31): **Files awareness built (§7.4).** `filesCatalogBlock`
  (names + folders, 30 newest, untrusted-delimited, with the
  search-before-shrugging line) joins the bridge's instructions next to the
  pinned skills, so a new upload reaches the next run via the session
  reopen; know-thyself teaches the same instinct. Seeding gained an
  amnesty: a pre-seed-era default file still identical to the shipped
  content gets stamped with the seed hash and follows upgrades from then
  on (v0.2 installs heal by themselves; a truly edited file stays the
  user's). Fixes shipped same day: on a phone the Files screen keeps the
  app header — a shared ShellHeader rendered above the breadcrumb
  (`md:hidden`) instead of vanishing with the sidebar; Download works
  again everywhere — the signed link arrives after an await, so
  `window.open` was popup-blocked, replaced by an anchor click
  (`web/src/lib/download.ts`) over the attachment disposition.

- 1.28 (2026-07-31): **Files awareness (§7) — design recorded,
  implementation pending.** A Files catalog (names + folders, recent N,
  untrusted-delimited) joins the session instructions, and know-thyself
  gains the search-before-shrugging instinct: unknown term →
  `files_search` + `memory_search` before the web. No per-turn RAG chunk
  injection — the agent fetches with its own tools. Motivated by the
  OffSchool dialogue, where the answer sat in a filename the agent could
  not see. Also validated live today: the self-architecture skill routed
  at 6.54 for the auto-programming question and Pop Agent answered TypeScript
  with the platform's own reasons.

- 1.27 (2026-07-31): **Self-knowledge hardening built (§8).** Skills carry a
  `pinned` flag (frontmatter, DTO, save schema); the router skips pinned
  skills and their bodies lead the session system prompt through the
  bridge's instructions string, which already reopens a session when it
  changes — so a pin edit reaches the next run. know-thyself ships pinned,
  and is pinned by code even where a v0.2 file predates the flag. The
  router service reports every selection and main logs
  `pop skills: <slug>=<score> …` — slugs and scores only, never message
  content. New routed **self-architecture** skill: the decision rule
  ("your extensions are TypeScript on your own runtime"), how to read
  your own source, and the generated repo/UI map. The map lives in
  `self-map.generated.ts`, emitted by `tools/generate-self-map.ts`
  (`npm run selfmap`); `selfmap:check` opens the gate, so drift fails the
  build. Seeded defaults now carry a `seed` content hash: a default the
  user never edited upgrades with the ship, an edited one stays theirs.
  The Portuguese messages from the motivating dialogue are router test
  cases (default-skills.test.ts).

- 1.26 (2026-07-31): **UI map joins the self-map (§8).** The agent has no
  AX tree of its own PWA — it runs server-side; the interface renders in
  the user's browser, out of reach. Navigation knowledge ships as data
  instead: the self-map generator derives a UI map (routes from
  `web/src/App.tsx`, labels and Settings sections from
  `web/src/i18n/en.ts`) so Pop Agent can guide the user through its own
  screens. Design recorded; implementation pending with 1.25.

- 1.25 (2026-07-31): **Self-knowledge hardening (§8) — design recorded,
  implementation pending.** Motivated by a real PT dialogue where the
  router never surfaced know-thyself and Pop Agent recommended Python for its
  own extensions. Four rules land in §8: skills can be **pinned** into the
  session system prompt (know-thyself ships pinned; pinned set stays
  tiny); the router **logs selections and scores** per turn, and
  thresholds are tuned from those logs (e5 similarity is band-compressed
  — do not eyeball the floor); `whenToUse` carries translation-stable
  PT/EN trigger tokens, with misrouted real dialogues as test cases; and a
  routed **self-architecture** skill carries the deep map — layers,
  dependency rule, where the source lives, "Pop Agent's extensions are
  TypeScript on Pop Agent's runtime" — with its repo-map section generated by a
  script, never hand-written.

- 1.24 (2026-07-31): **Round 6 — voice raw-first, Files, semantic file
  index.** Voice (§14): the transcript is used raw the moment whisper
  finishes (measured 5.9s end-to-end for 11s of audio); the LLM cleanup
  is an opt-in in Settings with its own model picker (empty = service
  model). Files (§14): the Artefacts tab is renamed **Files**, the
  Chats | Files picker sits above New Chat, and Files is a flat folder
  tree -- upload (root or open folder), download, rename, delete per
  file; New/Rename/Delete Folder, folder delete warns it removes the
  files inside. Chat uploads land at the root. A file may exist without
  a chat: migration 012 rebuilds artifacts with chat_id nullable and
  adds folders; chatless bytes live under artifacts/_files/. Semantic
  index (§7/§14): migration 013 adds artifact_chunks (extracted text,
  chunked, one BLOB embedding per chunk, FK cascade); a FileIndexer
  trails every stored file off the request path with a boot backfill,
  and the agent gains **files_search** -- validated live: the real
  agent found a fact planted in an uploaded file. New surface: POST
  /v1/artifacts (chatless upload), PATCH /v1/artifacts/:id,
  GET/POST/PATCH/DELETE /v1/folders (§13).

- 1.23 (2026-07-31): voice default model is **base** (§14) — measured on
  the 4-core test server with an 11s sample: base 5.5s / small 18.8s /
  medium 63.4s, near-identical transcripts; the maintainer revised his
  earlier medium-default decision. Settings → Voice still offers the
  full manifest.

- 1.22 (2026-07-31): **Rounds 4–5 built** (list redesign, per-device
  prefs, resilience, the Updates screen). Decisions recorded: the home
  list gains **Chats | Artefacts segments** with search reaching archived
  chats (badged) and a deliberate menu -> View archived — the pinned line
  and the collapsible footer are gone (§14); **swipe on a chat row**:
  right = delete (confirmed), left = archive (not) — the maintainer's
  mapping, deliberately the inverse of iOS Mail (§14); the per-chat knobs
  (thinking visibility toggle + model picker) live **in the chat header**,
  always visible while reading -- reversed the same day from a strip under
  the composer (§14);
  **font size** and **thinking visibility** are device-scoped localStorage
  prefs like the theme (§14); **SIGTERM/SIGINT flush**: a server restart
  parks every in-flight run's partial answer as an interrupted-marked
  message instead of eating it (§6, §14); **Settings -> Updates** ships
  its first cut (§15): three cards — the PWA check (moved from
  Appearance), the Pop Agent server card reading the latest origin tag with
  the update command shown (the **notify-only** channel: one push per new
  version, deep-linking to ?section=updates; applying stays a shell act),
  and an Environment card (pi/node/ffmpeg/poppler/tesseract/whisper
  versions, visibility only). GET /v1/artifacts (all chats) joins §13.
  Fixes shipped same day: DELETE responses parse (204), unarchive
  refreshes both lists, composer scrollbar only at its cap, the update
  Reload button reloads unconditionally, voice model default small on
  this hardware (medium measured 5.8x realtime on 4 cores).

- 1.12 (2026-07-31): **v0.2 built, tagged v0.2.0.** Skills + the Skill
  Router (§8): markdown skills under POP_AGENT_DATA_DIR/skills, a pure lexical
  router that prepends the relevant few per turn, 15 defaults led by
  know-thyself, a full-screen CRUD in Settings. Backup/restore as tar.gz
  with the key excluded (§16). Web Push when a run finishes, VAPID keys in
  the secrets table (§14). Passkeys via WebAuthn for Face ID unlock (§9).
  Local voice already shipped in 1.10. Cost dashboard over llm_runs (§14).
  Two decisions recorded here: **attachments extraction** — Pop Agent does not
  bundle a PDF/DOCX/OCR pipeline like aw; attachments are written into the
  agent's workspace and the agent extracts what it needs with its own
  tools (pdftotext, unzip, its reader), which fits Pop Agent's "agent with real
  fs" design where aw's server-side extraction fit its tool-less desktop
  app. **Update channel** (§15): Pop Agent does not self-update from the running
  process; `GET /v1/update/status` reports the installed versions and the
  latest pi on npm, and Settings shows the one-line shell update command,
  which runs the same `npm run gate` before restarting. Automatic
  pi-update gate with rollback/probation stays documented for a later
  version — the manual path is gated and safe.

- 1.11 (2026-07-31): **Phase 4 complete, tagged v0.1.0.** The agent got
  its own notes vault (§11) behind aw's path jail, exposed as
  notes_list/read/search/write pi tools; web_fetch with SSRF protection
  and the safety envelope (§12); lexical memory over an FTS5 index of
  every message with memory_search/open/recent and a recent-chats
  catalog in the system prompt (§7); and a living user-memory document
  with a one-level backup, its own tools and GET/PUT /v1/memory (§7).
  Custom tools are built with typebox (added as a direct dependency).
  Conversation compaction is pi's own: it auto-compacts on context
  pressure (SessionCompactEvent), so Pop Agent builds nothing and inherits it.

- 1.10 (2026-07-31): Phase 4 begins and the mode changes. The external
  content safety layer landed (§10): pure sanitize (invisible-strip by
  codepoint, NFC, base64 flag, ~40 EN+PT injection patterns over
  accent-folded text) and the per-turn taint riding pi's tool_call /
  tool_result hooks, with a `confirm` SSE card + `POST /chats/:id/confirm`
  gating destructive bash in a tainted turn. Deleting a chat now deletes
  its JSONL, sidecar and attachments too, not just the rows (§6). Voice
  moved from a cloud model to local whisper.cpp (ffmpeg + whisper-cli on
  the server, no tokens). And the process itself: continuous execution,
  no manual acceptance between phases (§20).

- 1.9 (2026-07-31): Phase 3 finished — the pi bridge (steps 0–2, spec 1.8
  session) grew the provider, the titles and the accounting (steps 1, 3,
  4). OpenRouter configuration: the key lives in the encrypted secrets
  table, beats `OPENROUTER_API_KEY`, is write-only on the wire, and can be
  tested with one five-token completion (§9, §15); `GET /v1/models`
  prefers the live catalog (key present, cached 24h) and falls back to
  pi's offline built-in one, so CI never touches the network. Settings
  grew `defaultModel`, `serviceModel` and `customInstructions`; the
  instructions reach pi through a `DefaultResourceLoader` that replaces
  the coding persona with Pop Agent's neutral prompt and disables pi's CLI
  resource discovery (§5). Auto-titles: at the user's 3rd turn and every
  10th after, the service model writes TITLE + SUMMARY in the
  conversation's language; failures are silent, a manual rename turns the
  feature off per chat (`chats.auto_title`), and `chats.summary` waits
  for Phase 4's memory (§14). Accounting: one `llm_runs` row per run with
  pi's real numbers; `run()` resolves with the usage rather than emitting
  a synthetic event, and the fake bridge books an honest zero (§6, §14).
  New routes: `GET /v1/providers`, `PUT|DELETE /v1/providers/:id/key`,
  `POST /v1/providers/:id/test` (§13). Wizard screen 3 is real; a chat
  with no provider links to Settings (§14).

- 1.8 (2026-07-31): Phase 2 built — the whole chat against a scripted
  `FakeAgentBridge`, no tokens spent. Chats and messages persisted (§6);
  run orchestration with one run per chat, a global queue and fallback
  titles (§5, §14); chat routes and an SSE hub authenticated by one-time
  ticket, replacing the hello-world stream (§13); and the React chat UI
  with streaming, thinking and tool cards, a queueing composer and a model
  picker (§14). Decisions recorded as they were made: the SSE ticket;
  the `run-status` event; stopping a queued run drops it from the queue
  and still reports `aborted`; tool events are folded into one record per
  call on both sides of the wire; message order breaks ties on rowid;
  `POP_AGENT_ENGINE=fake|pi`; context menus are visible buttons rather than
  long-press; and the skills selector is named the **Skill Router** (§8).
  The smoke grew to fourteen steps, now covering the stream, a tool run
  and Stop.

- 1.7 (2026-07-30): Phase 1 built — SQLite with a numbered-migration
  runner, settings and AES-256-GCM-encrypted secrets (§4, §6, §9); auth
  with HMAC session tokens, epoch, argon2id, recovery key and progressive
  lockout (§9); settings and about endpoints (§13); the React PWA with the
  setup wizard, login, recovery and settings screens served by the same
  process on one port (§14); and an end-to-end smoke in the gate (§18).
  Decisions recorded here as they were made: password 10–128 with no
  composition rules; the recovery-key alphabet without confusable
  characters, case-insensitive input and rejection sampling; recovery
  spends the key and issues a new one; "Sign out other devices" keeps the
  acting device signed in; sliding session renewal via `x-pop-agent-token`;
  settings PUT is a strict full replace; the theme belongs to the device
  and never reaches the server; narrow layouts follow the Telegram model
  instead of a drawer; and HTTPS is documented as two scenarios (§18) —
  public VPS with Let's Encrypt, or `tailscale serve` where the line
  blocks inbound 80/443.

- 1.6 (2026-07-30): default port is 8787 — one single port on the test
  server until HTTPS (443 via Caddy) lands; the placeholder hello page
  hands 8787 over to Pop Agent (§4).

- 1.5 (2026-07-30): development moves onto the test server — the agent
  codes, gates and runs everything on ubuntu-home over SSH; nothing
  executes on the maintainer's machines (§20).
- 1.4 (2026-07-30): backend is 100% clean architecture (§3) — aw's layer
  model ported (domain / application / infrastructure / interface, DTOs in
  `shared/`, composition root in main.ts), with the boundary test enforcing
  the dependency rule and inner-layer purity in the gate; section paths
  updated (§5, §7, §10–12).
- 1.3 (2026-07-30): repo bootstrapped on the Windows dev machine (Mac has
  npm blocked); §20 dev environment updated; WebAuthn routes added to §13.
- 1.2 (2026-07-30): biometric unlock via WebAuthn/passkey added to §9
  (maintainer's addition to the design notes, consolidated here), slotted
  into the v0.2 roadmap; §19 updated.
- 1.1 (2026-07-30): update model redesigned (§15) — two channels (pi from
  npm, Pop Agent from its repo) sharing last-known-good pinning, a post-update
  smoke gate, automatic rollback with self-disabling auto-update + user
  notification, and a 24h probation window for pi; `pop update` joins
  the CLI (§17).
- 1.0 (2026-07-30): first consolidated spec — extracted from the three
  vault notes (Visão e Escopo, Backend, Frontend) and the 60 alignment
  answers (rounds 1–3).
