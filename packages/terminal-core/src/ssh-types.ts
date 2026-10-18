/**
 * Transport contract for the SSH layer.
 *
 * The P0 benchmark showed xterm parses queued output in large macrotask
 * batches, so the only way to bound jank is to bound how much we hand it per
 * tick. That is why reads are *pull-based* (`read(maxBytes)`) instead of an
 * event per network chunk: the UI drains a fixed budget per frame and the
 * kernel/native ring buffer absorbs bursts.
 *
 * The native module implements this; the JS side owns policy (drain size,
 * reconnection, known_hosts) but never owns sockets.
 */

import type { Unsubscribe } from './types';

/** SSH server host key identity, as shown to the user for verification. */
export interface HostKeyFingerprint {
  /** e.g. `ssh-ed25519`, `rsa-sha2-256`, `ecdsa-sha2-nistp256`. */
  algorithm: string;
  /** Base64 SHA-256 of the public key blob, without padding. */
  sha256: string;
  /** OpenSSH known_hosts line for this key, so we can store it verbatim. */
  knownHostsLine: string;
}

/**
 * Called after the SSH handshake and BEFORE authentication. Returning false
 * aborts the connection. There is deliberately no "skip verification" option:
 * the host key is a hard gate, not a setting.
 */
export type HostKeyVerifier = (fingerprint: HostKeyFingerprint) => boolean | Promise<boolean>;

export type SshAuth =
  | { type: 'password'; password: string }
  | { type: 'key'; privateKey: string; passphrase?: string }
  | { type: 'agent' } // reserved; unusable on mobile
  | { type: 'none' };

export interface SshConnectOptions {
  host: string;
  port?: number;
  username: string;
  auth: SshAuth;
  verifyHostKey: HostKeyVerifier;
  /** TCP + handshake timeout. */
  timeoutMs?: number;
  /** Keepalive interval in seconds; 0 disables. */
  keepaliveSeconds?: number;
  /** Connect through an already-open channel (ProxyJump). */
  via?: ShellChannel | null;
}

export interface ShellOpenOptions {
  cols: number;
  rows: number;
  /** TERM value. */
  term?: string;
  env?: Record<string, string>;
}

/**
 * A duplex byte channel. Multiple shells can live on one connection (tabs do
 * not pay a second handshake).
 */
export interface ShellChannel {
  readonly id: string;
  /** Enqueue bytes for the remote pty. Never blocks; native buffers. */
  write(data: Uint8Array): void;
  /** Window-change. Called after the UI grid settles. */
  resize(cols: number, rows: number): void;
  /**
   * Pull up to `maxBytes` of pending output, or null when drained.
   * The returned buffer is only valid until the next read.
   */
  read(maxBytes: number): Uint8Array | null;
  /** Wake-up when data arrives. Called from the native thread queue. */
  onDataAvailable(listener: () => void): Unsubscribe;
  /** Fired once when the channel closes (remote exit, network error). */
  onClose(listener: (reason: CloseReason) => void): Unsubscribe;
  /** Send a signal (INT, TERM, ...) or hang up. */
  signal(name: 'INT' | 'TERM' | 'HUP' | 'KILL' | 'QUIT'): void;
  close(): void;
}

export type CloseReason =
  { type: 'eof'; exitCode?: number } | { type: 'closed' } | { type: 'error'; message: string };

export interface SshTransport {
  /** TCP connect + SSH handshake + host-key verification + authentication. */
  connect(options: SshConnectOptions): Promise<void>;
  openShell(options: ShellOpenOptions): Promise<ShellChannel>;
  disconnect(): void;
  onClose(listener: (reason: CloseReason) => void): Unsubscribe;
  readonly isConnected: boolean;
}

/** Drain budget per animation frame; keeps parse blocks ~1ms on Hermes. */
export const DEFAULT_READ_BUDGET_BYTES = 64 * 1024;
