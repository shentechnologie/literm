/**
 * A Shell backed by the native ring buffer.
 *
 * One subscription per event type is shared by all channels; events carry the
 * sessionId, so a connection with many tabs pays for one listener each.
 */
import type { CloseReason, ShellChannel, Unsubscribe } from '@literm/terminal-core';
import type {
  NativeCloseEvent,
  NativeDataEvent,
  NativeSecureShellBinding,
  NativeSubscription,
  SignalName,
} from './types';

export class SecureShellChannel implements ShellChannel {
  readonly id: string;
  private readonly native: NativeSecureShellBinding;
  private readonly dataListeners = new Set<() => void>();
  private readonly closeListeners = new Set<(reason: CloseReason) => void>();
  private subscriptions: NativeSubscription[] = [];
  private closed = false;

  constructor(native: NativeSecureShellBinding, sessionId: string) {
    this.native = native;
    this.id = sessionId;

    this.subscriptions.push(
      native.addListener('onDataAvailable', (payload: NativeDataEvent) => {
        if (payload.sessionId !== this.id) return;
        for (const listener of [...this.dataListeners]) listener();
      }),
    );
    this.subscriptions.push(
      native.addListener('onClose', (event: NativeCloseEvent) => {
        if (event.sessionId !== this.id || this.closed) return;
        this.closed = true;
        const reason: CloseReason =
          event.reason === 'error'
            ? { type: 'error', message: event.message ?? 'channel error' }
            : event.reason === 'eof'
              ? { type: 'eof', exitCode: event.exitCode }
              : { type: 'closed' };
        for (const listener of [...this.closeListeners]) listener(reason);
      }),
    );
  }

  read(maxBytes: number): Uint8Array | null {
    if (this.closed) return null;
    return this.native.read(this.id, maxBytes);
  }

  write(data: Uint8Array): void {
    if (this.closed) return;
    this.native.write(this.id, data);
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;
    this.native.resize(this.id, cols, rows);
  }

  /** Signals are a transport-level request; the echo shell has no process. */
  signal(_name: SignalName): void {}

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
    this.native.close(this.id);
    // A local close is still a close: notify listeners, then detach them.
    for (const listener of [...this.closeListeners]) listener({ type: 'closed' });
    this.closeListeners.clear();
    this.dataListeners.clear();
  }

  onDataAvailable(listener: () => void): Unsubscribe {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onClose(listener: (reason: CloseReason) => void): Unsubscribe {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
}
