# Stable release from `main`

**Last updated:** 2026-10-31
**Applies to:** the normal stable release when no release branch is stabilizing
that version. If the version has a `release/X.Y` branch, use
[prerelease.md](prerelease.md) instead.

## Preconditions

- `main` is clean and up to date.
- `.changeset/pre.json` does not exist on `main`
  (`git show main:.changeset/pre.json` must fail).
- No other release branch is waiting to merge back.
- The release gate is green.

```bash
bun install --frozen-lockfile
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run release:verify
```

## Steps

```bash
bun changeset                    # describe the release; choose the bump
git add .changeset
git commit -m "feat: ..."        # or the normal PR
git push
```

CI opens or updates the **Version Packages** PR. Before merging:

1. Confirm the PR version is the intended stable version.
2. Confirm the changelog contains the changesets you expect.
3. Re-run the release gate on the PR if it is stale.
4. Run the native proof if the native module, vendored sources or podspec/gradle
   changed.

Merge the PR. The release workflow publishes to `latest`, creates tags, and
creates the GitHub releases.

## Verify

```bash
npm dist-tag ls @literm/terminal-core
npm dist-tag ls @literm/react-native-terminal
npm view @literm/terminal-core version
npm view @literm/react-native-terminal version
```

- `latest` points at the new stable version.
- `alpha` / `beta` / `rc` still point at the last prereleases, if any.
- Both packages have the same version.
- A clean install of both packages works.

## If a release branch is active

Leave `main`'s Version Packages PR unmerged until the active `release/X.Y` has
shipped stable and been merged back. Merging it early can publish the next
stable before the stabilization line finishes.

## After the release

- Record versions, dist-tags and native proof in shenterm `STATUS.md`.
- Move any shipped tickets to `done/`.
- If this was the first stable after a prerelease cycle, confirm `latest`
  moved off the prerelease.
- Keep the release branch (if any) for patch support.
