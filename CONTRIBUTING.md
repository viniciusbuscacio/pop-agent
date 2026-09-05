# Contributing to Pop Agent

Thank you for helping improve Pop Agent. The project is pre-1.0, single-user by
design, and intentionally strict about security, architecture, and unasked
network activity.

By participating, you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Search existing issues and pull requests before proposing duplicate work.
- Use an issue for a reproducible bug. Use GitHub Discussions for questions,
  early ideas, and proposals that still need scope; open a focused feature
  issue once the expected behavior is concrete.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md), not
  in an issue or discussion.
- Keep a change narrow. Discuss broad product, protocol, security, or
  architecture changes before implementing them.

The normative product specification starts at
[`docs/specs/Spec-Pop-General.md`](docs/specs/Spec-Pop-General.md). Read the
focused specification for the subsystem you plan to change, then inspect the
current code and tests. Implementation behavior and normative requirements are
both relevant; do not silently choose between them if they differ.

## Development setup

You need:

- Node.js `>=22.19.0` and npm;
- Go `>=1.23` for launcher and tray checks;
- Git; and
- native build prerequisites used by locked npm dependencies.

```sh
git clone https://github.com/viniciusbuscacio/pop-agent.git
cd pop-agent
npm ci
npm run build
dev_root=$(mktemp -d)
POP_AGENT_DATA_DIR="$dev_root/data" \
  POP_AGENT_WORKSPACE="$dev_root/workspace" \
  npm run dev
```

For a private checkout, follow the [GitHub authentication steps](deploy/README.md#private-repositories) before cloning.

The root development command watches the server. To rebuild the PWA on changes,
run this in another terminal:

```sh
npm run dev -w @pop-agent/web
```

The example uses a throwaway data root; remove it when finished. Never use
production data, credentials, or recovery material in tests or bug
reproductions.

## Project boundaries

- The backend follows clean architecture: `domain`, `application`,
  `infrastructure`, and `interface`, with `server/src/main.ts` as composition
  root.
- Wire DTOs live in `shared/`; domain objects do not cross the HTTP boundary.
- React components do not call `fetch`; browser integration belongs in
  `web/src/services/`.
- There is no telemetry. Do not add analytics or unrelated network calls.
- Keep code, comments, tests, UI text, documentation, and commits in English.
- Do not add secrets to environment examples. Runtime provider secrets belong in
  Pop Agent's encrypted storage.
- UI changes must preserve the permanent interaction rules in `AGENTS.md` and
  the style specification.

## Tests and documentation

Add or update focused tests for behavior changes. Before submitting, run:

```sh
env -u NODE_ENV npm run gate
```

Run tests without an inherited `NODE_ENV=production`. Production React builds
do not expose the testing APIs used by the suite. This changes only the test
subprocess environment, not the running service configuration.

The gate covers version/specification checks, lint, TypeScript, Go checks,
builds, tests, and the smoke flow. If a platform-specific check cannot be run,
state exactly what was not run and why in the pull request.

Update the relevant normative specification only when a public product
requirement changes. Update `CHANGELOG.md` for user-visible product changes.
Avoid mixing generated output, formatting churn, or unrelated cleanup into the
same pull request.

## Commits and pull requests

Use a short conventional commit subject such as `fix(server): ...`,
`feat(web): ...`, or `docs: ...`. A pull request should:

- explain the problem and the chosen solution;
- identify user-visible, security, compatibility, and migration effects;
- link related issues;
- list validation performed;
- include screenshots or recordings for visible UI changes; and
- leave the branch free of credentials, private data, generated gate receipts,
  and unrelated changes.

Maintainers may ask for scope reduction, additional tests, specification updates,
or security hardening before merging.
