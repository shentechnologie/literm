# First alpha `0.1.0-alpha.0` — manual runbook

**Last updated:** 2026-10-31
**Status:** one-time bootstrap for the first npm publish. Delete this file after
`0.1.0` is stable.
**Run from:** `/Users/penguin/dev/literm`, on branch `release/0.1`.

The general procedure is in [bootstrap.md](bootstrap.md). This file is the exact
copy-paste runbook for the first `0.1.0` alpha, including the `0.0.0` base
workaround that Changesets needs to express `0.1.0-alpha.0`.

> The release workflow is currently **dispatch-only**. Pushing this branch will
> not publish anything.

---

## Before you start

```bash
cd /Users/penguin/dev/literm
git checkout main
git pull --ff-only
git status --short                 # must be empty
npm whoami                         # your npm user
npm org ls literm                  # you must be owner/developer
```

Main must be at commit `3bee923` or newer, and CI must be green.

---

## 1. Cut the release branch

```bash
git checkout -b release/0.1
```

---

## 2. Set the bootstrap-only `0.0.0` base

Changesets cannot turn `0.1.0` into `0.1.0-alpha.0` with a normal bump. This is
the validated workaround. It exists only on this branch; never merge it to
`main`.

```bash
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
```

---

## 3. Add the initial changeset

```bash
cat > .changeset/initial-alpha.md <<'EOF'
---
"@literm/terminal-core": minor
"@literm/react-native-terminal": minor
---

First public alpha of the 0.1 line.
EOF
```

---

## 4. Enter alpha and version

```bash
bun changeset pre enter alpha
bun changeset version
```

Expected:

- `packages/terminal-core/package.json` → `0.1.0-alpha.0`
- `packages/react-native-terminal/package.json` → `0.1.0-alpha.0`
- RN dependency → `^0.1.0-alpha.0`
- `.changeset/pre.json` exists
- `CHANGELOG.md` created in both packages

Check:

```bash
node -p "require('./packages/terminal-core/package.json').version"
node -p "require('./packages/react-native-terminal/package.json').version"
node -p "require('./packages/react-native-terminal/package.json').dependencies['@literm/terminal-core']"
```

Expected output:

```text
0.1.0-alpha.0
0.1.0-alpha.0
^0.1.0-alpha.0
```

---

## 5. Run the release gate

```bash
bun install --frozen-lockfile
bun run release:verify
```

Expected: both tarballs pack, `publint` and `attw` are clean, and the
CJS/ESM/nodenext consumer smoke passes.

If `bun install --frozen-lockfile` complains, run `bun install`, stage
`bun.lock`, and continue. Do not publish until the gate passes.

---

## 6. Commit before publishing

```bash
git add -A
git commit -m "chore(release): cut 0.1.0-alpha.0"
```

This commit is required: `changeset publish` tags the current commit.

---

## 7. Publish with OTP

```bash
bun changeset publish
```

- Publishes both packages with the `alpha` dist-tag.
- Creates annotated tags.
- You will be prompted for an OTP; the 5-minute skip is fine.
- npm also sets `latest` to `0.1.0-alpha.0` because these are the first-ever
  publishes. This is expected; the first stable `0.1.0` moves `latest` forward.
- If one package fails, re-run `bun changeset publish`; it skips the one already
  published.

Do **not** continue past a failed publish. Send the output to the maintainer.

---

## 8. Verify

```bash
npm view @literm/terminal-core version
npm view @literm/react-native-terminal version
npm dist-tag ls @literm/terminal-core
npm dist-tag ls @literm/react-native-terminal
```

Expected:

```text
alpha:  0.1.0-alpha.0
latest: 0.1.0-alpha.0
```

First-publish metadata can 404 for a few minutes; `npm dist-tag ls` is reliable.

Clean install check:

```bash
TMP=$(mktemp -d)
cd "$TMP"
npm init -y
npm install @literm/terminal-core@alpha --no-audit --no-fund
node -e "const {TerminalSession}=require('@literm/terminal-core'); new TerminalSession({cols:80,rows:24}); console.log('ok')"
```

**Stop here and send the `npm dist-tag ls` output.**

---

## 9. Push the branch and tags

```bash
cd /Users/penguin/dev/literm
git push -u origin release/0.1
git push --follow-tags
```

The branch push runs CI but does not publish, because the workflow is still
dispatch-only.

---

## 10. Configure trusted publishing

For **each** package:

1. Open:
   - <https://www.npmjs.com/package/@literm/terminal-core/access>
   - <https://www.npmjs.com/package/@literm/react-native-terminal/access>
2. **Trusted Publisher → GitHub Actions**.
3. Enter:
   - Organization or user: `shentechnologie`
   - Repository: `literm`
   - Workflow filename: `release.yml`
   - Environment name: blank
4. Enable **`npm publish`** and save.

The configuration must validate with a successful publish within **2 days**.

---

## 11. Restore the release workflow

Set the repository variable:

- GitHub → repo **Settings → Secrets and variables → Actions → Variables →
  New repository variable**
- Name: `ACTIVE_RELEASE`
- Value: `release/0.1`

Then restore the push triggers on `main`:

```bash
cd /Users/penguin/dev/literm
git checkout main
```

Edit `.github/workflows/release.yml` so the `on:` block is:

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

Keep the existing `ACTIVE_RELEASE` guard on the job.

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): restore push triggers after bootstrap"
git push origin main
```

The `ACTIVE_RELEASE` guard keeps `main` from publishing while `release/0.1`
stabilizes.

Apply the same workflow change to the release branch:

```bash
git checkout release/0.1
git cherry-pick main
git push origin release/0.1
```

The release job runs on `release/0.1` and no-ops because `0.1.0-alpha.0` is
already published.

---

## 12. Validate OIDC with alpha.1

On `release/0.1`:

```bash
cat > .changeset/alpha-1.md <<'EOF'
---
"@literm/terminal-core": patch
"@literm/react-native-terminal": patch
---

Alpha 1 validation.
EOF
git add .changeset/alpha-1.md
git commit -m "chore: add alpha.1 changeset"
git push
```

Merge the Version Packages PR. It should publish `0.1.0-alpha.1` via OIDC with
provenance.

Verify:

```bash
npm dist-tag ls @literm/terminal-core
npm view @literm/terminal-core@0.1.0-alpha.1 dist.attestations
```

---

## If something fails

| Symptom | What to do |
|---|---|
| `release:verify` fails | Stop. Send the output. Nothing was published. |
| OTP/auth failure | Nothing was published. Re-run the same command. |
| One package published, one failed | Re-run `bun changeset publish`; it skips the published one. |
| First metadata 404 | Wait a few minutes; `npm dist-tag ls` still works. |
| Wrong version published | Do not unpublish blindly. See [rollback.md](rollback.md). |
| Tags missing on remote | `git push origin --tags`. |
| `latest` points at the alpha | Expected for the first publish. The first stable fixes it. |
