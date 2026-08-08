# Pop Agent

A self-hosted personal agent platform. Clone it, deploy it on a VPS, and
your personal agent is live — reachable from any browser as a PWA, on
desktop and mobile.

Pop Agent embeds the [pi agent](https://pi.dev) as its engine and builds the
product around it:

- **Chat** over HTTP + SSE — streaming, attachments, voice notes, image
  input, cost tracking per run.
- **Infinite memory** — search over every past conversation, and a living
  document the agent keeps about you.
- **Files** — a plain folder you and the agent share, rendered as a tab in
  the app, with signed download links and a restorable trash.
- **Notes**, **skills** picked per turn by a local router, **scheduled
  tasks**, backups, Web Push, passkeys.
- **A terminal client** — `pop` chats from any machine and lends the
  agent local hands there; `popman` operates the service on the server.

Principles:

- **Single user per installation** — by design, permanently.
- **Zero telemetry, no phone-home.** The only outbound traffic is the LLM
  provider calls you configure and an opt-in update check (off by default).
- Multi-provider: OpenRouter, GitHub Copilot, OpenAI, Azure OpenAI and
  OpenAI-compatible endpoints.

## Status

In active development, running daily for its maintainer. Pre-1.0: things
still move without compatibility promises.

## Documentation

`pop-agent.spec` is the single source of truth for architecture and behavior;
`CHANGELOG.md` tracks what shipped. Design deep-dives live in `docs/`.

## License

MIT — see `LICENSE`.
