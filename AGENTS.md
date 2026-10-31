# Agent guide

Navigation only. Release intent lives in `docs/release/`; history lives in the
GitHub releases and shenterm `STATUS.md`. Do not turn this file into a runbook.

## Read first

| Path | Owns |
|---|---|
| [`README.md`](README.md) | Packages, development, release overview |
| [`docs/release/README.md`](docs/release/README.md) | Channels, branch model, index |
| [`docs/release/branch-model.md`](docs/release/branch-model.md) | Which branch a change goes on (version-independent) |
| [`docs/release/verify.md`](docs/release/verify.md) | Pre-release artifact gate |
| [`docs/release/stable.md`](docs/release/stable.md) | Stable release from `main` |
| [`docs/release/prerelease.md`](docs/release/prerelease.md) | `release/X.Y` lifecycle |
| [`docs/release/hotfix.md`](docs/release/hotfix.md) | Maintenance releases |
| [`docs/release/trusted-publishing.md`](docs/release/trusted-publishing.md) | OIDC setup and recovery |
| [`docs/release/support.md`](docs/release/support.md) | Support window and compatibility |
| [`.changeset/config.json`](.changeset/config.json) | Versioning policy |
| [`.github/workflows/`](.github/workflows/) | CI and release automation |
| [shenterm ADR 0004](https://github.com/shentechnologie/shenterm/blob/main/docs/adr/0004-literm-npm-release.md) | Why this model |

## Rules

- Run `bun run release:verify` before every publish. A failing gate blocks the
  release.
- Use `docs/release/branch-model.md` to choose the base branch. A change
  needed for the in-flight stable goes on `release/X.Y`; a change for the next
  line goes on `main`.
- `main` never has `.changeset/pre.json`; prerelease mode lives only on
  `release/X.Y`.
- Never merge `main` into `release/**`; cherry-pick fixes.
- Hand a release's changesets to its branch and remove them from `main` at cut
  time.
- Do not merge `main`'s Version Packages PR while a release branch is active.
- Older-line patches use `--tag vX.Y`; `latest` only for the newest stable line.
- Trusted publishing only. No long-lived npm token.
- Both packages are a fixed group; they always share a version.
- Record evidence in shenterm `STATUS.md`.

## Commands

```bash
bun install --frozen-lockfile
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run build
bun run release:verify
bun run release:status
bun run changeset
```

Release runbooks: [`docs/release/`](docs/release/README.md).
