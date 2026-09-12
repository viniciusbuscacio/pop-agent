# MCP client — modern stateless first, legacy compatible

Pop Agent uses the official TypeScript SDK v2 (`@modelcontextprotocol/client`).
Protocol framing does not live in application code: `McpService` depends on the
`McpClientFactory` port and `OfficialMcpClientFactory` is its infrastructure adapter.

## Era negotiation

For `stdio` and Streamable HTTP, every fresh server configuration uses SDK
`versionNegotiation: { mode: 'auto' }`:

1. probe with `server/discover`;
2. select the stateless 2026-07-28 era when offered;
3. otherwise fall back to the legacy `initialize` handshake.

The verdict is cached in memory for ten minutes, scoped to transport configuration and
a SHA-256 digest of the authorization material. This avoids an extra HTTP request — or
a disposable stdio probe process — on every tool call while still re-probing servers
upgraded in place. A failed cached connection evicts its verdict.

An explicitly configured `sse` server is legacy-only. It exists for old HTTP+SSE
servers; Streamable HTTP is the normal HTTP choice.

The MCP screen records and displays the negotiated era and version. `modern` means
stateless: no `initialize`, no `Mcp-Session-Id`, no GET notification stream. The SDK
adds per-request `_meta`, protocol/method/name headers, handles request-scoped SSE,
modern cancellation, `resultType`, caching rules and `x-mcp-header` validation.

For stdio configuration, the editor treats each Arguments line as one exact
argv item. Spaces inside an argument are preserved; the UI does not imitate a
shell parser or silently discard quoting.

## Lifecycle and capabilities

A connection is short-lived for Test and for one tool call. Closing it is mandatory in
a `finally`; the SDK reaps stdio children and terminates a legacy HTTP session when one
exists. Discovery includes tools, resources, resource templates and prompts. Tool
calls preserve the SDK result at the transport boundary. At the model boundary,
Pop preserves the discovered input JSON Schema, including required fields and
nested constraints. It removes `structuredContent` only when a text block
already contains exactly the same parsed JSON value. Distinct structured data
and non-text blocks remain intact.

An explicit MCP `isError: true` becomes a failed pi tool with the external
content envelope preserved. Ordinary text containing the word "error" is not
classified as a protocol failure.

## Credentials and trust

HTTP credentials are attached through the transport's fetch seam on every request.
stdio receives only the SDK's safe default environment plus the encrypted variables
configured for that MCP server — never the whole Pop Agent process environment. Secret
values are not returned by the API or persisted in capability metadata. The API
exposes only `hasCredential`, accepts an explicit clear operation, omits the
server's internal working directory, and maps connection diagnostics to stable
messages without returning tokens or host paths.

Configuration is strict: stdio requires a command; HTTP transports require an
HTTP(S) endpoint without embedded credentials; custom header names use the HTTP
token grammar and reject hop-by-hop, cookie, host and proxy authorization
headers. Environment names and values are bounded before encrypted storage.

Everything returned by an MCP server remains external, untrusted content under the
existing taint guard. Adopting the SDK changes protocol ownership, not the safety
boundary.

## Contract coverage

Disposable contract servers verify:

- modern stateless HTTP, including per-request metadata and absence of sessions;
- legacy Streamable HTTP fallback through `initialize`;
- modern stdio with fragmented stdout and noisy stderr;
- missing executables as ordinary connection failures;
- capability mapping, auth headers, child cleanup and environment isolation;
- guarded CRUD/test/toggle routes, strict configuration, secret redaction and
  sanitized connection failure responses.
