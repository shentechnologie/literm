# Pre-release verification gate

**Last updated:** 2026-10-31
**Applies to:** every release, stable or prerelease, and every release PR.

Publishing is immutable. This gate is the last thing that runs before a version
leaves the machine.

## Command

```bash
bun install --frozen-lockfile
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run release:verify
```

`release:verify` builds both packages, then:

- packs both tarballs into a temporary directory;
- asserts the required runtime files are present and the forbidden local state
  (`.gradle/`, `node_modules/`, tests, `.DS_Store`, coverage) is absent;
- enforces the size budget (`terminal-core` ≤ 500 KB,
  `react-native-terminal` ≤ 5 MB packed);
- runs `publint --strict` and `@arethetypeswrong/cli` for both packages;
- installs the packed `terminal-core` tarball in a clean consumer and checks
  CJS `require`, ESM `import`, and `moduleResolution: nodenext` types.

Set `KEEP_VERIFY_TMP=1` to keep the packs for inspection.

`prepublishOnly` is a presence check, not a rebuild. It fails if `lib/` is
missing, because `changeset publish` runs packages concurrently and two
concurrent `bob build` runs race on `terminal-core`'s type output.

## Required tarball contents

`@literm/terminal-core`: `LICENSE`, `README.md`, `package.json`, both `lib/`
builds, both type builds, and `src/`.

`@literm/react-native-terminal`: everything above plus
`expo-module.config.json`, `android/build.gradle`, the Android Kotlin module,
the iOS podspec and vendored libssh2 + mbedTLS sources. The `files` whitelist is
deliberate; do not widen it back to the whole `android/` directory.

## Native proof

The tarball gate does not prove Expo autolinking. Before a **stable** release,
and whenever the native module or vendored sources change:

1. Install the packed tarballs into a scratch copy of shenterm (or use the
   published prerelease).
2. Run `expo prebuild` and an Android build.
3. Open one real SSH session.
4. Record the date, package version, device/emulator and result in shenterm
   `STATUS.md`.

Prerelease iterations may reuse the last native proof when the native sources
and podspec/gradle files are unchanged; state that in the release notes.

## Stop conditions

- Any gate failure.
- A missing or unexpected tarball file.
- `attw` or `publint` reports a problem.
- No native proof for a stable release or a native-source change.
- A dirty working tree.

Do not use `--force`, `--no-verify`, or a manual `npm publish` to bypass this
gate. If a publish already happened, use [rollback.md](rollback.md).
