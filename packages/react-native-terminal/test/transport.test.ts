/**
 * The native-module package's transport (`SecureShellTransport`) over the
 * reusable `@literm/react-native-terminal` connection API. The deep host-key
 * staging tests live in that package; here we pin type translation and the
 * transport contract in `@literm/terminal-core`.
 */
import { describe, expect, test } from 'bun:test';
import { SshSession, type TerminalSink } from '@literm/terminal-core';
import { MockNativeSecureShellBinding } from '../src/mock-native';
import { SecureShellTransport } from '../src/transport';

const encoder = new TextEncoder();

class FakeTerminal implements TerminalSink {
  chunks: Uint8Array[] = [];
  write(data: string | Uint8Array, onParsed?: () => void): void {
    this.chunks.push(typeof data === 'string' ? encoder.encode(data) : data);
    onParsed?.();
  }
  resize(): void {}
  text(): string {
    return new TextDecoder().decode(
      this.chunks.reduce((all, chunk) => {
        const merged = new Uint8Array(all.length + chunk.length);
        merged.set(all);
        merged.set(chunk, all.length);
        return merged;
      }, new Uint8Array(0)),
    );
  }
}

function password(host = 'example.test'): Parameters<SecureShellTransport['connect']>[0] {
  return {
    host,
    port: 2222,
    username: 'test',
    auth: { type: 'password', password: 'shenterm' },
    verifyHostKey: () => true,
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('SecureShellTransport', () => {
  test('connect resolves and reports connected', async () => {
    const native = new MockNativeSecureShellBinding();
    const transport = new SecureShellTransport(native);
    await transport.connect(password());
    expect(transport.isConnected).toBe(true);
    expect(native.hostKeyResponses).toEqual([{ sessionId: expect.any(String), accept: true }]);
    transport.dispose();
  });

  test('declining the key rejects', async () => {
    const native = new MockNativeSecureShellBinding();
    const transport = new SecureShellTransport(native);
    await expect(transport.connect({ ...password(), verifyHostKey: () => false })).rejects.toThrow(
      /rejected/,
    );
    expect(transport.isConnected).toBe(false);
    transport.dispose();
  });

  test('key auth is translated to the library private-key auth', async () => {
    const native = new MockNativeSecureShellBinding({ privateKey: 'PEM' });
    const transport = new SecureShellTransport(native);
    await transport.connect({
      ...password(),
      auth: { type: 'key', privateKey: 'PEM', passphrase: 'secret' },
    });
    expect(transport.isConnected).toBe(true);
    transport.dispose();
  });

  test('unsupported auth is rejected before touching the native side', async () => {
    const native = new MockNativeSecureShellBinding();
    const transport = new SecureShellTransport(native);
    await expect(transport.connect({ ...password(), auth: { type: 'agent' } })).rejects.toThrow(
      /not implemented/,
    );
    expect(native.hostKeyResponses.length).toBe(0);
    transport.dispose();
  });

  test('openShell before connect throws', async () => {
    const native = new MockNativeSecureShellBinding();
    const transport = new SecureShellTransport(native);
    await expect(transport.openShell({ cols: 80, rows: 24 })).rejects.toThrow(/not connected/);
    transport.dispose();
  });

  test('openShell returns a channel that drains into a terminal', async () => {
    const native = new MockNativeSecureShellBinding();
    const transport = new SecureShellTransport(native);
    await transport.connect(password());
    const channel = await transport.openShell({ cols: 100, rows: 30 });
    expect(native.openedShells).toEqual([{ sessionId: channel.id, cols: 100, rows: 30 }]);

    const terminal = new FakeTerminal();
    const ssh = new SshSession({ terminal, channel, initialBudgetBytes: 4096 });
    ssh.start();
    await waitFor(() => terminal.text().includes('shenterm secure shell'));
    channel.write(encoder.encode('echo hi\r'));
    await waitFor(() => terminal.text().includes('echo hi\r\n'));
    ssh.close();
    transport.dispose();
  });

  test('disconnect notifies onClose', async () => {
    const native = new MockNativeSecureShellBinding();
    const transport = new SecureShellTransport(native);
    await transport.connect(password());
    const reasons: string[] = [];
    transport.onClose((reason) => reasons.push(reason.type));
    transport.disconnect();
    expect(reasons).toEqual(['closed']);
    expect(transport.isConnected).toBe(false);
    transport.dispose();
  });
});
