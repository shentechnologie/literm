# Hotfix and maintenance releases

**Last updated:** 2026-10-31
**Applies to:** patch releases on the current or an older supported line.

## Decide the dist-tag first

```bash
npm view @literm/terminal-core version          # current latest
npm dist-tag ls @literm/terminal-core
```

| Situation | dist-tag |
|---|---|
| The branch is the newest stable line | `latest` (default) |
| A newer minor is already `latest` | `vX.Y` (for example `v0.2`) |

Never let an older-line patch move `latest` backwards. If `0.3.0` is `latest`
and you patch `0.2`, publish with `--tag v0.2`.

## Patch the newest line

```bash
git checkout release/0.2        # or main if this line has no branch
git pull

bun changeset                   # patch
git add .changeset
git commit -m "fix: ..."
git push
```

Merge the Version Packages PR. The release publishes to `latest`.

If you release from a terminal instead of CI:

```bash
bun changeset version
bun changeset publish
git push --follow-tags
```

## Patch an older line

```bash
git checkout release/0.2
git pull

bun changeset                   # patch
git add .changeset
git commit -m "fix: ..."
git push

bun changeset version
bun changeset publish --tag v0.2
git push --follow-tags
```

Or run `release.yml` from the Actions UI on `release/0.2` with
`dist_tag=v0.2`; merge the Version Packages PR it opens, and it publishes with
that tag.

Verify:

```bash
npm dist-tag ls @literm/terminal-core
# latest: 0.3.0
# v0.2:   0.2.1
```

## Hotfix the previous line while the next is in prerelease

Example: `0.3.0-alpha.2` is on `release/0.3`, and `0.2.x` needs a fix.

```bash
git checkout -b release/0.2 <last 0.2.x tag>
git pull

bun changeset                   # patch
git add .changeset
git commit -m "fix: ..."
git push -u origin release/0.2

bun changeset version
bun changeset publish           # latest: 0.3 is not stable yet
git push --follow-tags
```

Once `0.3.0` is stable, `0.2.x` patches use `--tag v0.2`.

## Cherry-pick the fix to `main`

The release branch is a support line; `main` must also get the fix if it still
applies.

```bash
git checkout main
git cherry-pick <fix-commit>
bun changeset                   # add a changeset for the next main release
```

Do not merge the release branch into `main` just to move a hotfix; cherry-pick
the commit and keep the version history clean.

## Verify

- The intended dist-tag moved and the others did not.
- Both packages published the same version.
- The tarball gate ran (CI or local).
- The fix is present in `main` or explicitly deferred with a reason.
