/**
 * SshSession: binds a remote shell channel to a terminal session.
 *
 * The P0 benchmark showed why this layer exists: xterm parses queued output in
 * macrotask-sized batches, so pushing 10 MB into it at once produces multi-frame
 * stalls. The fix is backpressure, not a faster parser:
 *
 *   read up to `budget` bytes -> terminal.write(..., onParsed) -> wait for the
 *   parse to finish -> yield one tick -> repeat
 *
 * Native keeps the network burst in a ring buffer; JS never has more than one
 * budget-sized batch in flight. The budget adapts to observed parse latency
 * (shrink when a batch takes too long, grow slowly when it does not).
 *
 * Resizes are debounced because the UI grid changes continuously while the
 * keyboard animates or the device rotates, and every window-change is a
 * round trip the remote application has to redraw for.
 */
import { encodeKey } from './keys';
import { now } from './clock';
import type { TerminalSession } from './session';
import type { CloseReason, ShellChannel } from './ssh-types';
import type { Unsubscribe } from './types';

/** The narrow terminal surface this layer needs (TerminalSession satisfies it). */
export interface TerminalSink {
  write(data: string | Uint8Array, onParsed?: () => void): void;
  resize(cols: number, rows: number): void;
}

export interface SshSessionOptions {
  terminal: TerminalSink;
  channel: ShellChannel;
  /** Starting batch size. */
  initialBudgetBytes?: number;
  minBudgetBytes?: number;
  maxBudgetBytes?: number;
  /** Parse latency above this halves the budget (ms). */
  slowParseMs?: number;
  /** Parse latency below this grows the budget (ms). */
  fastParseMs?: number;
  resizeDebounceMs?: number;
}

export interface SshSessionStats {
  bytesReceived: number;
  bytesSent: number;
  drains: number;
  budgetBytes: number;
  budgetChanges: number;
  lastParseMs: number;
  maxParseMs: number;
  resizes: number;
}

export class SshSession {
  readonly stats: SshSessionStats;
  onClose: ((reason: CloseReason) => void) | undefined;

  private readonly terminal: TerminalSink;
  private readonly channel: ShellChannel;
  private readonly initialBudget: number;
  private readonly minBudget: number;
  private readonly maxBudget: number;
  private readonly slowParseMs: number;
  private readonly fastParseMs: number;
  private readonly resizeDebounceMs: number;

  private started = false;
  private stopped = false;
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResize: { cols: number; rows: number } | null = null;
  private unsubscribes: Unsubscribe[] = [];

  constructor(options: SshSessionOptions) {
    this.terminal = options.terminal;
    this.channel = options.channel;
    this.initialBudget = options.initialBudgetBytes ?? 32 * 1024;
    this.minBudget = options.minBudgetBytes ?? 4 * 1024;
    this.maxBudget = options.maxBudgetBytes ?? 128 * 1024;
    this.slowParseMs = options.slowParseMs ?? 8;
    this.fastParseMs = options.fastParseMs ?? 2;
    this.resizeDebounceMs = options.resizeDebounceMs ?? 80;
    this.stats = {
      bytesReceived: 0,
      bytesSent: 0,
      drains: 0,
      budgetBytes: this.initialBudget,
      budgetChanges: 0,
      lastParseMs: 0,
      maxParseMs: 0,
      resizes: 0,
    };
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.unsubscribes.push(this.channel.onDataAvailable(() => this.schedule()));
    this.unsubscribes.push(
      this.channel.onClose((reason) => {
        this.stopped = true;
        this.clearTimers();
        this.onClose?.(reason);
      }),
    );
    this.schedule();
  }

  /** Send user input (already encoded to bytes) to the remote pty. */
  write(data: Uint8Array | string): void {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (bytes.byteLength === 0) return;
    this.stats.bytesSent += bytes.byteLength;
    this.channel.write(bytes);
  }

  /** Forward keystrokes; encodes with the terminal's current modes. */
  sendKey(event: Parameters<typeof encodeKey>[0], modes: Parameters<typeof encodeKey>[1]): void {
    const encoded = encodeKey(event, modes);
    if (encoded) this.write(encoded);
  }

  resize(cols: number, rows: number): void {
    this.pendingResize = { cols, rows };
    if (this.resizeTimer) return;
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      const pending = this.pendingResize;
      this.pendingResize = null;
      if (!pending || this.stopped) return;
      this.stats.resizes++;
      this.channel.resize(pending.cols, pending.rows);
    }, this.resizeDebounceMs);
  }

  /** Terminal-initiated scrollback changes never reach the remote. */
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimers();
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
    this.channel.close();
  }

  private schedule(): void {
    if (this.stopped || this.draining || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, 0);
  }

  private drain(): void {
    if (this.stopped || this.draining) return;
    const budget = this.stats.budgetBytes;
    const chunk = this.channel.read(budget);
    if (!chunk || chunk.byteLength === 0) return; // wait for onDataAvailable

    this.draining = true;
    const startedAt = now();
    this.terminal.write(chunk, () => {
      const parseMs = now() - startedAt;
      this.draining = false;
      this.stats.drains++;
      this.stats.bytesReceived += chunk.byteLength;
      this.stats.lastParseMs = parseMs;
      if (parseMs > this.stats.maxParseMs) this.stats.maxParseMs = parseMs;
      this.adapt(parseMs);
      // Always re-check. A short read does NOT prove the queue is empty: a
      // channel may return less than the requested budget while more is queued
      // (the mock does exactly that). The next drain returns null and the loop
      // parks; one extra timer turn when idle is the cost of not losing data.
      // Scheduling here also covers data that arrived while this parse was in
      // flight, since the onDataAvailable wakeup would have hit the `draining`
      // guard.
      this.schedule();
    });
  }

  private adapt(parseMs: number): void {
    const before = this.stats.budgetBytes;
    let next = before;
    if (parseMs > this.slowParseMs) {
      next = Math.max(this.minBudget, Math.floor(before / 2));
    } else if (parseMs < this.fastParseMs) {
      next = Math.min(this.maxBudget, Math.floor(before * 1.5));
    }
    if (next !== before) {
      this.stats.budgetBytes = next;
      this.stats.budgetChanges++;
    }
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.timer = null;
    this.resizeTimer = null;
  }
}

/** Convenience: bind a session to an existing TerminalSession. */
export function attachShell(
  terminal: TerminalSession,
  channel: ShellChannel,
  options: Omit<SshSessionOptions, 'terminal' | 'channel'> = {},
): SshSession {
  return new SshSession({ terminal, channel, ...options });
}
