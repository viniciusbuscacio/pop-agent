# Pop Agent — pi agent integration

**Status:** current architecture explanation
**Normative source:** `pop-agent.spec` §§5, 7, 8, 10 and 15
**Primary code:** `server/src/infrastructure/agent`, `server/src/application/chat`
**Deep dive:** [`../agent-flow.md`](../agent-flow.md)

## Boundary

pi is the in-process agent engine. Pop Agent owns the product around it: authentication, chats, product persistence, memory, skills, safety, providers, usage, PWA and CLI.

The application reaches pi through an application-owned bridge port. pi types and implementation details stay in the infrastructure adapter. The frontend and CLI never import or talk directly to the pi SDK.

## State ownership

- pi JSONL sessions are execution state: branch, model context, compaction and tool history.
- SQLite is product state: chats, rendered messages, titles, search, queues and usage.
- Duplication of visible messages is intentional; Pop does not parse pi JSONL to render the UI.
- `chats.pi_session_id` links a product chat to its pi session.

## Run path

```text
HTTP message request
  → application run orchestration
  → persist user input / queue decision
  → build instructions, skills and tool set
  → AgentBridge / pi session
  → map pi events to application events
  → persist assistant result
  → publish StreamEvent over SSE
```

See `docs/agent-flow.md` for queue, steering, stream and reconciliation detail.

## Session lifecycle

Sessions are opened or created under `POP_AGENT_DATA_DIR/sessions/` and cached by chat. Idle sessions unload from memory and reopen from their pi-owned path. Pop changes sessions through public pi APIs; native session commands such as compact, export and fork are product commands rather than prompts to the model.

## Instructions and context

The bridge assembles Pop Agent's neutral identity, custom instructions, pinned built-in knowledge and per-turn selected skills. Context from Files, memory, notes, web or MCP remains external content and must retain its trust envelope.

## Tools

Server tools and custom Pop tools are registered with pi. Local tools are separate prefixed tools backed by a selected PLA connection. Tool availability is computed per message; Plan Mode supplies a fail-closed read-only set through pi's active-tool API.

Do not create a second agent loop in the CLI or web client. Providers, safety, sessions and accounting remain centralized.

## Providers and models

Provider configuration and model choice belong to Pop application services. The bridge receives the resolved provider/model for a run. Secrets stay server-side and encrypted at rest. Provider fallback and service-model work are accounted separately from the visible chat run where required.

## Events and persistence

The adapter maps pi SDK events to stable application events. The application assembles durable messages and the interface maps them to shared DTOs. Frequent fragments carry run identity and sequence so clients can reconcile after a snapshot or reconnect.

## Cancellation and failure

Stop aborts the pi session and its tool work. A terminal outcome is persisted and emitted. Provider errors become stable product error codes; they do not trigger uncontrolled retry loops. Interrupted server runs are reconciled into readable product history.

## Change checklist

When changing pi integration, inspect:

- SDK public types and pinned package version;
- bridge contract and adapter mapping;
- session wake/reopen behavior;
- tool selection and Plan Mode;
- safety taint propagation;
- usage accounting;
- persisted message reconstruction;
- SSE/CLI/PWA reconciliation tests;
- pi patch checks and the full gate.
