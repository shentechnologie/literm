# @literm/react-native-terminal

The React Native + native half of literm: a native SSH module, a Skia terminal
renderer, and a ready-made terminal pane.

- **SSH** — an Expo module (iOS vendored libssh2 + mbedTLS, Android JSch) with a
  staged host-key gate (nothing authenticates before JS approves the server
  key), password and private-key auth, and pull-based shell channels.
  `SecureShellTransport` implements the `SshTransport` contract from
  `@literm/terminal-core`.
- **View** — `TerminalView`, a Skia renderer with a per-row `SkPicture` cache
  (Nerd Font, CJK/emoji fallback, 16/256/true color, attributes, cursor).
- **Pane** — `TerminalPane` wires the view to a hidden `TextInput` (soft
  keyboard), a key bar, and drag-to-scroll.

```tsx
import { TerminalSession } from '@literm/terminal-core';
import { SecureShellTransport, TerminalPane, terminalKey } from '@literm/react-native-terminal';

const transport = new SecureShellTransport();
await transport.connect({
  host: 'example.com',
  username: 'me',
  auth: { type: 'password', password: '…' },
  verifyHostKey: async (key) => confirm(key.sha256),
});
const terminal = new TerminalSession({ cols: 80, rows: 24 });
const channel = await transport.openShell({ cols: 80, rows: 24 });
const ssh = new SshSession({ terminal, channel }); // from @literm/terminal-core
ssh.start();

<TerminalPane
  session={terminal}
  font={{ family: 'JetBrainsMono Nerd Font Mono', sources: [regular, bold, italic, boldItalic] }}
  items={[terminalKey('escape'), terminalKey('ctrlC'), terminalKey('enter')]}
  onInput={(event) => ssh.write(encodeKey(event, terminal.term.modes))}
/>;
```

## Native setup

`expo prebuild` / `pod install` pick the module up automatically. iOS apps that
ship SSH must set `ITSAppUsesNonExemptEncryption` and file the export-compliance
self-classification. The vendored C sources (`ios/vendor`) add ~10 MB to the
package so builds need no network; refresh them with
`scripts/vendor-ssh.sh`.

## License

MIT. Bundled: libssh2 (BSD-3-Clause) and mbedTLS (Apache-2.0) — see
[`LICENSE`](./LICENSE).
