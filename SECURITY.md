# Security Policy

Pop Agent is a pre-1.0, self-hosted application that handles private content and
provider credentials. Security reports are welcome and should be handled
privately.

## Supported versions

Security fixes are made for the latest tagged release when practical. Older
releases and arbitrary development snapshots are not supported. Because the
project is pre-1.0, a fix may require upgrading to a release with compatibility
changes.

## Report a vulnerability privately

Use GitHub's **private vulnerability reporting** for this repository:

<https://github.com/viniciusbuscacio/pop-agent/security/advisories/new>

Public launch is blocked until the maintainer enables that form and verifies it
from an account without repository access. If GitHub temporarily makes the form
unavailable, retry later; do not open a public issue, pull request, or discussion
to disclose the vulnerability or request a private channel.

Include, when available:

- the affected version or commit;
- the component and deployment shape involved;
- clear reproduction steps or a minimal proof of concept;
- the impact and any required attacker access;
- relevant logs with credentials and private content removed; and
- any suggested remediation.

Please allow time to reproduce and address the report before disclosure. The
maintainer will coordinate disclosure with the reporter after the impact and a
fix are understood. No response or remediation deadline is guaranteed.

## Keep secrets out of public reports

Never include passwords, recovery keys, session or bearer tokens, provider or
OAuth credentials, private keys, database contents, private conversations,
files, unredacted logs, private hostnames, or exploitable proof-of-concept
details in an issue, pull request, discussion, or commit.

If a secret was exposed, revoke or rotate it immediately; editing a GitHub
comment or commit does not reliably remove it from history. Use synthetic test
data in reports.

For the implemented security boundaries and threat model, see
[the security specification](docs/specs/Spec-Pop-Security.md).
