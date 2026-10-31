# Prerelease lifecycle (`release/X.Y`)

**Last updated:** 2026-10-31
**Applies to:** every minor line that needs alpha/beta/rc stabilization.

Prerelease mode is per branch. `main` stays stable; the release branch owns
`.changeset/pre.json` and publishes the prereleases.

## 1. Cut the branch

Do this when `main` contains the changesets for the line and is ready to
stabilize.

```bash
git checkout main
git pull
git checkout -b release/0.2
git push -u origin release/0.2
```

Then, on `main`, remove exactly the changesets the branch inherited:

```bash
git checkout main
git rm .changeset/<the-0.2-changesets>.md
git commit -m "chore: hand 0.2 changesets to release/0.2"
git push
```

`main` may keep changesets intended for the next line. Do not delete those.

## 2. Enter alpha

```bash
# on release/0.2
bun changeset pre enter alpha
git add .changeset/pre.json
git commit -m "chore: enter alpha prerelease"
git push
```

The release workflow opens a Version Packages PR against `release/0.2`. Merge it
to publish `0.2.0-alpha.0` with the `alpha` dist-tag.

If this is the package's **first ever publish**, follow
[bootstrap.md](bootstrap.md) instead of letting CI publish; OIDC cannot create a
package.

## 3. Iterate

Merge normal changesets into the release branch. Each merge that changes a
package causes a Version Packages PR; merging it publishes `alpha.1`, `alpha.2`,
and so on.

Rules:

- Every prerelease needs at least one pending changeset.
- Consumed changesets move to `.changeset/pre/` and feed the eventual stable
  changelog. Delete prerelease-only entries there if they should not appear in
  the stable notes.
- Do not merge `main` into the release branch. Cherry-pick specific fixes.

## 4. Promote alpha → beta → rc

Edit the tag in `.changeset/pre.json` directly:

```json
{
  "tag": "beta"
}
```

Then add at least one pending changeset and push:

```bash
bun changeset
git add .changeset/pre.json .changeset/*.md
git commit -m "chore: switch prerelease channel to beta"
git push
```

The next Version Packages PR publishes `0.2.0-beta.N` with the `beta` tag.
Repeat for `rc`.

The trailing counter is monotonic across the whole prerelease cycle
(`alpha.2` → `beta.3` → `rc.4`). That is expected. Never move backwards
(beta → alpha); semver treats it as a downgrade.

## 5. Exit to stable

```bash
# on release/0.2
bun changeset pre exit
git add .changeset/pre.json
git commit -m "chore: exit prerelease mode for 0.2.0"
git push
```

The next Version Packages PR removes the prerelease suffix, publishes `0.2.0`
to `latest`, and deletes `pre.json` when versioned. Run the native proof from
[verify.md](verify.md) before merging that PR.

## 6. Merge back to `main`

Immediately after the stable publish:

```bash
git checkout main
git merge release/0.2
# resolve package.json / CHANGELOG conflicts in favor of the released version
git push
```

This brings the version bump and changelogs back to `main`. Do not merge before
the stable publish, and do not bring the release branch's `pre.json` along; it
is already removed.

## 7. Keep `main` gated

While `release/0.2` is active, set the repository variable
`ACTIVE_RELEASE=release/0.2`. The release workflow skips the `main` job while it
is set, so `main` cannot publish the next line mid-stabilization. Clear the
variable after `release/0.2` has shipped stable and been merged back.

## Branch protection

Apply a GitHub ruleset to `release/**`:

- block force pushes and deletion;
- require a pull request and the CI job;
- allow only the maintainer to merge.

## Hotfixes during prerelease

If the previous stable line needs a fix while this branch is in prerelease, use
[hotfix.md](hotfix.md). Do not exit prerelease mode to ship an unrelated patch.
