# Pop Agent live UI API

Turn on REST API Server. Signed-in tabs become available automatically; there is no separate tab connection or name form. The single Access key is created automatically. In Server settings, copy Agent instructions to perform owner actions in those tabs. The key includes UI control and remains valid until replaced. Turning off REST API Server or signing out ends UI access.

REST API calls default to localhost only (`127.0.0.1/32`). For a remote integration, add its source IP or CIDR under Server > Allowed IP addresses. Tailscale requests are checked using their real source address.

Use the server HTTPS origin as Base URL, with `Authorization: Bearer <token>` on every request. Never put tokens in URLs.

```text
GET  /v1/integration/ax
GET  /v1/integration/ui/sessions
GET  /v1/integration/ui/state?sessionId=<chosen-id>
POST /v1/integration/ui/press
     {"sessionId":"<chosen-id>","testid":"sidebar-chat"}
POST /v1/integration/ui/press
     {"sessionId":"<chosen-id>","testid":"shell-new-chat"}
POST /v1/integration/ui/input
     {"sessionId":"<chosen-id>","testid":"composer-input","value":"Draft only"}
POST /v1/integration/ui/key
     {"sessionId":"<chosen-id>","key":"Escape"}
GET  /v1/integration/ui/screenshot?sessionId=<chosen-id>
```

Use the testid and, for repeated controls, index from the latest state. POST dblclick takes the same target as press. Empty value clears a text field. These operations run in the selected real UI, including its current chat, model, permissions and local-machine selection. Application keyboard handlers work; native browser shortcuts, file pickers and system dialogs require human interaction. Read pendingRequests before assuming an asynchronous action completed. No automatic mutation retries or idempotent replay are provided.

The settings screen has no separate screenshot or sharing controls. The existing screenshot transport returns `screen_not_shared` without an active capture source. Enabling REST API Server cannot bypass browser display-capture restrictions; automatic screenshot capture requires a separate browser integration. Do not assume a screenshot is available from UI connectivity alone.

A timeout disconnects the bridge and returns `ui_timeout`; an action might already have run. The app reconnects automatically while the API is enabled, but commands are never replayed. Inspect the resulting state before repeating a mutation. Unknown, disabled or ambiguous targets return structured errors. Replacing the key or disabling REST Server prevents further commands. Owner-session automation can use `/v1/ax` and `/v1/ui/*` instead, using its owner bearer.
