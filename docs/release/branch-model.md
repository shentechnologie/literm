# Branch model — where does this change go?

**Last updated:** 2026-10-31
**Applies to:** every release line, not a specific version.

This is the permanent rule for choosing a base branch. If a change lands on the
wrong branch, it will not ship in the release you intended.

## Roles

| Branch | Role | Contains |
|---|---|---|
| `main` | Development and integration hub for the **next** line | No `.changeset/pre.json`; changesets for the next release |
| `release/X.Y` | Shipment path for the `X.Y` line | `.changeset/pre.json` and/or patch changesets for that line |
| `feat/<name>`, `fix/<name>`, `chore/<name>` | Short-lived work branch | Cut from the branch that will ship the change |

## Decision table

| Change | Start from | Merge into |
|---|---|---|
| Feature required to ship the in-flight `X.Y.0` | `release/X.Y` | `release/X.Y` |
| Fix required to ship the in-flight `X.Y.0` | `release/X.Y` | `release/X.Y` |
| Feature for the next line | `main` | `main` |
| Fix for a supported stable `X.Y.z` | `release/X.Y` | `release/X.Y` |
| Docs/CI change that affects the current release process | `main` | `main`; cherry-pick to `release/X.Y` if the release needs it now |
| Release version bump | `release/X.Y` | `release/X.Y` (Version PR or direct version commit) |

The deciding question is: **which release must contain this change?**

- If the answer is the line currently stabilizing, branch from `release/X.Y`.
- If the answer is a future line, branch from `main`.

## The first stable is a special moment

A release branch is not "frozen at cut". It is the shipment path for its line.

- **Before `X.Y.0` is stable:** changes still required to ship that first stable
  may go on `release/X.Y`. The line is still being assembled.
- **After `X.Y.0` is stable:** `release/X.Y` accepts fixes and security work
  only. Features go to `main` for the next line.

This is why a feature that is crucial for the final `X.Y.0` belongs on
`release/X.Y`, not `main`, even though `main` is the usual feature hub.

## Immutability

"Immutable" describes the branch's identity, not a freeze on all commits:

- Never delete, force-push or rebase `release/X.Y`.
- `release/X.Y` is kept after `X.Y.0` ships for `X.Y.z` patch support. The only
  branch that may be deleted is the temporary `changeset-release/release/X.Y`
  branch created by the Version Packages PR.
- Content changes only through stabilization fixes, version/changelog commits and
  cherry-picks.
- Never merge `main` into `release/X.Y`. Bring a specific fix over with
  `git cherry-pick <commit>`, or open a PR that targets the release branch.
- Never merge one release branch into another.

## Changesets

- Add the changeset on the branch that will version the change.
- A changeset merged to `main` does not affect an in-flight `release/X.Y`.
- In a prerelease cycle, `minor` and `patch` both keep the current target stable
  version. Use `minor` for a feature and `patch` for a fix; do not use `major`
  accidentally.
- When cutting `release/X.Y`, hand it the changesets that belong to the line and
  remove exactly those files from `main`.

## Release automation

Once the change is merged and a changeset is present, the Release workflow opens
a Version Packages PR. Merging it publishes via OIDC; no local `npm publish`,
OTP, or dist-tag command is needed.

If you want a release with no Version PR, the maintainer may run
`changeset version`, commit the bump and push the release branch; the same
workflow publishes it. That is an operational choice, not a branch-model
exception.

## Common mistakes

| Mistake | Consequence |
|---|---|
| Building a `0.1.0` feature on `main` | It will not be in `0.1.0` unless cherry-picked to `release/0.1` |
| Merging `main` into `release/X.Y` | Brings unrelated next-line changes into the release |
| Adding the changeset on `main` for a release-branch change | The release branch never sees it |
| Adding features to `release/X.Y` after `X.Y.0` | Mixes next-line work into a support branch |
| Force-pushing or deleting `release/X.Y` | Destroys the patch-support line and tag history |

## Related

- [prerelease.md](prerelease.md) — cut, alpha/beta/rc, exit, merge back.
- [hotfix.md](hotfix.md) — patches on the current or an older line.
- [README.md](README.md) — channels and branch overview.
