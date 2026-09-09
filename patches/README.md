# Dependency patches

## pi 0.84.1 — Codex refusal status

The Codex HTTP adapter replaced refusal bodies with friendly messages and lost
the HTTP status. In particular, a 429 became “You have hit your ChatGPT usage
limit”, which Pop correctly refused to classify from arbitrary prose and thus
never failed over. Preserve the original HTTP status as a prefix before the
friendly message. Pop's existing adapter then emits the typed refusal and its
normal replay-safe fallback policy applies. This also preserves other Codex
HTTP refusals without changing which statuses permit replay.

`tools/codex-failover.test.ts` exercises the installed SDK with mocked HTTP and
feeds its actual output through Pop's translator and failover classifier.
`pi-patch:check` requires this patch after installation. Remove it only when
upstream preserves equivalent refusal evidence.

## pi 0.84.1 — GitHub Copilot login and catalog isolation

The original SDK enables every known model policy during login. The previous
upstream concurrency patch limited simultaneous requests to four, but still
sent the entire policy batch before requesting the catalog. A fresh login in
our test VM still ended with HTTP 429 after the enabling-models progress event.
The endpoint that returned that production error was not captured.

This targeted patch keeps pi's device login and token refresh, removes automatic
policy acceptance for all models, and reads the account's available catalog.
Models requiring policy acceptance must be enabled through GitHub first.
A catalog-only 429, 5xx or timeout does not discard an already valid credential.
Refresh keeps previous model IDs; first login uses the normal offline catalog
fallback when availability is unknown. That fallback does not prove entitlement.
Catalog 401/403, invalid responses, cancellation and token exchange failures
still fail. No catalog retry or rate-limit bypass is added.

postinstall reapplies the patch. pi-patch:check checks its presence and the
Copilot OAuth regression tests exercise the installed SDK with mocked HTTP.
Remove this patch only when an upstream release provides equivalent behavior;
do not remove it solely because it includes the older concurrency fix.
