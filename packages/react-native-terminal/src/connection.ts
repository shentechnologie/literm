/**
 * High-level connection API with the staged host-key handshake.
 *
 * Ordering is enforced by construction: the native side performs the handshake
 * and emits the server key, but does not authenticate until `respondHostKey`
 * arrives from JS. A verifier that throws, declines, or never resolves leaves
 * the connection unauthenticated.
 */
import { getSecureShell } from './native';
import { SecureShellChannel } from './channel';
import type {
  CloseReason,
  ShellChannel,
  ShellOpenOptions,
  Unsubscribe,
} from '@literm/terminal-core';
import type {
  ConnectOptions,
  NativeConnectedEvent,
  NativeErrorEvent,
  NativeHostKeyEvent,
  NativeSecureShellBinding,
  NativeSubscription,
} from './types';

export const DEFAULT_SSH_PORT = 22;
export const DEFAULT_TIMEOUT_MS = 15000;

export class SecureShellConnection {
  private sessionId: string | null = null;
  private connected = false;
  private closing = false;
  private readonly closeListeners = new Set<(reason: CloseReason) => void>();
  private readonly nativeCloseSub: NativeSubscription;

  constructor(
    private readonly native: NativeSecureShellBinding,
    sessionId: string,
  ) {
    this.sessionId = sessionId;
    this.nativeCloseSub = native.addListener('onClose', (event) => {
      // Match against the id we started with: it stays set until this event
      // arrives, so a local disconnect can still deliver the close reason.
      if (event.sessionId !== this.sessionId) return;
      this.connected = false;
      this.sessionId = null;
      const reason: CloseReason =
        event.reason === 'error'
          ? { type: 'error', message: event.message ?? 'connection error' }
          : event.reason === 'eof'
            ? { type: 'eof', exitCode: event.exitCode }
            : { type: 'closed' };
      for (const listener of [...this.closeListeners]) listener(reason);
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** @internal — called by connect() once the server accepts auth. */
  markConnected(): void {
    this.connected = true;
  }

  async openShell(options: ShellOpenOptions): Promise<ShellChannel> {
    if (!this.sessionId || !this.connected) throw new Error('not connected');
    this.native.openShell(this.sessionId, options.cols, options.rows);
    return new SecureShellChannel(this.native, this.sessionId);
  }

  disconnect(): void {
    if (!this.sessionId || this.closing) return;
    this.closing = true;
    this.connected = false;
    // sessionId is cleared by the onClose listener when the native event lands.
    this.native.disconnect(this.sessionId);
  }

  onClose(listener: (reason: CloseReason) => void): Unsubscribe {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /** Release listeners held by the connection itself. */
  dispose(): void {
    this.nativeCloseSub.remove();
    this.closeListeners.clear();
    this.disconnect();
  }
}

/**
 * Connect and complete the staged host-key handshake.
 *
 * `binding` exists so tests (and hosts embedding the module) can inject a
 * native implementation; production callers omit it.
 */
export async function connect(
  options: ConnectOptions,
  binding?: NativeSecureShellBinding,
): Promise<SecureShellConnection> {
  const native = binding ?? getSecureShell();

  let password = '';
  let privateKey = '';
  let passphrase = '';
  if (options.auth.type === 'password') {
    password = options.auth.password;
  } else if (options.auth.type === 'key') {
    privateKey = options.auth.privateKey;
    passphrase = options.auth.passphrase ?? '';
  } else {
    throw new Error(`auth method "${options.auth.type}" is not implemented yet`);
  }

  const sessionId = native.connect(
    options.host,
    options.port ?? DEFAULT_SSH_PORT,
    options.username,
    password,
    privateKey,
    passphrase,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const connection = new SecureShellConnection(native, sessionId);

  try {
    await new Promise<void>((resolve, reject) => {
      const subscriptions: NativeSubscription[] = [];
      let settled = false;
      const settle = (action: () => void) => {
        if (settled) return;
        settled = true;
        for (const subscription of subscriptions) subscription.remove();
        action();
      };

      subscriptions.push(
        native.addListener('onHostKey', (event: NativeHostKeyEvent) => {
          if (event.sessionId !== sessionId) return;
          void (async () => {
            let accept = false;
            try {
              accept = await options.verifyHostKey({
                algorithm: event.algorithm,
                sha256: event.sha256,
                knownHostsLine: event.knownHostsLine,
              });
            } catch {
              // A throwing verifier is a rejection; `accept` stays false.
            }
            if (!accept) {
              // Settle before responding so a native error event (emitted
              // synchronously by some backends) cannot race this message.
              settle(() =>
                reject(
                  new Error(
                    `host key for ${event.host}:${event.port} rejected (${event.algorithm} ${event.sha256})`,
                  ),
                ),
              );
            }
            native.respondHostKey(sessionId, accept);
          })();
        }),
      );

      subscriptions.push(
        native.addListener('onConnected', (event: NativeConnectedEvent) => {
          if (event.sessionId !== sessionId) return;
          settle(() => {
            connection.markConnected();
            resolve();
          });
        }),
      );

      subscriptions.push(
        native.addListener('onError', (event: NativeErrorEvent) => {
          if (event.sessionId !== sessionId) return;
          settle(() => reject(new Error(event.message)));
        }),
      );
    });
  } catch (error) {
    // Nothing is authenticated; release the native side.
    connection.dispose();
    throw error;
  }

  return connection;
}

/** Open the in-memory echo shell (renderer lab / smoke tests). */
export function openEchoShell(
  cols: number,
  rows: number,
  banner: string,
  binding?: NativeSecureShellBinding,
): ShellChannel {
  const native = binding ?? getSecureShell();
  return new SecureShellChannel(native, native.openEchoShell(cols, rows, banner));
}
