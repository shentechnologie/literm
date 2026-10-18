/**
 * @literm/react-native-terminal
 *
 * The React Native / native layer of the terminal stack:
 *
 *  - the native SSH module (iOS libssh2 + mbedTLS, Android JSch) and its JS
 *    connection API: staged host-key verification, password and private-key
 *    auth, and interactive shells with pull-based reads;
 *  - `SecureShellTransport`, the transport contract the terminal stack talks to;
 *  - the Skia `TerminalView` renderer;
 *  - the `TerminalPane` (renderer + hidden input + key bar) and its key bar.
 *
 * The headless model, parser and the transport contract live in
 * `@literm/terminal-core`.
 */
export { SecureShellChannel } from './channel';
export {
  connect,
  openEchoShell,
  SecureShellConnection,
  DEFAULT_SSH_PORT,
  DEFAULT_TIMEOUT_MS,
} from './connection';
export { SecureShellTransport } from './transport';
export { getSecureShell } from './native';
export { MockNativeSecureShellBinding } from './mock-native';
export type { MockNativeOptions } from './mock-native';

export type {
  ConnectOptions,
  NativeCloseEvent,
  NativeConnectedEvent,
  NativeDataEvent,
  NativeErrorEvent,
  NativeHostKeyEvent,
  NativeSecureShellBinding,
  NativeSubscription,
  SignalName,
} from './types';

// The transport contract is defined in (and re-exported from) terminal-core.
export type {
  CloseReason,
  HostKeyFingerprint,
  HostKeyVerifier,
  ShellChannel,
  ShellOpenOptions,
  SshAuth,
  SshTransport,
  Unsubscribe,
} from '@literm/terminal-core';

// --- UI ---------------------------------------------------------------------
export * from './view';
export * from './pane';
