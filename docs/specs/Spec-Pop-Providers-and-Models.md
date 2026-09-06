# Pop Agent — providers and models

**Status:** normative
**Legacy coverage:** §15
**Primary implementation:** `server/src/application/providers/`, `server/src/infrastructure/providers/`, provider HTTP routes and Settings UI
**Related:** [`Spec-Pop-Pi-Agent-Integration.md`](Spec-Pop-Pi-Agent-Integration.md), [`Spec-Pop-Security.md`](Spec-Pop-Security.md), [`Spec-Pop-Deployment-and-Operations.md`](Spec-Pop-Deployment-and-Operations.md)

## Domain model

A model identity is always `(providerId, modelId)`. A model ID has meaning only
inside its provider and is never passed down a failover chain unchanged.
Provider definitions are declarative data; application policy does not grow one
subclass per vendor.

Built-ins include API-key providers (OpenRouter, OpenAI, Anthropic) and pi-native
subscription providers (OpenAI Codex and GitHub Copilot). OpenRouter is the
factory default and its shipped fallback/default is currently Kimi K3. Built-in
catalog defaults are release data, not permanent user state; owner selections
remain authoritative.

A provider status exposes id/name, auth type, configured/source flag, default
chat model, service model, custom-model support, priority, enabled state and
safe auth-error timestamp. It never exposes credential material.

## Credentials

API keys are write-only. A saved key is encrypted through the secrets repository
under a provider-specific name. Responses use `configured/hasKey` only; inputs
render empty with a configured placeholder. OpenRouter may use the historical
environment seed only when no stored key exists; owner-saved key wins.

Saving configuration never performs a network request. Test/activation is an
explicit low-token completion. Failed validation keeps what the owner typed and
returns a warning rather than destroying configuration. Saving new credentials
clears stale auth error/cooldown/catalog evidence.

OAuth providers use pi `ModelRuntime.login/logout`; Pop does not implement the
vendor OAuth protocol. Credentials stay in Pop's isolated pi auth store.
Interactive flow state is server-owned, single active flow per provider,
cancellable and bounded by timeout. Transcript events are sanitized and never
contain access/refresh tokens. Provider 429 cooldown is persisted so restart
does not turn repeated login into abuse.

## Custom OpenAI-compatible providers

The owner may create up to 256 custom instances. Each has random collision-safe
`custom-…` ID, display name, normalized base URL and default model. Trailing
slashes and a trailing chat-completions path are normalized. Each key is sealed
under that instance ID and removed with it.

Instances join the same definition list, priority chain, model resolution and
usage flow as built-ins. Editing is live; pi registers the current definition
when opening/using a session. A legacy single custom slot is migrated once to a
registry instance with an alias for old chat overrides, then legacy settings are
cleared.

Custom endpoints are owner-authorized network destinations and may intentionally
be loopback/private when the server itself hosts a model. This is distinct from
untrusted `web_fetch` SSRF policy. Secrets still cannot enter the URL or logs.

## Priority, enablement and global default

One ordered provider list is both failover order and default election. Position
1 is the desired global provider. Disabled, unconfigured, auth-broken or
cooldown-penalized entries are skipped for execution. Unknown/stale IDs are
removed when writing order; newly added providers append so they remain
reachable.

After order, enabled state, key or custom-instance deletion changes, the first
usable entry is elected and written as global default. If none is usable, the
existing pair remains visible with an actionable configuration error rather
than an empty invalid setting.

A per-chat `(provider, model)` override persists with the chat. Missing override
uses global default. Legacy model-only rows migrate as OpenRouter. A stale or
unusable override resolves through product fallback policy; it never causes a
model ID to be sent to a different provider.

Changing a chat model preserves product transcript and pi history. It changes
future execution context/session model and appears as UI state/timeline context,
not a forged user/model instruction.

## Chat and service models

Each provider has:

- chat/default model: normal conversation for that provider;
- service-model override: isolated titles, Auto-Skill creator/reviewer, voice
  cleanup and other internal completions.

An empty service override means “follow this provider's chat model” dynamically,
not a copied model ID. Service work with a parent chat starts from that chat's
provider; independent work starts from the provider chain head. Each failover
entry resolves its own service model.

A feature-specific override such as voice cleanup may replace only the first
entry's model. It cannot be propagated to another provider. Service completions
run without chat session/history/tools and book usage under an explicit service
purpose.

## Model catalogs

Catalog lookup follows freshest available evidence:

1. live authenticated provider gateway where supported;
2. last good bounded cache (24-hour policy metadata);
3. pi engine's offline built-in catalog;
4. static provider fallback.

Responses identify `live | cache | engine | static`. Failed live refresh does
not erase last-good data. Key/default/custom edits invalidate relevant cache.
Catalog entries are normalized/deduplicated and bounded. Providers allowing a
custom model permit validated free input when a model is absent from the list.

The catalog is never fetched on every chat render or health probe. PWA model
pickers use provider grouping/search and preserve the complete `(provider,id)`
pair.

## Execution and failover

RunService owns product retry policy; pi adapter executes one resolved pair.
The provider chain is snapshotted for a run attempt. Failover occurs only for
classified replay-safe failures and rewinds the rejected pi branch first.
Unsafe/ambiguous work, owner Stop and deterministic local/tool failures are not
blindly replayed.

Provider cooldown applies advisory backoff after transient/rate-limit failure.
Saving credentials/configuration is new evidence and clears it. Auth-class
failure records a visible marker and prevents health from claiming configured
means working. A successful OAuth/key test clears the marker.

Service completions may walk remaining providers after a failure because they
are isolated and replayable. Chat attempts follow the stricter RunService
classification. Every entry resolves a model belonging to itself.

## Usage, cost and allowance

Every provider call contributing to one product run is accumulated and stored.
Rows identify provider/model, input/output/cache/reasoning tokens where
available, cost and whether the call is service work. Missing upstream usage is
represented as unknown/partial, never fabricated as zero.

OpenRouter API-key credit endpoints and pi-native subscription allowance are
optional provider-specific snapshots. They expose only allowance/remaining
fields needed by Settings. Credit/allowance lookup failure does not block chat
and never logs raw credential/provider pages.

Cost calculation uses provider semantics and model-reported pricing where
available. Currency formatting is frontend/shared policy; billing estimates are
labeled honestly and are not invoices.

## API and UI

Guarded provider routes expose status/order/enabled state, key write/delete/test,
custom CRUD, single-request card configuration, service model, model catalogs,
OAuth start/transcript/answer/cancel, credits and subscription usage. Bodies are
strict and bounded before mutation.

Settings presents providers in priority order with enabled/configured/auth-error
state. Key values are never prefilled. Saving and testing are distinct actions.
One Save sends identity, model pair, optional replacement key and priority in a
single request, so a network failure cannot split a card across several partial
saves. A new custom provider exists only after its complete form is saved;
cancelling a draft creates no hidden registry row. Custom provider cards show
the normalized endpoint. Model selectors do not lose provider identity. OAuth
UI displays the server-owned transcript/pending question and supports
cancellation/recovery.

## Failure behavior

- no provider configured: chats fail with actionable stable configuration state;
- live catalog down: cache/engine/static remains available and source is shown;
- revoked key/subscription: auth marker appears and unsafe repeated attempts stop;
- rate limit: provider cooldown honors Retry-After when available;
- custom endpoint malformed: save validation refuses/normalizes before use;
- custom deletion: key/cache/order/aliases are cleaned and default re-elected;
- stale chat model: resolve current provider fallback, never cross-provider ID;
- provider failure after unsafe work: no automatic replay;
- OAuth provider page/error: transcript receives safe summary only.

## Test obligations

- built-in definitions, defaults and model-pair migration;
- write-only key precedence, encryption adapter and no-secret DTO/log paths;
- order/enable/default election under deletion and no usable provider;
- 256 custom cap, random collision retry, URL normalization and legacy migration;
- live/cache/engine/static catalog fallback and invalidation;
- per-provider service model and cross-provider failover resolution;
- OAuth lifecycle, cancellation, timeout, 429 persistence and token-free transcript;
- chat failover replay classification/rewind and cooldown;
- usage aggregation, service-purpose booking, credits/allowance failure isolation;
- provider UI keeps saving separate from testing and pair identity intact.

## First-run provider configuration

After the owner acknowledges the recovery key, setup opens the same Add Provider
picker and configuration component used in Settings. API-key, pi-native OAuth
and custom compatible providers share their existing test, model selection and
save behavior. A successful save finishes this setup step; cancelling a form
returns to the picker. Skipping remains available without adding a provider.
Setup must not maintain an OpenRouter-only credential form.

The built-in default model for OpenAI Codex and GitHub Copilot subscriptions is
`gpt-5.6-sol`. An explicitly stored provider model takes precedence over this
installation default. Model metadata continues to come from the native catalog
when available.


### Subscription configuration completion

The provider editor disables Save while a subscription provider has no stored
OAuth credential. Cancel and the sign-in action remain available. A started or
completed OAuth flow alone does not enable Save: the refreshed provider status
must confirm configured=true. Apply the same rule in setup and Settings. The
configuration API rejects unconfigured OAuth providers before mutating models
or priority, including when the browser submits a stale enabled form.
