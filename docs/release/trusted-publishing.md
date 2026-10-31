# Trusted publishing (OIDC)

**Last updated:** 2026-10-31
**Applies to:** every publish after the package exists. No long-lived npm token
belongs in this repository.

## Requirements

- npm CLI **11.5.1 or newer** (Node 24.x is the safe CI baseline; Node 20 ships
  npm 10 and fails OIDC with a misleading 404).
- A public source repository (this repo is public, so provenance works).
- `id-token: write` on the release job.
- A trusted publisher configured **per package** on npmjs.com.

## Configure each package

For `@literm/terminal-core` and `@literm/react-native-terminal`:

1. Open `https://www.npmjs.com/package/<name>/access`.
2. **Trusted Publisher → GitHub Actions**.
3. Enter:
   - Organization or user: `shentechnologie`
   - Repository: `literm`
   - Workflow filename: `release.yml`
   - Environment name: blank
4. Allow **`npm publish`**. New configurations may default to staged publishing
   only; enable direct publish explicitly.
5. Save.

The trust is scoped to the repository and workflow, not to a branch, so it also
covers `release/**`.

## Workflow shape

```yaml
permissions:
  contents: write
  pull-requests: write
  id-token: write

steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 24.x
      # do NOT set registry-url: it writes an empty NODE_AUTH_TOKEN that
      # shadows OIDC
  - run: bun install --frozen-lockfile
  - run: bun run build
  - run: bun run scripts/verify-release.ts
  - uses: changesets/action@v1
    with:
      version: bun run version
      publish: bun run release
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Do not add `NPM_TOKEN` or `NODE_AUTH_TOKEN` anywhere. Provenance is automatic
with OIDC.

## Two-day expiry

A newly created trusted-publisher configuration expires if its first successful
publish does not happen within **two days**. Configure it when a release is
ready, then publish. If it expires, delete the configuration, recreate it, and
publish within the new window.

## Recovery

| Symptom | Likely cause | Fix |
|---|---|---|
| `404 Not Found - PUT` on publish | npm CLI < 11.5.1, missing trust, or empty `NODE_AUTH_TOKEN` | Use Node 24.x, remove `registry-url`, verify the trust fields |
| `E403` / authorization error | Wrong repo, workflow filename, or allowed action | Recreate the trust with exact values and `npm publish` allowed |
| Trust vanished after two days | Not validated | Recreate and publish within two days |
| Provenance missing | OIDC skipped, private repo, or token auth | Remove token variables, confirm `id-token: write` and public repo |
| `E409` trust conflict | A trust already exists | Edit or delete the existing configuration; do not add a second |
| Dist-tag command denied (if adopted) | Trust lacks dist-tag permission | Enable dist-tag management on the trust |

## Hardening

After the first OIDC publish is green:

1. Package settings → require two-factor authentication and disallow tokens.
2. Revoke any bootstrap/granular token created for the first publish.
3. Remove `NPM_TOKEN` from GitHub secrets if it was ever added.
4. Confirm the provenance badge on the package page.
