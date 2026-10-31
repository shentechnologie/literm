---
name: literm-release
description: "Publish @literm/terminal-core and @literm/react-native-terminal to npm. Use for stable releases, alpha/beta/rc prereleases, release/X.Y branch cuts, hotfixes on older lines, trusted-publishing setup or recovery, dist-tag checks, and release rollback. Not for app store releases (use eas-app-stores) or app dependency upgrades (use the shenterm consume.md doc)."
version: 1.0.0
license: MIT
allowed-tools: "Bash(bun *), Bash(npm *), Bash(git *), Bash(node *)"
---

# literm release

Load `docs/release/README.md` first, then exactly one runbook.

## Pick the runbook

| Task | Runbook |
|---|---|
| First-ever publish of a package | `docs/release/bootstrap.md` |
| Stable release from `main` | `docs/release/stable.md` |
| Cut or advance `release/X.Y` (alpha/beta/rc/stable) | `docs/release/prerelease.md` |
| Patch the current or an older line | `docs/release/hotfix.md` |
| Trust setup, expiry, or publish auth failure | `docs/release/trusted-publishing.md` |
| Bad version, wrong dist-tag, failed publish | `docs/release/rollback.md` |

Every publish runs `docs/release/verify.md` first.

## Non-negotiables

- Run `bun run release:verify`; never publish from a dirty tree.
- `main` never has `.changeset/pre.json`; prereleases live only on
  `release/X.Y`.
- Never merge `main` into `release/**`; cherry-pick fixes.
- Hand a release's changesets to its branch and remove exactly those files from
  `main` at cut time.
- Do not merge `main`'s Version Packages PR while a release branch is active.
- `latest` belongs to the newest stable line; older-line patches use
  `--tag vX.Y`.
- Both packages are a fixed group; they always share a version.
- Trusted publishing only; no long-lived npm token.
- Record versions, dist-tags and native proof in shenterm `STATUS.md`.

## First publish caveat

npm cannot create a package through OIDC. The first version is published
locally with 2FA, and npm forces `latest` onto it even with `--tag alpha`.
Follow `bootstrap.md`.

## Stop

Stop and ask when:

- the artifact gate fails;
- a stable release or native-source change lacks native proof;
- scope/auth fails and the runbook's recovery does not fix it;
- a version would move `latest` backwards;
- `main` and a release branch would publish the same line.

Do not guess a version, dist-tag, or trust configuration.
