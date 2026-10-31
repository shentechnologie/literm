# Release operations

**Last updated:** 2026-10-31
**Owner:** cyveros (solo maintainer)
**Packages:** `@literm/terminal-core`, `@literm/react-native-terminal`

How literm goes from a commit to npm. The decision record is
[ADR 0004](https://github.com/shentechnologie/shenterm/blob/main/docs/adr/0004-literm-npm-release.md);
the app-side upgrade procedure is
[consume.md](https://github.com/shentechnologie/shenterm/blob/main/docs/release/consume.md).

## Channels

| Channel | Version shape | npm dist-tag | Install |
|---|---|---|---|
| Alpha | `0.2.0-alpha.N` | `alpha` | `npm i @literm/terminal-core@alpha` |
| Beta | `0.2.0-beta.N` | `beta` | `npm i @literm/terminal-core@beta` |
| Release candidate | `0.2.0-rc.N` | `rc` | `npm i @literm/terminal-core@rc` |
| Stable | `0.2.0` | `latest` | `npm i @literm/terminal-core` |
| Older line | `0.1.1` | `v0.1` | `npm i @literm/terminal-core@v0.1` |

The two packages are a **fixed Changesets group**: they always share a version.
`@literm/terminal-core` is a regular dependency of
`@literm/react-native-terminal`; do not turn it back into a peer dependency
(that forces a `1.0.0-alpha` bump at the first core prerelease).

## Branches

```text
main:         0.3 development ────────────────● merge 0.2.0 back ──► 0.3.0
                \                            /
release/0.2:     ● cut ── alpha ── beta ── rc ── 0.2.0 ── 0.2.1 (tag v0.2)
release/0.1:     ● cut from the 0.1.0 tag ── 0.1.1 (latest until 0.2.0 ships)
```

- `main` is the development and integration hub. It carries **no**
  `.changeset/pre.json` and publishes stable only.
- `release/X.Y` is cut once per minor line for stabilization, prereleases and
  patch support. It owns `.changeset/pre.json`.
- **Immutable** means the branch is never deleted, force-pushed or rebased.
  Content changes only through stabilization fixes, version/changelog commits
  and cherry-picks. Never merge `main` into a release branch.

## GitHub settings (one-time)

- **Settings → Actions → General → Workflow permissions → Allow GitHub Actions
  to create and approve pull requests.** `changesets/action` opens the Version
  Packages PR; without this it fails with `GitHub Actions is not permitted to
  create or approve pull requests`.
- If the checkbox is disabled, the organization must allow it first under
  **Organization Settings → Actions → General → Workflow permissions**.
- Set the repository variable `ACTIVE_RELEASE=release/X.Y` while a release
  branch is stabilizing a line, and clear it after the stable release is merged
  back.

### Version Packages PR author

`changesets/action` uses `GITHUB_TOKEN`, so the PR author is
`github-actions[bot]`. GitHub may mark that PR's CI run `action_required` until
a maintainer approves it.

Three options:

1. **Approve the run** (one click). This is the least-privilege default. The
   gate may disappear after the bot's first merged PR.
2. **Use a fine-grained PAT.** Create one scoped to this repository with
   `Contents: Read and write` and `Pull requests: Read and write`, add it as the
   `RELEASE_TOKEN` Actions secret, and the workflow will use it automatically.
   The Version Packages PR is then authored by that user and CI runs normally.
   Give it a short expiry and rotate it; it is a long-lived credential.
3. **Version locally.** Run `bun changeset version`, commit, push a branch and
   open the PR yourself. No secret, but manual.

## Rules

1. Run `bun run release:verify` before every publish. A failing gate blocks the
   release.
2. When cutting `release/X.Y`, hand the inherited changesets to the branch and
   remove exactly those files from `main`.
3. Do not merge `main`'s Version Packages PR while a release branch is active.
4. Only the newest stable line publishes to `latest`. Older-line patches use
   `--tag vX.Y`.
5. `main` never contains `.changeset/pre.json`.
6. Never publish from a dirty tree, and never store an npm token in the repo.
7. Record the release evidence (versions, dist-tags, native proof) in
   [shenterm `STATUS.md`](https://github.com/shentechnologie/shenterm/blob/main/STATUS.md).

## Index

| Doc | Owns |
|---|---|
| [verify.md](verify.md) | Pre-release artifact gate and native proof |
| [bootstrap.md](bootstrap.md) | First publish of a package (one-time per package) |
| [first-alpha-0.1.0.md](first-alpha-0.1.0.md) | One-time runbook for the first 0.1 alpha; delete after 0.1.0 is stable |
| [0.1.0-release-checklist.md](0.1.0-release-checklist.md) | Current state: alpha.1 → beta → rc → stable → app migration |
| [stable.md](stable.md) | Stable release from `main` |
| [prerelease.md](prerelease.md) | `release/X.Y` cut, alpha/beta/rc, exit, merge-back |
| [hotfix.md](hotfix.md) | Patch the current or an older supported line |
| [trusted-publishing.md](trusted-publishing.md) | OIDC setup, expiry, recovery, hardening |
| [support.md](support.md) | Support window, compatibility, deprecation, unpublish |
| [rollback.md](rollback.md) | Bad version, wrong dist-tag, failed publish |

Agent entry point:
[`.agents/skills/literm-release/SKILL.md`](../../.agents/skills/literm-release/SKILL.md).

## First publish

npm cannot create a package through OIDC, so the first version of each package
must be published by a human-authenticated command. For a brand-new package npm
also forces `latest` to the first published version, even when `--tag alpha` is
used. See [bootstrap.md](bootstrap.md).

## Support

The newest minor gets full support; the previous minor gets critical and
security fixes; older lines are unsupported. See [support.md](support.md).
