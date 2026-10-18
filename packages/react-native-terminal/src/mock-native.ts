/**
 * In-memory implementation of the native binding.
 *
 * Mirrors what the iOS/Android modules do (ring buffer, echo transform, staged
 * host-key handshake, password + private-key auth) so the JS layer can be
 * tested without a device, and so hosts without the native module still load.
 */
import type {
  NativeCloseEvent,
  NativeConnectedEvent,
  NativeDataEvent,
  NativeErrorEvent,
  NativeHostKeyEvent,
  NativeSecureShellBinding,
  NativeSubscription,
} from './types';

type DataListener = (event: NativeDataEvent) => void;
type CloseListener = (event: NativeCloseEvent) => void;
type HostKeyListener = (event: NativeHostKeyEvent) => void;
type ConnectedListener = (event: NativeConnectedEvent) => void;
type ErrorListener = (event: NativeErrorEvent) => void;

interface MockSession {
  queue: Uint8Array[];
  queuedBytes: number;
}

interface MockConnectOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey: string;
  passphrase: string;
}

const encoder = new TextEncoder();

export interface MockNativeOptions {
  /** Password the mock accepts. */
  password?: string;
  /** Private key the mock accepts. */
  privateKey?: string;
  /** Fingerprint reported in onHostKey. */
  sha256?: string;
}

export class MockNativeSecureShellBinding implements NativeSecureShellBinding {
  readonly resizes: { sessionId: string; cols: number; rows: number }[] = [];
  readonly closed: string[] = [];
  readonly openedShells: { sessionId: string; cols: number; rows: number }[] = [];
  readonly hostKeyResponses: { sessionId: string; accept: boolean }[] = [];

  private sessions = new Map<string, MockSession>();
  private pending = new Map<string, MockConnectOptions>();
  private dataListeners = new Set<DataListener>();
  private closeListeners = new Set<CloseListener>();
  private hostKeyListeners = new Set<HostKeyListener>();
  private connectedListeners = new Set<ConnectedListener>();
  private errorListeners = new Set<ErrorListener>();
  private counter = 0;

  constructor(private readonly options: MockNativeOptions = {}) {}

  libssh2Version(): string {
    return 'mock';
  }

  // --- echo shell -----------------------------------------------------------

  openEchoShell(_cols: number, _rows: number, banner: string): string {
    const id = `echo-${this.counter++}`;
    this.sessions.set(id, { queue: [], queuedBytes: 0 });
    if (banner) this.enqueue(id, encoder.encode(banner));
    return id;
  }

  write(sessionId: string, data: Uint8Array): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const out: number[] = [];
    for (const byte of data) {
      if (byte === 13) out.push(13, 10);
      else if (byte === 127) out.push(8, 32, 8);
      else if (byte === 9 || byte >= 32) out.push(byte);
    }
    if (out.length === 0) return;
    this.enqueue(sessionId, Uint8Array.from(out));
  }

  read(sessionId: string, maxBytes: number): Uint8Array | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.queuedBytes === 0) return null;
    const first = session.queue[0]!;
    if (first.byteLength <= maxBytes) {
      session.queue.shift();
      session.queuedBytes -= first.byteLength;
      return first;
    }
    const head = first.subarray(0, maxBytes);
    session.queue[0] = first.subarray(maxBytes);
    session.queuedBytes -= maxBytes;
    return head;
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.resizes.push({ sessionId, cols, rows });
  }

  close(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.closed.push(sessionId);
    for (const listener of [...this.closeListeners]) {
      listener({ sessionId, reason: 'closed' });
    }
  }

  // --- staged connection ----------------------------------------------------

  connect(
    host: string,
    port: number,
    username: string,
    password: string,
    privateKey: string,
    passphrase: string,
    _timeoutMs: number,
  ): string {
    const options: MockConnectOptions = { host, port, username, password, privateKey, passphrase };
    const id = `ssh-${this.counter++}`;
    this.pending.set(id, options);
    setTimeout(() => {
      if (!this.pending.has(id)) return; // rejected or cancelled
      for (const listener of [...this.hostKeyListeners]) {
        listener({
          sessionId: id,
          host: options.host,
          port: options.port,
          algorithm: 'ssh-ed25519',
          sha256: this.options.sha256 ?? 'MOCKFINGERPRINT',
          knownHostsLine: `[${options.host}]:${options.port} ssh-ed25519 AAAAMOCK`,
        });
      }
    }, 0);
    return id;
  }

  respondHostKey(sessionId: string, accept: boolean): void {
    const options = this.pending.get(sessionId);
    if (!options) return;
    this.pending.delete(sessionId);
    this.hostKeyResponses.push({ sessionId, accept });

    if (!accept) {
      for (const listener of [...this.errorListeners]) {
        listener({ sessionId, message: 'host key rejected' });
      }
      return;
    }

    const passwordOk = options.password === (this.options.password ?? 'shenterm');
    const keyOk = options.privateKey === (this.options.privateKey ?? 'MOCKKEY');
    if (!passwordOk && !keyOk) {
      for (const listener of [...this.errorListeners]) {
        listener({ sessionId, message: 'authentication failed' });
      }
      return;
    }
    this.sessions.set(sessionId, { queue: [], queuedBytes: 0 });
    for (const listener of [...this.connectedListeners]) listener({ sessionId });
  }

  openShell(sessionId: string, cols: number, rows: number): void {
    this.openedShells.push({ sessionId, cols, rows });
    // The echo backend starts in cooked mode with a prompt.
    this.enqueue(sessionId, encoder.encode('shenterm secure shell\r\n$ '));
  }

  disconnect(sessionId: string): void {
    this.pending.delete(sessionId);
    this.close(sessionId);
  }

  // --- events ---------------------------------------------------------------

  addListener(event: 'onDataAvailable', listener: DataListener): NativeSubscription;
  addListener(event: 'onClose', listener: CloseListener): NativeSubscription;
  addListener(event: 'onHostKey', listener: HostKeyListener): NativeSubscription;
  addListener(event: 'onConnected', listener: ConnectedListener): NativeSubscription;
  addListener(event: 'onError', listener: ErrorListener): NativeSubscription;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addListener(event: string, listener: (payload: any) => void): NativeSubscription {
    const set = this.listenerSet(event);
    set.add(listener);
    return { remove: () => set.delete(listener) };
  }

  /** Test hook: push remote output into a session. */
  enqueue(sessionId: string, bytes: Uint8Array): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.queue.push(bytes);
    session.queuedBytes += bytes.byteLength;
    for (const listener of [...this.dataListeners]) listener({ sessionId });
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  private listenerSet(event: string): Set<(payload: never) => void> {
    switch (event) {
      case 'onClose':
        return this.closeListeners as unknown as Set<(payload: never) => void>;
      case 'onHostKey':
        return this.hostKeyListeners as unknown as Set<(payload: never) => void>;
      case 'onConnected':
        return this.connectedListeners as unknown as Set<(payload: never) => void>;
      case 'onError':
        return this.errorListeners as unknown as Set<(payload: never) => void>;
      default:
        return this.dataListeners as unknown as Set<(payload: never) => void>;
    }
  }
}
