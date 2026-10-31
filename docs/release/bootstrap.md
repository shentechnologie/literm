# Bootstrap a package's first publish

**Last updated:** 2026-10-31
**Applies to:** the first version of a package. One-time per package name.

npm cannot create a package through OIDC, and it forces `latest` onto the first
published version even when `--tag alpha` is passed. Both facts are expected.

## Preconditions

- You are logged in to npm and are an owner/developer of the `@literm` org.
- The `release:verify` gate is green and the working tree is clean.
- The intended stable line is decided. The first alpha is a prerelease of that
  line, not a separate version scheme.

Version selection with Changesets, starting from `0.1.0`:

| Changeset | First prerelease | Eventual stable |
|---|---|---|
| `minor` | `0.2.0-alpha.0` | `0.2.0` |
| `patch` | `0.1.1-alpha.0` | `0.1.1` |

### First alpha of the current version (`0.1.0-alpha.0`)

Changesets cannot turn `0.1.0` into `0.1.0-alpha.0` with a bump. For the first
literm alpha we deliberately use a `0.0.0` base **on the release branch only**,
then apply a `minor` changeset:

```bash
git checkout -b release/0.1 main

node - <<'NODE'
const fs = require('fs');
for (const p of [
  'packages/terminal-core/package.json',
  'packages/react-native-terminal/package.json',
]) {
  const j = JSON.parse(fs.readFileSync(p));
  j.version = '0.0.0';
  if (j.dependencies?.['@literm/terminal-core']) {
    j.dependencies['@literm/terminal-core'] = '^0.0.0';
  }
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}
NODE

cat > .changeset/initial-alpha.md <<'EOF'
---
"@literm/terminal-core": minor
"@literm/react-native-terminal": minor
---

First public alpha of the 0.1 line.
EOF

bun changeset pre enter alpha
bun changeset version
```

Result: `0.1.0-alpha.0` for both packages, with
`@literm/terminal-core: ^0.1.0-alpha.0`; the eventual stable is `0.1.0`.

The `0.0.0` base is bootstrap-only. Never commit it to `main`; it exists only
on `release/0.1` to make the first prerelease version expressible.

For a later line (for example 0.2), do not reset to `0.0.0`; use the normal
`minor` bump from `0.1.0`, which produces `0.2.0-alpha.0`.

## Steps (prerelease bootstrap)

```bash
# on the release branch for the target line
bun changeset                 # describe the release; choose minor or patch
bun changeset pre enter alpha
bun changeset version         # e.g. 0.2.0-alpha.0
bun run release:verify

git add -A
git commit -m "chore(release): cut 0.2.0-alpha.0"

# publish both packages from this machine, with 2FA
bun changeset publish
```

Commit **before** `changeset publish`: the publish command tags the current
commit, so an uncommitted version bump would put the tag on the wrong commit.
For the first 0.1 alpha, use the `0.0.0` base section above instead of the
generic `bun changeset` step.

- The release gate already built both packages; `prepublishOnly` only verifies
  that `lib/` exists. `changeset publish` publishes with the `alpha` dist-tag
  and creates the package tags.
- If you skipped the gate, run `bun run build` before publishing.
- npm will also attach `latest` to this first version because the package did
  not exist. That is unavoidable; the first stable release moves `latest`
  forward.
- This first publish has **no provenance** because it is local. Every later
  publish uses trusted publishing.
- If `changeset publish` publishes both packages concurrently and you want to
  avoid a few seconds where RN resolves before core, publish core first:
  `npm publish` in `packages/terminal-core`, then run
  `bun changeset publish` to publish RN and tag both.

## Verify

```bash
npm view @literm/terminal-core version
npm view @literm/react-native-terminal version
npm dist-tag ls @literm/terminal-core
npm dist-tag ls @literm/react-native-terminal
```

Then install both in a clean directory and run the consumer smoke from
[verify.md](verify.md). First-publish metadata can take a few minutes to appear;
`npm dist-tag ls` is the reliable check.

## After the bootstrap

1. Push the branch and tags: `git push --follow-tags`.
2. Restore the push triggers in `.github/workflows/release.yml` (they are
   dispatch-only during the bootstrap window):

   ```yaml
   on:
     push:
       branches: [main, 'release/**']
     workflow_dispatch:
       inputs:
         dist_tag:
           description: 'npm dist-tag for a maintenance release (blank = latest)'
           required: false
           default: ''
   ```

   Apply the same file to the release branch if it was cut before this restore.
3. Configure trusted publishing for both packages:
   [trusted-publishing.md](trusted-publishing.md).
4. Set the repository variable `ACTIVE_RELEASE=release/X.Y` so `main` cannot
   publish while this line stabilizes.
5. Validate the trust with the next publish within two days.
6. Keep the bootstrap branch; it is the `release/X.Y` line.

## Stable bootstrap

A first stable publish uses the same command without `pre enter`:

```bash
bun changeset
bun changeset version
bun changeset publish
```

This is only used for a new package when no prerelease is wanted. The current
literm plan starts with an alpha, so use the prerelease path.
