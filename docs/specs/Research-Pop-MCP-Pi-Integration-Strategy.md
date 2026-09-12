# Pop Agent — MCP integration strategy relative to pi extensions

**Status:** research draft — non-normative
**Implementation authorization:** none; this document records analysis and does not authorize implementation
**Current normative sources:** [`Spec-Pop-Skills-and-Tools.md`](Spec-Pop-Skills-and-Tools.md) and [`Spec-Pop-Pi-Agent-Integration.md`](Spec-Pop-Pi-Agent-Integration.md)
**Current implementation detail:** [`../mcp.md`](../mcp.md)

## Question

Should Pop Agent replace its native MCP integration with a pi extension or pi
package that provides MCP support?

## Current architecture

Pi intentionally does not provide built-in MCP. It allows an extension to add
MCP, but an extension is an integration mechanism rather than an MCP protocol
implementation.

Pop Agent currently uses two supported SDK boundaries:

1. the official TypeScript MCP client, `@modelcontextprotocol/client`, behind
   the application-owned `McpClientFactory` port, for protocol negotiation,
   transports, discovery, calls, cancellation and cleanup;
2. pi SDK custom tools, constructed per session, to project enabled MCP tools
   into the model's active catalogue.

Product state remains outside pi. SQLite owns server configuration, discovered
capabilities and status; Pop's encrypted secret store owns credentials; the PWA
and HTTP API own configuration and observability. Session-context revisioning
refreshes the projected catalogue when relevant MCP state changes.

Pop already uses a Pop-owned inline pi extension for the security guard because
that behavior requires pi's `tool_call` and `tool_result` event hooks. MCP tool
projection itself does not require those hooks.

## Options

### A. Keep the current native product integration

Pop continues to own configuration, persistence, authorization and tool
projection, while the official MCP SDK owns protocol mechanics and pi receives
the resulting definitions as custom tools.

Advantages:

- preserves clean-architecture boundaries and application-owned ports;
- keeps product configuration and credentials in Pop-owned storage;
- supports per-session catalogue revisioning and deterministic Plan Mode;
- avoids hand-written MCP framing while retaining protocol-level testability;
- keeps MCP lifecycle and failure isolation aligned with server operation;
- avoids a second package/update/configuration channel.

Costs:

- Pop must maintain its adapter, capability mapping, UI and tests;
- new MCP SDK capabilities require deliberate product integration;
- the integration is not directly reusable by a standalone pi installation.

### B. Install a third-party pi MCP extension or package

Advantages:

- may reduce initial integration effort;
- can be reused directly by standalone pi users;
- may expose pi-specific commands or terminal UI without Pop-specific work;
- delegates some adapter maintenance to the package maintainer.

Disadvantages:

- pi extensions execute arbitrary code with the server process's authority;
- configuration, credentials and updates may bypass Pop-owned storage and
  policy;
- terminal-oriented lifecycle and UI are not the PWA/server product boundary;
- Plan Mode, taint handling, cancellation, status persistence and session
  revisioning may be incomplete or duplicated;
- extension and pi updates create an additional compatibility surface;
- a third-party extension still needs a conforming MCP implementation, ideally
  the same official MCP SDK, so it does not eliminate protocol dependencies;
- failures or dependency drift become less directly diagnosable by Pop.

### C. Wrap Pop's current integration in a Pop-owned inline pi extension

This would register the same MCP tools through `pi.registerTool()` instead of
supplying them as custom tools.

Potential advantage:

- all pi-facing registration could use one extension API style if future MCP
  behavior requires pi lifecycle events.

Current disadvantages:

- adds indirection without changing protocol ownership or product behavior;
- risks coupling application services to pi extension lifecycle;
- makes per-session construction and testing less direct;
- provides no current capability unavailable through custom tools.

## Security and authorization

Any accepted design must preserve these boundaries:

- only enabled servers and persisted discovered tools enter the active
  catalogue;
- secrets remain encrypted and are never projected into tool metadata;
- stdio children receive only the SDK safe environment plus that server's
  configured variables, not the Pop process environment;
- MCP output and errors remain external untrusted content;
- Plan Mode admits only tools whose standard `annotations.readOnlyHint` is
  exactly `true`; missing annotations fail closed;
- cancellation and timeout signals propagate to MCP calls;
- one MCP server's failure remains isolated from other servers and the chat;
- user-installed or host-global pi extensions must not be auto-discovered by
  the Pop server.

A third-party extension cannot be treated as sandboxed merely because pi loads
it as an extension. Admission would require source review, version pinning,
dependency review and explicit mapping of its behavior to every boundary above.

## Auditing and observability

The current product-owned path permits Pop to record safe operational state:
connection status, negotiated protocol era/version, last connection time and a
sanitized last error. Secret values and raw authorization material must never
enter logs, capability metadata or API responses.

Before adopting an extension, Pop would need equivalent tests and observable
failure states for transport negotiation, capability discovery, call timeout,
cancellation, process cleanup, environment isolation and authorization. An
extension's own logs or terminal notifications are not a substitute for the
Pop API and PWA state model.

## Scope

This analysis covers MCP client integration used to expose remote tools to Pop
Agent through pi. It does not propose:

- enabling arbitrary pi extension discovery;
- changing MCP server support or transport compatibility;
- moving product state from SQLite into pi settings;
- replacing the official MCP SDK;
- changing the PWA MCP management experience.

## Recommendation

Keep option A as the default architecture. A pi MCP extension is useful for
standalone pi, but Pop Agent treats MCP as a native product capability with
security, persistence and UI obligations beyond tool registration.

Use a Pop-owned inline pi extension only when a concrete requirement needs pi
extension events that custom tools cannot provide. Evaluate a third-party MCP
extension only if it provides a material, testable capability that would be
costly to reproduce while preserving all Pop-owned policy boundaries.

## Possible evaluation and rollout phases

This draft does not authorize these phases; they describe how a future proposal
could be evaluated safely.

1. **Capability comparison:** identify a missing concrete capability and compare
   it with the official SDK and current adapter.
2. **Isolated proof:** load a pinned candidate only in tests with host extension
   discovery disabled and no production credentials.
3. **Boundary verification:** prove Plan Mode, taint, secrets, cancellation,
   environment isolation, lifecycle cleanup and catalogue freshness.
4. **Operational comparison:** compare API/PWA observability, upgrade behavior,
   failure isolation and support burden against the current implementation.
5. **Explicit normative decision:** update the relevant normative specification
   only after review; implementation would require its own authorized change.

## Unresolved decisions

- What missing capability, if any, would justify replacing the current adapter?
- Would a candidate extension expose a stable programmatic API independent of
  pi's terminal UI?
- Can its dependency and release policy be pinned to Pop's update guarantees?
- Would reuse be better achieved by importing a library beneath
  `McpClientFactory` rather than loading a full pi extension?
- Which additional audit records, if any, should MCP calls persist without
  retaining sensitive arguments or outputs?
