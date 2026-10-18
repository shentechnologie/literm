/**
 * Transport <-> terminal plumbing. These tests run without SSH, without a
 * device, and without native code: a fake terminal sink and the mock channel
 * cover the ordering, backpressure, budget adaptation and resize-debounce
 * behaviour that the native module must feed.
 */
import { describe, expect, test } from 'bun:test';
import { MockShellChannel } from '../src/mock-channel';
import { SshSession, type TerminalSink } from '../src/ssh-session';

const encoder = new TextEncoder();

class FakeTerminal implements TerminalSink {
  readonly chunks: Uint8Array[] = [];
  bytes = 0;
  resizes: { cols: number; rows: number }[] = [];
  maxChunk = 0;

  constructor(private readonly parseDelayMs = 0) {}

  write(data: string | Uint8Array, onParsed?: () => void): void {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    this.chunks.push(bytes);
    this.bytes += bytes.byteLength;
    if (bytes.byteLength > this.maxChunk) this.maxChunk = bytes.byteLength;
    if (onParsed) setTimeout(onParsed, this.parseDelayMs);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  text(): string {
    return new TextDecoder().decode(concat(this.chunks));
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function payload(bytes: number): Uint8Array {
  const letters = encoder.encode('abcdefghijklmnopqrstuvwxyz0123456789\n');
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = letters[i % letters.length]!;
  return out;
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('SshSession: delivery', () => {
  test('delivers every byte in order and respects the budget ceiling', async () => {
    const terminal = new FakeTerminal(0);
    const channel = new MockShellChannel();
    const data = payload(200 * 1024);
    channel.enqueue(data);

    const session = new SshSession({
      terminal,
      channel,
      initialBudgetBytes: 16 * 1024,
      minBudgetBytes: 4 * 1024,
      maxBudgetBytes: 64 * 1024,
      fastParseMs: 0.5,
    });
    session.start();
    // Wait on the drain accounting (updated after parse), not just the bytes:
    // `terminal.bytes` rises inside write() while stats update a tick later.
    await waitFor(() => session.stats.bytesReceived === data.byteLength);
    expect(terminal.bytes).toBe(data.byteLength);

    expect(terminal.text()).toBe(new TextDecoder().decode(data));
    expect(session.stats.drains).toBeGreaterThan(1);
    expect(terminal.maxChunk).toBeLessThanOrEqual(64 * 1024);
    expect(session.stats.bytesReceived).toBe(data.byteLength);
    session.close();
  });

  test('backpressure: never has more than one batch in flight', async () => {
    const terminal = new FakeTerminal(3);
    const channel = new MockShellChannel();
    channel.enqueue(payload(64 * 1024));
    const session = new SshSession({
      terminal,
      channel,
      initialBudgetBytes: 8 * 1024,
      minBudgetBytes: 4 * 1024,
      maxBudgetBytes: 32 * 1024,
    });
    session.start();
    // Wait for the drain accounting (updated after parse), not just the bytes.
    await waitFor(() => session.stats.bytesReceived === 64 * 1024);
    // With one batch in flight, chunk count tracks drains exactly.
    expect(terminal.chunks.length).toBe(session.stats.drains);
    session.close();
  });

  test('delivers data that arrives while a parse is in flight', async () => {
    // Regression: a channel event during a slow parse used to be dropped when
    // the in-flight batch was smaller than the budget (lost wakeup), leaving
    // the new bytes queued forever.
    const terminal = new FakeTerminal(30);
    const channel = new MockShellChannel();
    channel.enqueue(encoder.encode('first'));
    const session = new SshSession({
      terminal,
      channel,
      initialBudgetBytes: 4096,
      minBudgetBytes: 1024,
      maxBudgetBytes: 4096,
      slowParseMs: 10,
    });
    session.start();
    await new Promise((resolve) => setTimeout(resolve, 8)); // parse in flight
    channel.enqueue(encoder.encode('second'));
    await waitFor(() => terminal.text() === 'firstsecond');
    session.close();
  });

  test('stops delivering after close', async () => {
    const terminal = new FakeTerminal(0);
    const channel = new MockShellChannel();
    channel.enqueue(encoder.encode('first'));
    const session = new SshSession({ terminal, channel, initialBudgetBytes: 4096 });
    session.start();
    await waitFor(() => terminal.bytes > 0);
    session.close();
    const seen = terminal.bytes;
    channel.enqueue(encoder.encode('second'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(terminal.bytes).toBe(seen);
  });
});

describe('SshSession: adaptive budget', () => {
  test('shrinks the budget when parses are slow', async () => {
    const terminal = new FakeTerminal(20);
    const channel = new MockShellChannel();
    channel.enqueue(payload(64 * 1024));
    const session = new SshSession({
      terminal,
      channel,
      initialBudgetBytes: 32 * 1024,
      minBudgetBytes: 4 * 1024,
      maxBudgetBytes: 64 * 1024,
      slowParseMs: 8,
    });
    session.start();
    await waitFor(() => session.stats.drains >= 3);
    expect(session.stats.budgetBytes).toBeLessThan(32 * 1024);
    expect(session.stats.budgetChanges).toBeGreaterThan(0);
    session.close();
  });

  test('grows the budget when parses are fast', async () => {
    const terminal = new FakeTerminal(0);
    const channel = new MockShellChannel();
    channel.enqueue(payload(256 * 1024));
    const session = new SshSession({
      terminal,
      channel,
      initialBudgetBytes: 4096,
      minBudgetBytes: 4096,
      maxBudgetBytes: 32 * 1024,
      fastParseMs: 2,
    });
    session.start();
    await waitFor(() => session.stats.drains >= 4);
    expect(session.stats.budgetBytes).toBeGreaterThan(4096);
    session.close();
  });
});

describe('SshSession: resize', () => {
  test('debounces window changes and keeps the latest size', async () => {
    const terminal = new FakeTerminal(0);
    const channel = new MockShellChannel();
    const session = new SshSession({ terminal, channel, resizeDebounceMs: 40 });
    session.resize(80, 24);
    session.resize(90, 30);
    session.resize(100, 40);
    expect(channel.resizes.length).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(channel.resizes).toEqual([{ cols: 100, rows: 40 }]);
    expect(session.stats.resizes).toBe(1);
    session.close();
  });
});

describe('MockShellChannel', () => {
  test('echoes input with CRLF and a prompt', () => {
    const channel = new MockShellChannel({ echo: true, prompt: '$ ' });
    channel.write(encoder.encode('ls\r'));
    const out = new Uint8Array(4096);
    const chunk = channel.read(4096);
    const text = new TextDecoder().decode(chunk ?? out.subarray(0, 0));
    expect(text).toBe('ls\r\n$ ');
    expect(channel.written.length).toBe(1);
  });

  test('records resizes and closes once', () => {
    const channel = new MockShellChannel();
    channel.resize(80, 24);
    expect(channel.resizes).toEqual([{ cols: 80, rows: 24 }]);
    let closes = 0;
    channel.onClose(() => closes++);
    channel.close();
    channel.close();
    expect(closes).toBe(1);
  });
});
