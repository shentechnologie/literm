# @literm/terminal-core

Headless, pure-JS terminal core — no React Native, Expo, Skia or native code, so
it runs under Node, Bun and Hermes.

- **Parser + model** — an `@xterm/headless` wrapper (`TerminalSession`), a
  shadow-grid diff engine, the 256/true-color palette, the cell model, and a
  mode-aware key encoder.
- **Transport contract** — `ShellChannel`, `SshTransport`, host-key and auth
  types.
- **SSH drain loop** — `SshSession` binds a shell channel to a terminal with
  backpressure and an adaptive read budget, plus `MockShellChannel` for tests
  and labs.

```ts
import { TerminalSession, SshSession, MockShellChannel } from '@literm/terminal-core';

const terminal = new TerminalSession({ cols: 80, rows: 24 });
const channel = new MockShellChannel({ echo: true, prompt: '$ ' });
const ssh = new SshSession({ terminal, channel });
ssh.start();
```

The React Native renderer and the native SSH module live in
[`@literm/react-native-terminal`](../react-native-terminal).

## License

MIT.
