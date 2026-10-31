# Release rollback

**Last updated:** 2026-10-31

Rollback is layered. Fix the smallest thing that is actually wrong; do not
unpublish a version because a PR is embarrassing.

## Before the publish

If `release:verify` fails, stop. Nothing is consumed. Fix and re-run. Do not use
`--force` or a manual `npm publish` to bypass the gate.

## Publish command failed

- **Auth/OTP failure:** nothing was published. Fix auth and retry the same
  version.
- **One package published, one failed:** keep the successful version, fix the
  cause, then publish the remaining package. Both are a fixed group, so aim to
  finish the pair as soon as possible.
- **Build failed inside `prepublishOnly`:** nothing was published for that
  package. Fix, rebuild, retry.

## Bad prerelease

Publish the next prerelease (`alpha.N+1`) with the fix. Do not unpublish a
prerelease just because it is broken; prerelease consumers expect churn.

If the bad version is actively harmful, deprecate it:

```bash
npm deprecate '@literm/terminal-core@0.2.0-alpha.2' "Broken; use 0.2.0-alpha.3."
```

## Bad stable

1. **Within 72 hours and no dependents:** unpublish is possible but is a last
   resort.
   ```bash
   npm unpublish '@literm/terminal-core@0.2.0'
   npm unpublish '@literm/react-native-terminal@0.2.0'
   ```
   Both packages are a fixed group; remove both or neither.
2. **Otherwise:** deprecate the version and publish a patch immediately.
   ```bash
   npm deprecate '@literm/terminal-core@0.2.0' "Use 0.2.1."
   npm deprecate '@literm/react-native-terminal@0.2.0' "Use 0.2.1."
   ```
3. Move `latest` to the fixed version:
   ```bash
   npm dist-tag add '@literm/terminal-core@0.2.1' latest
   npm dist-tag add '@literm/react-native-terminal@0.2.1' latest
   ```

## Wrong dist-tag

```bash
npm dist-tag ls @literm/terminal-core
npm dist-tag add '@literm/terminal-core@<correct>' latest
npm dist-tag rm @literm/terminal-core <wrong-tag>
```

Never let an older-line patch own `latest`. See [hotfix.md](hotfix.md).

## Trusted publishing failure

If the publish failed before reaching the registry, no version was consumed.
Fix the trust or the workflow and re-run. Do not create a new version to work
around an auth error.

## After the rollback

- Record the incident, affected versions, dist-tags, and the fix in shenterm
  `STATUS.md`.
- If the cause was a process gap, update this folder or the release gate.
- If a version was unpublished, note it in the package changelog and the GitHub
  release.
