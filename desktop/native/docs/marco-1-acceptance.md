# Marco 1 acceptance criteria

The server-connection milestone is complete when:

1. **Configure Server…** opens a native URL and secure-password dialog, never a manager window or webview.
2. The manager accepts a Pop Agent origin with no path, query, fragment, or embedded credentials.
3. Remote origins require HTTPS; HTTP is accepted only for loopback development servers.
4. The login request matches `POST /v1/login`; the password is cleared after the dialog and never persisted or logged.
5. A successful token is stored as a macOS Generic Password under service `com.popagent.desktop-manager` and account equal to the normalized server URL.
6. A legacy token under `com.wails.pop-desktop-manager` is migrated once to the definitive service.
7. `config.json` persists only the normalized URL and existing non-secret settings with mode `0600`.
8. A successful manual connection shows a native **Server connected** confirmation; startup distinguishes Not configured, Authentication required, Connecting, Connected, and Offline directly in the tray.
9. Session probes attach the bearer token, accept sliding renewal from `x-pop-agent-token`, and replace the Keychain value.
10. Invalid credentials and invalid sessions are distinct from network/offline failures.
11. Unit tests cover URL normalization, login success/failure, offline transport, session validation, and renewal.
12. `make gate` and local code-sign verification pass.

Manual check: connect to a real Pop Agent, relaunch without re-entering the password, then stop the server and verify the Offline state.
