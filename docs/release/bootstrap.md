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

There is no Changesets-native way to produce `0.1.0-alpha.0` from `0.1.0`
without manually resetting versions. Do not invent one during bootstrap; pick
the target stable line and use the matching bump.

## Steps (prerelease bootstrap)

```bash
# on the release branch for the target line
bun run release:verify

bun changeset                 # describe the release; choose minor or patch
bun changeset pre enter alpha
bun changeset version         # e.g. 0.2.0-alpha.0

# publish both packages from this machine, with 2FA
bun changeset publish
```

- `changeset publish` builds through `prepublishOnly`, publishes with the
  `alpha` dist-tag, and creates the package tags.
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
