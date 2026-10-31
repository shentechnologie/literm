# Version support and compatibility

**Last updated:** 2026-10-31

## Version model

- Pre-1.0 semver: breaking change = **minor** (`0.2.0`), feature = minor,
  fix = patch.
- The two packages are a **fixed group** and always share a version.
- Prereleases are `<target>-alpha.N`, `-beta.N`, `-rc.N`; the stable release is
  `<target>`.
- The trailing prerelease counter continues across channel changes
  (`alpha.2` → `beta.3`). Do not try to force `.0` per channel.

## Support window

| Line | Support | Channel |
|---|---|---|
| Newest minor | Full: features, fixes, security | `latest` |
| Previous minor | Critical and security fixes only | `vX.Y` |
| Older | Unsupported | — |

A supported line stays on its `release/X.Y` branch. A patch for an older line
must use `--tag vX.Y`; see [hotfix.md](hotfix.md).

## Compatibility matrix

Update this table when the peer ranges or the app's Expo/RN versions change.

| `@literm/*` | Expo SDK | React Native | React | Skia | safe-area-context |
|---|---|---|---|---|---|
| 0.1.x / 0.2.x | 58 | 0.88 | 19.3 | 2.14 | 5.10 |

`@literm/terminal-core` has no React Native dependency; it supports Node 18+,
Bun, and Hermes. `@literm/react-native-terminal` is iOS/Android only and requires
the peers above.

## Dist-tags

- `latest` — newest stable line only.
- `alpha`, `beta`, `rc` — stage-specific prereleases.
- `vX.Y` — last patch of an older supported line.
- Never point `latest` at a prerelease deliberately. The only exception is a
  package's first-ever publish, where npm forces `latest`.

## Deprecation

```bash
npm deprecate '@literm/terminal-core@<range>' "Use <replacement> instead."
npm deprecate '@literm/react-native-terminal@<range>' "Use <replacement> instead."
```

Deprecation is reversible with `npm deprecate <pkg>@<range> ""`.

## Unpublish

npm allows unpublishing a version for **72 hours**, and only when no package
depends on it. After that, versions are permanent.

- Prefer deprecation plus a patch.
- Do not unpublish a version that a stable release line depends on.
- If a bad release must be removed within the window, follow
  [rollback.md](rollback.md) and record the decision in `STATUS.md`.
