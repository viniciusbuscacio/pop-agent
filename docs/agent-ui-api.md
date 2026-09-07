# Pop Agent live UI API

Open Agent > REST API > Edit Server > UI access, name the tab and click **Connect this tab**. Create a dedicated integration token with **ui:control**. This permission can perform owner actions in the connected tab. Stop UI disconnects it on any page.

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

For screenshots, click **Share screen for screenshots** in that browser, then choose the intended surface in its native sharing picker. The API returns `image/png`; without sharing it returns `screen_not_shared`. Mobile browsers may not offer display capture. Screenshots can show all visible content on the chosen surface. They are never stored by Pop.

A timeout disconnects the bridge and returns `ui_timeout`; an action might already have run. Inspect the tab before reconnecting and repeating it. Unknown, disabled or ambiguous targets return structured errors. Revoking the token or disabling REST Server prevents further commands. Owner-session automation can use `/v1/ax` and `/v1/ui/*` instead, using its owner bearer.
