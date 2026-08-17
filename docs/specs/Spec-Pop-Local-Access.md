# Pop Agent — Pop Local Access

**Status:** current architecture explanation
**Normative source:** `pop-agent.spec` §§5, 10, 14 and 17
**Primary code:** `server/src/application/local-access`, `server/src/interface/http/local-tools-routes.ts`, `cli/src`, `local-access/tray`
**Related:** [`../cli.md`](../cli.md)

## Product boundary

Pop Local Access (PLA) lets the server-side agent use tools on a selected user computer. It is not a local agent: providers, prompts, pi sessions, memory, safety and accounting remain on the server.

The optional native tray makes a persistent local capability visible and supervises the TypeScript PLA runtime. It does not contain a WebView or a second Pop Agent interface.

## Channels

```text
PWA ── HTTP/SSE ── server ── WS or HTTP polling ── PLA runtime
                                               └── tray supervision
```

- HTTP changes policy and obtains machine snapshots.
- SSE invalidates PWA machine state.
- The PLA channel attaches a computer and carries calls/results.

## Identity and selection

A machine has a stable `machineId`; each connection has a temporary connection ID. PWA selection persists the stable machine ID. The server resolves it to a currently active transport for every request.

When more than one connection exists for a machine, the background/tray connection is preferred over an interactive CLI connection. UI lists machines, not duplicate transports.

If a selected machine is unavailable or disabled, sending must fail clearly. Never fall back silently to the server or another computer.

## Permission

Known-machine permission is persisted server-side and defaults to disabled. Settings can enable or disable **Allow access to local files** for each machine. The registry publishes policy to active transports and cancels calls when access is disabled.

A live transport alone is not authority. Resolution checks both current connection and policy.

## Tools

The model receives separate prefixed tools such as `local_read`, `local_write`, `local_edit` and `local_bash` only when the message has valid local routing. Plain tools continue to mean the Pop Agent server.

The tool catalogue attached to the turn is authoritative. Code and prompts must not infer local availability from the PWA environment.

## Connection lifecycle

Attach reports machine ID, hostname, platform, architecture, cwd and client version. Heartbeats detect dead transports. Disconnect, expiry, revocation or access disable settles pending calls and emits `local-machines-changed` so PWAs refresh state.

WebSocket is preferred; the long-poll transport preserves environments where WebSocket is unavailable. Protocol frames are bounded and duplicate polling events are rejected.

## Safety

Local tools have the privileges of the local user and are not a sandbox. Taint and Plan Mode apply across server and local operations. Tokens and passwords must not appear in script URLs, argv, environment or logs. The client validates authorization and limits rather than trusting arbitrary server payloads blindly.

## Tray responsibilities

- visible connection state;
- open the Pop Agent PWA;
- pause/reconnect/quit controls;
- user-scope start at login;
- supervision of the PLA runtime;
- actionable diagnosis.

The tray must not recreate native Desktop product UI.

## Change checklist

Test stable-ID reconnection, tray restart with a new connection ID, interactive plus background transports, explicit machine selection, disabled/offline behavior, `/queue` and normal sends, stop/cancel, heartbeat expiry, session revocation, PWA invalidation and Windows/macOS packaging.
