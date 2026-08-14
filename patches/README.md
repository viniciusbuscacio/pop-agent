# Dependency patches

## pi 0.84.1 — GitHub Copilot policy concurrency

`@earendil-works/pi-ai` 0.84.1 sends one policy update for every known Copilot
model in a single `Promise.all`. With the current 30-model catalog, GitHub
rate-limits the final `/models` request and an otherwise successful device login
ends as HTTP 429.

This patch is the compiled form of upstream commit
[`b3edf017021f802af9b76ab4d95cb555c5427352`](https://github.com/earendil-works/pi/commit/b3edf017021f802af9b76ab4d95cb555c5427352),
which limits policy updates to four concurrent requests. `postinstall` reapplies
it and `npm run pi-patch:check` prevents an unpatched dependency from passing the
gate.

Remove the patch, `patch-package`, the postinstall script and the contract check
when Pop upgrades to a published pi version containing that commit.
