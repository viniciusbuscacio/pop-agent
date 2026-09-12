# Windows PLA setup using the family installer

Owner-approved scope (2026-09-11): replace the update-only MessageBox entry point with a Wails wizard using `go-installer/windows` and the go-calc family visual language. Support a fresh machine and existing PLA installations without terminal instructions.

## Boundaries

- Separate installer-only Wails executable; the tray remains the existing small Go program and the application remains a PWA.
- Pin go-installer v0.4.0 and Wails v2.12.0. Embed this build's Windows tray and launcher, verify their manifest before use.
- Keep the existing per-user PLA/launcher locations for compatibility. Register the setup manager through go-installer; shortcuts launch the tray, not the setup window.
- Preserve shared CLI profiles, machine identity, access permission and existing startup preference. New installations remain disabled until explicit owner permission in Pop/PLA.
- Connect through a visible, confirmed HTTPS origin (loopback only for development). No password/token in argv, environment, URLs, logs or returned UI state; no redirects for login.
- Download/prepare managed Node and CLI through the existing checksummed launcher, with progress in the wizard and child windows hidden.
- Uninstall only PLA's dedicated installation and shortcuts/startup entry. Shared CLI profiles/runtime and server data are not PLA-owned and must survive.
- No change to macOS setup. No publication or live Windows replacement until validation and owner acceptance.

## Work

1. Add the installer module, state/validation, secure connection/profile handling, platform adapters and go-installer integration.
2. Adapt the family wizard (light/dark, welcome/license/server/destination/progress/finish, Cancel, keyboard accessibility).
3. Replace Windows release packaging's renamed-tray copy with the distinct checksummed setup; update docs and tests.
4. Validate unit tests, cross-build, mocked browser flow, and the actual Windows Wails preview. Test destructive installation paths only with isolated fixtures, not the owner's current PLA.
5. Run the exact-tree gate, record artifacts and leave an unpublished local commit for owner review.
