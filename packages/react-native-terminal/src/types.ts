/**
 * Public types for @literm/react-native-terminal.
 *
 * The transport contract (`ShellChannel`, `SshTransport`, auth, host-key
 * shapes) lives in @literm/terminal-core, because the pure drain loop and the
 * mocks implement it there. This module owns only what is specific to the
 * native module: the binding surface and its events.
 */
import type {
  CloseReason,
  HostKeyFingerprint,
  HostKeyVerifier,
  ShellChannel,
  ShellOpenOptions,
  SshAuth,
  SshTransport,
  Unsubscribe,
} from '@literm/terminal-core';

// Re-export the contract so `./types` is self-contained for the native binding.
export type {
  CloseReason,
  HostKeyFingerprint,
  HostKeyVerifier,
  ShellChannel,
  ShellOpenOptions,
  SshAuth,
  SshTransport,
  Unsubscribe,
};

/** Signal names forwarded to the remote process. */
export type SignalName = 'INT' | 'TERM' | 'HUP' | 'KILL' | 'QUIT';

export interface ConnectOptions {
  host: string;
  port?: number;
  username: string;
  auth: SshAuth;
  verifyHostKey: HostKeyVerifier;
  /** TCP connect + handshake timeout. */
  timeoutMs?: number;
}

// --- native binding ---------------------------------------------------------

export interface NativeCloseEvent {
  sessionId: string;
  reason: 'eof' | 'closed' | 'error';
  message?: string;
  exitCode?: number;
}

/** Emitted during the handshake, before any authentication. */
export interface NativeHostKeyEvent {
  sessionId: string;
  host: string;
  port: number;
  algorithm: string;
  /** Base64 SHA-256 of the public key blob, no padding (OpenSSH style). */
  sha256: string;
  knownHostsLine: string;
}

export interface NativeConnectedEvent {
  sessionId: string;
}

export interface NativeErrorEvent {
  sessionId: string;
  message: string;
}

export interface NativeDataEvent {
  sessionId: string;
}

export interface NativeSubscription {
  remove(): void;
}

/**
 * The surface the iOS/Android module exposes. Arguments are positional because
 * Expo Modules maps JS arguments to native parameters positionally (an options
 * object would arrive as the first string).
 */
export interface NativeSecureShellBinding {
  /** Bundled libssh2 version (build verification). */
  libssh2Version(): string;

  /** Ring-buffered echo shell, for tests and the renderer lab. */
  openEchoShell(cols: number, rows: number, banner: string): string;

  /**
   * Start TCP connect + SSH handshake off-thread. Returns a sessionId
   * immediately; progress arrives as events. Authentication is NOT attempted
   * until `respondHostKey` accepts the server key. `privateKey` wins over
   * `password` when both are supplied.
   */
  connect(
    host: string,
    port: number,
    username: string,
    password: string,
    privateKey: string,
    passphrase: string,
    timeoutMs: number,
  ): string;
  respondHostKey(sessionId: string, accept: boolean): void;
  openShell(sessionId: string, cols: number, rows: number): void;
  write(sessionId: string, data: Uint8Array): void;
  read(sessionId: string, maxBytes: number): Uint8Array | null;
  resize(sessionId: string, cols: number, rows: number): void;
  close(sessionId: string): void;
  disconnect(sessionId: string): void;

  addListener(event: 'onDataAvailable', listener: (event: NativeDataEvent) => void): NativeSubscription;
  addListener(event: 'onClose', listener: (event: NativeCloseEvent) => void): NativeSubscription;
  addListener(event: 'onHostKey', listener: (event: NativeHostKeyEvent) => void): NativeSubscription;
  addListener(event: 'onConnected', listener: (event: NativeConnectedEvent) => void): NativeSubscription;
  addListener(event: 'onError', listener: (event: NativeErrorEvent) => void): NativeSubscription;
}
