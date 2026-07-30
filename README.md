# Popy

A self-hosted personal agent platform. Clone it, deploy it on a VPS, and
your personal agent is live — reachable from any browser as a PWA, on
desktop and mobile.

Popy embeds the [pi agent](https://pi.dev) as its engine and builds the
product around it: authentication, conversations with streaming, infinite
memory, its own notes vault, skills, cost tracking and backups.

- **Single user per installation** — by design, permanently.
- **Zero telemetry, no phone-home.** The only outbound traffic is the LLM
  provider calls you configure and an opt-in update check (off by default).
- Multi-provider: OpenRouter, GitHub Copilot, OpenAI, Azure OpenAI and
  OpenAI-compatible endpoints.

## Status

Pre-alpha. The specification is complete (`popy.spec`); implementation is
starting. Not usable yet.

## Documentation

`popy.spec` is the single source of truth for architecture and behavior.

## License

MIT — see `LICENSE`.
