/**
 * In-memory ShellChannel: a fake remote shell for tests and the lab.
 *
 * It behaves like the native ring buffer contract: `read` pulls up to a byte
 * limit, `onDataAvailable` wakes the drain loop, and writes are recorded (or
 * echoed, with a minimal cooked-mode translation) so the whole pipeline can be
 * exercised without SSH.
 */
import type { CloseReason, ShellChannel } from './ssh-types';
import type { Unsubscribe } from './types';

export interface MockShellOptions {
  /** Text written by the "remote" before any input. */
  initialOutput?: string;
  /** Echo written bytes back (with CR -> CRLF and DEL -> backspace). */
  echo?: boolean;
  /** Reply to a line after CR when echoing, e.g. a fake prompt. */
  prompt?: string;
}

const encoder = new TextEncoder();

export class MockShellChannel implements ShellChannel {
  readonly id = 'mock-shell';
  readonly written: Uint8Array[] = [];
  readonly resizes: { cols: number; rows: number }[] = [];

  private queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private dataListeners = new Set<() => void>();
  private closeListeners = new Set<(reason: CloseReason) => void>();
  private closed = false;
  private lineBuffer = '';

  constructor(private readonly options: MockShellOptions = {}) {
    if (options.initialOutput) this.enqueue(encoder.encode(options.initialOutput));
  }

  /** Feed output as if the remote sent it. */
  enqueue(bytes: Uint8Array): void {
    if (this.closed || bytes.byteLength === 0) return;
    this.queue.push(bytes);
    this.queuedBytes += bytes.byteLength;
    for (const listener of [...this.dataListeners]) listener();
  }

  push(text: string): void {
    this.enqueue(encoder.encode(text));
  }

  read(maxBytes: number): Uint8Array | null {
    if (this.closed || this.queuedBytes === 0) return null;
    const first = this.queue[0]!;
    if (first.byteLength <= maxBytes) {
      this.queue.shift();
      this.queuedBytes -= first.byteLength;
      return first;
    }
    const head = first.subarray(0, maxBytes);
    this.queue[0] = first.subarray(maxBytes);
    this.queuedBytes -= maxBytes;
    return head;
  }

  write(data: Uint8Array): void {
    if (this.closed) return;
    this.written.push(data);
    if (!this.options.echo) return;
    const text = new TextDecoder().decode(data);
    let out = '';
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (code === 13) {
        out += '\r\n';
        if (this.options.prompt) out += this.options.prompt;
        this.lineBuffer = '';
      } else if (code === 127) {
        out += '\b \b';
        this.lineBuffer = this.lineBuffer.slice(0, -1);
      } else if (code === 3) {
        out += '^C\r\n';
        if (this.options.prompt) out += this.options.prompt;
        this.lineBuffer = '';
      } else if (code === 9 || code >= 32) {
        out += char;
        this.lineBuffer += char;
      }
    }
    if (out) this.enqueue(encoder.encode(out));
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  signal(): void {}

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of [...this.closeListeners]) listener({ type: 'closed' });
    this.dataListeners.clear();
    this.closeListeners.clear();
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
