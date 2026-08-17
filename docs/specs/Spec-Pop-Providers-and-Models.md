# Pop Agent — providers and models

**Status:** normative
**Legacy coverage:** §15 through multi-provider phase 2
**Primary implementation:** server/src/application/providers, provider adapters, Settings
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
## 15. Providers, models, updates

### Multi-provider (fase 1)

Design copied conceptually from the Agent Workspace; transport and
catalog come from pi (`ModelRuntime` + pi-ai `Models`), never
reimplemented.

- **Provider is data, not a class**: a declarative list of definitions
  `{id, name, baseURL, authType, defaultModel, allowCustomModel}`.
  `authType` is `"api-key"` or `"oauth"` (fase 1.5 below); vendor
  quirks get a point `if`, not a subclass. Adding a provider = adding
  a literal.
  Phase 1 ships: OpenRouter (default, **default model: Kimi K3**),
  OpenAI and Anthropic. Fase 1.5 adds the OAuth pair pi supports
  natively: `openai-codex` (ChatGPT subscription) and `github-copilot`
  (Copilot subscription). Custom OpenAI-compatible endpoints are
  user-created instances, unlimited (below).
- **Unlimited custom providers**: the registry (settings key
  `provider.custom.registry`) holds `{id, name, baseURL, defaultModel}`
  per instance; ids are `custom-` + 5 random hex bytes, re-rolled on
  collision. Each instance's key is sealed under its own id
  (`provider.<id>.apiKey`) and deleted with it. The definition list
  everything consumes = builtins + one synthesized definition per
  instance (customs join resolve/chain after the builtins, in registry
  order); the engine registers each instance with pi lazily on use, so
  adding or editing one needs no restart. Base URLs are normalized on
  save (trailing slashes and a trailing `/chat/completions` stripped;
  the card shows "requests go to" live). Routes:
  `POST /v1/providers/custom` (create → id),
  `PATCH|DELETE /v1/providers/custom/:id`; the single-slot era's
  `PUT /v1/providers/custom/config` is REMOVED. Migration: on boot, a
  legacy `provider.custom.config` and/or `provider.custom.apiKey`
  becomes one registry instance (key and all), the legacy entries are
  cleared, and `provider.custom.alias` remembers the new id so a chat
  override still saying `custom` resolves to it.
- **Model identity = the pair `(providerId, modelId)`**, always. No
  synthetic string of our own; each provider names the model its way.
  Everywhere that stores `model` today (settings, chats, llm_runs) now
  stores the pair; migration treats the old value as OpenRouter
  (backfill `provider='openrouter'`).
- **Keys are write-only**: the UI never reads the key back (input starts
  empty, placeholder "••• configured" when one exists); no endpoint
  returns key material (only `hasKey: boolean`); keys never in logs,
  model context or tool results. Storage: the existing encrypted
  secrets column (secret.key), one row per provider.
- **Saving ≠ activating**: saving a key/config never hits the network.
  Validation (one real ~5-token completion, "Reply with exactly: ok")
  runs only on explicit activation/test; if it fails, the typed config
  IS kept with a warning — a bad key must not destroy what the user
  typed.
- **Model catalog in 3 layers**: live (ModelRuntime refresh now) →
  cache (last good fetch, in SQLite) → static (built-in list per
  provider). Responses carry `source: live|cache|static` so the UI can
  say "cached list, endpoint down". Providers with `allowCustomModel`
  use free input + datalist.
- **Per-chat override**: `provider`/`model` columns on the chat row;
  empty = global default. A broken override (provider without key,
  model gone) degrades silently to the global default, never an error.
- **Mid-chat model switch**: the conversation is preserved — only the
  model adapter/session is rebuilt, never the history; the switch shows
  as a system bubble in the chat (client-side, NEVER sent to the model
  — chat override is UI state, not a conversation turn).
- **The global default is never empty**: if the default provider's key
  is deleted/disabled, the next configured provider is elected (or an
  explicit warning). An empty slot silently breaks everything that
  resolves "the default" (restore, title, voice) while chats look fine.
- **Endpoints**: `GET /v1/providers` (definitions + hasKey +
  defaultModel, no secrets), `PUT|DELETE /v1/providers/:id/key`,
  `POST /v1/providers/:id/test` (the validation completion),
  `GET /v1/models?provider=<id>` (3-layer catalog). `/model` accepts
  provider + model.
- **Chat Model and Service Model, one pair PER PROVIDER** (corrected
  07/08, built 1.60). The Chat Model is what the user talks to; the Service
  Model is what Pop Agent uses for its own work — naming a conversation,
  summarizing, tidying a voice transcript. It used to be one global setting,
  which was mono-provider thinking: a stored value is a *model id*, and a
  model id only means something inside one provider's catalogue. An install
  whose service model said `moonshotai/kimi-k3` asked OpenAI for a model
  OpenAI has never heard of the moment a chat ran there.
  - Stored beside the credential, per provider: `PUT
    /v1/providers/:id/service-model`, and a picker on the provider's card.
  - **Empty means "follow this provider's Chat Model"** — a fallback, not a
    value copied at setup. A copy is a second thing to keep in sync: change
    the chat model six months later and the copy still names the model you
    left behind, which for a custom endpoint may no longer be served at all.
    Picking the chat model again is what clears the override.
  - **Resolution**: a service task inherits the provider of whatever it
    serves — a title takes its chat's — and a job with no parent chat takes
    the head of the priority list. `resolveServiceModel(context)` and
    `resolveServiceChain(context)` on `ProviderService`; no consumer reads a
    global setting any more.
  - **Failover**: a service task walks the same chain a run does (§15 fase
    2). It tries every remaining provider rather than consulting
    `shouldFailOver`, and that difference is deliberate: that predicate
    reads a status code and the HTTP gateway does not carry one. Given the
    choice between guessing a class from prose and spending one more very
    small call, it spends the call.
  - The `voiceCleanupModel` override in Settings still wins where set, and
    applies to the FIRST chain entry only — carrying a model id down the
    chain would ask the fallback provider for a model it never heard of,
    which is the bug this whole correction removes.

### Subscription OAuth (fase 1.5)

- **Subscription auth rides pi's own login flows** — `openai-codex`
  (ChatGPT Plus/Pro) and `github-copilot` (Copilot seat). Pop Agent never
  reimplements an OAuth dance: `ModelRuntime.login` runs the flow and
  persists the credential into Pop Agent's own auth file
  (`POP_AGENT_DATA_DIR/pi-auth.json`); refresh happens inside pi per
  request. No key exists anywhere for these providers.
- **One interactive flow at a time**, server-side
  (`OAuthFlowService`): `POST /v1/providers/:id/oauth/start` begins it
  (starting a new flow cancels the previous), `GET .../oauth/state` is
  the transcript the browser polls (~2 s), `POST .../oauth/input`
  answers the flow's one pending question, `POST .../oauth/cancel`
  aborts, `POST .../oauth/logout` disconnects (pi `logout`). A flow
  nobody finishes times out after 10 minutes. A provider 429 persists a
  per-provider cooldown deadline under the data directory, honoring numeric
  `Retry-After` when available and otherwise waiting one hour; restarting the
  service cannot bypass that brake. OAuth journal lines contain only provider,
  short flow id, stage, result/status class and duration — never provider HTTP
  bodies, prompt answers, device codes, URLs or credentials.
- **No token material ever leaves the server**: the state carries only
  display events (info / auth_url / device_code / progress) and the
  pending prompt; credentials go from the flow straight into pi's
  store. The wire shapes are copied field-by-field, never spread.
- **Temporary upstream Copilot patch:** pi 0.84.1 launches one policy request
  per known model in a single `Promise.all` (30 requests today), causing an
  authorized login to end as 429 at the final `/models` read. Pop carries the
  compiled form of upstream commit `b3edf017` through `patch-package`, limiting
  policy updates to four concurrent requests. `postinstall` reapplies it and
  the gate verifies it. Remove the patch machinery as soon as a published pi
  version contains that commit.
- **Subscription allowance belongs to its provider card.** Settings → Model →
  OpenAI subscription reads the provider's rolling usage windows and reset
  times through `GET /v1/providers/:id/subscription-usage`; allowance stays on
  that provider card rather than creating a separate Settings destination. The
  engine asks pi for fresh OAuth auth first, then calls OpenAI's Codex usage endpoint. Only plan, percentages and
  reset clocks cross the infrastructure boundary — never email, account id or
  tokens. Failure hides the optional row rather than breaking Model settings.
- **Status/resolve semantics**: for an oauth definition `configured`
  = "the engine holds a credential" (`hasConfiguredAuth`), reported as
  `source: "oauth"`; resolve treats a signed-in subscription exactly
  like a stored key when electing the pair; test uses pi `checkAuth`
  instead of the paid HTTP probe; the model catalog answers from pi's
  built-in list (no gateway, keyless). Session open for an oauth
  provider must not demand an API key.
- **The auth file is the truth, not the snapshot.** pi's refresh
  (post-login bookkeeping: remote catalogs, availability) is best
  effort and may stall on the network, and its internal snapshot only
  moves when that bookkeeping finishes -- so every Pop Agent decision
  about "is there a credential" (`providerLogin`, `hasProviderAuth`,
  the authenticated-runtime door) reads `pi-auth.json` directly, and
  `providerLogin` resolves the moment the credential file lands,
  letting pi's bookkeeping run in the background. To keep that
  bookkeeping cheap and non-blocking, the service runs with
  `PI_OFFLINE=1` (catalog updates ride pi package upgrades instead).
- **The card outlives the page.** Signing in means leaving for the
  provider and coming back, and the way back is usually a fresh mount:
  a new tab, a reload, the PWA resumed from the background. The card
  therefore asks for the flow state on mount and adopts a running flow,
  instead of only knowing about flows it started itself.
- **The method choice is Pop Agent's words, not pi's.** pi offers a
  subscription two ways and calls the browser redirect "(default)" --
  but that redirect targets `localhost:1455` on the machine doing the
  browsing, which on a self-hosted install is not the machine running
  Pop Agent, so it can only end in a URL copied back by hand. The card
  relabels the two known methods (`device_code`, `browser`) itself and
  puts the code one -- no callback, works from any device -- first.
  Methods pi may add later render unrelabelled, as they arrive.
- **The redirect path is three steps, each said once**: open and
  approve, expect a page that does not load, paste that page's address.
  The warning comes *before* the input, because a user who meets the
  failed page unwarned reads the whole sign-in as broken and stops
  there. The steps carry the sign-in link, so the transcript drops its
  duplicate row, and the input uses Pop Agent's own placeholder -- pi's is
  the loopback URL itself, which reads like something to type.

### Multi-provider (fase 2 — automatic fallback)

- **The priority list is the only lever** (settings key
  `provider.order`, ids in order, #1 first). The list the user edits IS
  the failover order, and its head IS the global default: after every
  edit `electDefault` writes the first *usable* entry back as
  `defaultProvider`, so the numbered list can never say one thing while
  new chats do another. There is no separate "default provider"
  control. Providers absent from a saved list keep a position at the
  tail — a provider added later is never orphaned outside the chain —
  and unknown ids are dropped rather than stored. Routes:
  `PUT /v1/providers/order` (whole list, never a move).
- **A per-provider on/off switch** (settings key `provider.disabled`,
  `PUT /v1/providers/:id/enabled`). Off means out of the chain
  entirely, even for a chat that names the provider: the run falls
  through to the next candidate instead of failing. Switching off the
  head hands the default to the next usable entry; with nothing usable
  the current default is left alone, because an empty slot breaks more
  than a stale one.
- **The chain**: a run's failover chain = chat override (when usable) →
  the priority list, in order, one entry per provider
  (`ProviderService.resolveChain`). The global default gets NO entry of
  its own — it used to sit ahead of the list, a hidden #0 nobody could
  see or move, so an install whose stored default was a dead endpoint
  kept starting there however the list was arranged. The default is
  derived from the list, never a second opinion about order; it still
  decides the MODEL for its own provider (the list says who answers,
  the model picker says with what). Only usable providers (key stored
  or subscription signed in, and switched on) take a place. An install
  that never edited the list gets its existing default as #1, so
  removing the old control moved nobody's answers. With nothing usable
  it degrades to the head of the list, so the run still fails with the
  error that points at Settings.
- **Attempt lifetime belongs to pi/provider**: Pop Agent adds no competing
  silence timeout around `AgentBridge.run`. pi's configured retry policy handles
  transient failures and only its final outcome reaches the host bridge; the
  provider transport owns request deadlines. This keeps slow reasoning and long
  tool turns under the same policy as a native pi session instead of aborting a
  healthy attempt at an arbitrary host-side minute.
- **Error classification is TYPED** (`shouldFailOver`, application
  layer): by code and HTTP status, never substring-only. Fail-forward:
  401/402/403/404/408/429/5xx, `network_error` (transport: ECONN*,
  TLS, fetch failed…), `provider_not_configured`, `model_not_available`.
  Never: 400, the
  user's Stop (`aborted`), `turn_tainted`. Anything unclassifiable
  stays put. The bridge supplies the typing: it parses the status out
  of the code-shaped places providers put it and tags transport
  failures. Context overflow keeps its own path (§7: compact + retry
  same provider once, inside the bridge); only a failover-class error
  on the retry moves on.
- **Mid-stream failure does NOT fail over** (tokens already rendered)
  but still penalizes the provider; the run fails in place with the
  persisted system mark.
- **Advisory cooldown** (`ProviderCooldown`, in-memory, escalating —
  1.73): a penalized provider moves behind healthy candidates in the next
  chains, but remains as a last recovery path if those candidates also fail.
  If every candidate is penalized, their original order is preserved. The wait
  lengthens with each consecutive strike (1 min →
  5 → 15 → 60); a flat 5 minutes both forgave a provider that was
  down for an hour too early and kept punishing a hiccup too long.
  Saving a key, completing a sign-in, a green connection test or a
  successful run forgives the provider; a restart forgives everyone.
- **Failover is LOUD and chronological**: only when the provider changes, a
  persisted system message in the transcript ("Answer retried via X after Y
  failed (code).") is inserted before the replacement answer, plus one journal
  line (`pop fallback: chat=… from=… to=… code=…`). It is never a floating
  status detached from message order, and ordinary answers do not repeat their
  provider/model. Every billed attempt books its own `llm_runs` row (failover
  attempts under `<runId>-f<n>`), so the accounting shows what each provider
  really charged.
- **A retry never replays the user's prompt** (1.73): before a
  failover hop or an overflow retry, the bridge rewinds the pi session
  to before the user message (`SessionManager.branch` on the entry
  id) and resyncs the agent's history — the next provider answers the
  message once, not twice in the saved context.
- **Thinking and tool calls gate the failover** (1.73): a run that
  already streamed either never retries on the next provider —
  re-executing side effects is worse than failing in place. An
  abandoned attempt still books whatever usage settles late, and its
  session is hard-forgotten (`discardSession`) so it is never
  re-prompted into a shared context.
- **Auth-class failures surface** (1.73): a refusal the cooldown
  classifies as auth stamps `authErrorAt` on the provider (DTO +
  "sign in again" badge in Settings), cleared by a fresh key, a fresh
  sign-in or a green connection test.
- **Background work bills like chat work** (1.73): `completeAsService`
  records a `llm_runs` row per completion (`kind: 'service'`,
  migration 032; `chatId` empty by convention), with the provider's
  reported usage and zero cost for a subscription.
- Still future: a user-editable priority order (today the order is the
  definition list with the default first).
