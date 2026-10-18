/**
 * SecureShellTransport: the high-level SSH transport the terminal stack talks
 * to. It implements the `SshTransport` contract from @literm/terminal-core on
 * top of the native module's connection API.
 *
 * The native library owns the protocol work (staged host-key gate, auth,
 * channels, flow control); this class only translates the transport's connect
 * options and forwards channels. The binding is injectable so tests can supply
 * a mock, and so hosts can swap the backend.
 */
import { connect as secureConnect, type SecureShellConnection } from './connection';
import { getSecureShell } from './native';
import type { NativeSecureShellBinding } from './types';
import type {
  CloseReason,
  ShellChannel,
  ShellOpenOptions,
  SshConnectOptions,
  SshTransport,
  Unsubscribe,
} from '@literm/terminal-core';

export class SecureShellTransport implements SshTransport {
  private connection: SecureShellConnection | null = null;
  private readonly closeListeners = new Set<(reason: CloseReason) => void>();
  private closeSubscription: Unsubscribe | null = null;

  constructor(private readonly native: NativeSecureShellBinding = getSecureShell()) {}

  get isConnected(): boolean {
    return this.connection?.isConnected ?? false;
  }

  async connect(options: SshConnectOptions): Promise<void> {
    if (this.connection) throw new Error('transport is already connected');

    const connection = await secureConnect(
      {
        host: options.host,
        port: options.port,
        username: options.username,
        auth: options.auth,
        verifyHostKey: options.verifyHostKey,
        timeoutMs: options.timeoutMs,
      },
      this.native,
    );
    this.connection = connection;
    this.closeSubscription = connection.onClose((reason) => {
      for (const listener of [...this.closeListeners]) listener(reason);
    });
  }

  async openShell(options: ShellOpenOptions): Promise<ShellChannel> {
    if (!this.connection) throw new Error('not connected');
    return this.connection.openShell(options);
  }

  disconnect(): void {
    const connection = this.connection;
    this.connection = null;
    // The native close event still reaches the listener registered in connect().
    connection?.disconnect();
  }

  onClose(listener: (reason: CloseReason) => void): Unsubscribe {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /** Release listeners held by the transport itself. */
  dispose(): void {
    this.disconnect();
    this.closeSubscription?.();
    this.closeSubscription = null;
    this.closeListeners.clear();
  }
}
