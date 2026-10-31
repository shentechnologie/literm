# literm

A terminal for React Native: a headless VT core, a Skia terminal view and pane,
and a native SSH secure shell. Split into two npm packages.

| Package | What it is | Platform |
|---|---|---|
| [`@literm/terminal-core`](packages/terminal-core) | Headless and pure JS: xterm parser wrapper, shadow-grid diff, palette, key encoder, the transport contract, and the backpressured SSH drain loop. | Node / Bun / Hermes |
| [`@literm/react-native-terminal`](packages/react-native-terminal) | Everything React Native + native: the Expo SSH module (iOS libssh2 + mbedTLS, Android JSch), the Skia `TerminalView`, and the `TerminalPane` + key bar. | iOS / Android |

```
@literm/react-native-terminal  ──depends on──►  @literm/terminal-core
```

The split is by **platform coupling**, not domain: `terminal-core` has no React
Native, Expo, Skia or native code, so it runs under plain Bun/Node; everything
that touches them lives in `react-native-terminal`.

## Development

```bash
bun install
bun run typecheck     # every package
bun run test          # bun test, every package
bun run build         # react-native-builder-bob -> lib/ (cjs + esm + d.ts)
```

Each package builds to `lib/` (`commonjs`, `module`, `typescript`), which is
gitignored and regenerated on `bun run build` and before publishing. The SSH
package also ships its native `ios/` (with vendored libssh2 + mbedTLS) and
`android/` sources, so Expo autolinking can find it.

SSH backends have their own tests:

```bash
bun run ssh-server                                       # ssh2 test server on :2222
bun run ssh-smoke                                        # headless handshake + shell check
packages/react-native-terminal/scripts/engine-smoke.sh   # real handshake, macOS host
```

## Release

Two packages, one version. Stable releases come from `main`; alpha/beta/rc
stabilization runs on `release/X.Y` branches. Older supported lines are patched
with a `vX.Y` dist-tag.

- Stable: `bun changeset` → push → merge the Version Packages PR.
- Prerelease: cut `release/X.Y`, then follow the runbook.
- Gate: `bun run release:verify` before every publish.

The branch model, channel runbooks and support policy are in
[`docs/release/`](docs/release/README.md). Trusted publishing (OIDC) is the only
publish path; no npm token is stored in the repo.

## License

MIT. Bundled third-party sources are noted in
[`packages/react-native-terminal/LICENSE`](packages/react-native-terminal/LICENSE).
