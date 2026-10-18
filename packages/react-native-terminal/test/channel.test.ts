/**
 * SecureShellChannel + a terminal drain loop against the mock native binding.
 *
 * These pin the JS/native contract (pull reads, wake-up events, event filtering
 * by sessionId, close propagation) that the Swift/Kotlin modules implement.
 */
import { describe, expect, test } from 'bun:test';
import { SshSession, type TerminalSink } from '@literm/terminal-core';
import { MockNativeSecureShellBinding } from '../src/mock-native';
import { SecureShellChannel } from '../src/channel';

const encoder = new TextEncoder();

class FakeTerminal implements TerminalSink {
  chunks: Uint8Array[] = [];
  bytes = 0;
  write(data: string | Uint8Array, onParsed?: () => void): void {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    this.chunks.push(bytes);
    this.bytes += bytes.byteLength;
    onParsed?.();
  }
  resize(): void {}
  text(): string {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(out);
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 1500): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('SecureShellChannel', () => {
  test('echo round trip through a drain loop', async () => {
    const native = new MockNativeSecureShellBinding();
    const sessionId = native.openEchoShell(80, 24, 'welcome\r\n');
    const channel = new SecureShellChannel(native, sessionId);
    const terminal = new FakeTerminal();
    const ssh = new SshSession({ terminal, channel, initialBudgetBytes: 4096 });
    ssh.start();

    await waitFor(() => terminal.text().includes('welcome'));

    channel.write(encoder.encode('ls -la\r'));
    await waitFor(() => terminal.text().includes('ls -la\r\n'));
    expect(terminal.text()).toBe('welcome\r\nls -la\r\n');
    ssh.close();
  });

  test('backspace is translated by the native echo', async () => {
    const native = new MockNativeSecureShellBinding();
    const channel = new SecureShellChannel(native, native.openEchoShell(80, 24, ''));
    const terminal = new FakeTerminal();
    const ssh = new SshSession({ terminal, channel, initialBudgetBytes: 4096 });
    ssh.start();

    channel.write(encoder.encode('ab\u007f'));
    await waitFor(() => terminal.text().includes('ab'));
    expect(terminal.text()).toBe('ab\u0008 \u0008');
    ssh.close();
  });

  test('wake-up events are filtered by sessionId', () => {
    const native = new MockNativeSecureShellBinding();
    const first = native.openEchoShell(80, 24, 'one\r\n');
    const second = native.openEchoShell(80, 24, 'two\r\n');
    const channelOne = new SecureShellChannel(native, first);
    const channelTwo = new SecureShellChannel(native, second);

    let oneEvents = 0;
    let twoEvents = 0;
    channelOne.onDataAvailable(() => oneEvents++);
    channelTwo.onDataAvailable(() => twoEvents++);

    native.enqueue(first, encoder.encode('extra\r\n'));
    expect(oneEvents).toBe(1);
    expect(twoEvents).toBe(0);
    channelOne.close();
    channelTwo.close();
  });

  test('close propagates with a reason and detaches listeners', () => {
    const native = new MockNativeSecureShellBinding();
    const channel = new SecureShellChannel(native, native.openEchoShell(80, 24, ''));
    const reasons: string[] = [];
    channel.onClose((reason) => reasons.push(reason.type));

    channel.close();
    expect(reasons).toEqual(['closed']);
    expect(native.closed).toEqual([channel.id]);
    expect(native.hasSession(channel.id)).toBe(false);
    // Idempotent.
    channel.close();
    expect(reasons).toEqual(['closed']);
  });

  test('resize is forwarded to the native side', () => {
    const native = new MockNativeSecureShellBinding();
    const channel = new SecureShellChannel(native, native.openEchoShell(80, 24, ''));
    channel.resize(120, 40);
    expect(native.resizes).toEqual([{ sessionId: channel.id, cols: 120, rows: 40 }]);
    channel.close();
  });
});
