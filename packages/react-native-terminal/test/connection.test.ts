/**
 * Staged connection tests: the host key must be approved by JS *before* the
 * native side authenticates. These run against the mock binding, so they pin
 * exactly what the iOS (libssh2) and Android (JSch) backends must implement.
 */
import { describe, expect, test } from 'bun:test';
import { SshSession, type TerminalSink } from '@literm/terminal-core';
import { MockNativeSecureShellBinding } from '../src/mock-native';
import { connect, openEchoShell } from '../src/connection';
import type { ConnectOptions } from '../src/types';

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

function password(host = 'example.test'): ConnectOptions {
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

describe('connect: host key staging', () => {
  test('resolves only after the verifier approves the key', async () => {
    const native = new MockNativeSecureShellBinding();
    const seen: { fingerprint: string | null } = { fingerprint: null };

    const connection = await connect(
      {
        ...password(),
        verifyHostKey: (key) => {
          seen.fingerprint = `${key.algorithm} ${key.sha256}`;
          return true;
        },
      },
      native,
    );

    expect(seen.fingerprint).toBe('ssh-ed25519 MOCKFINGERPRINT');
    expect(native.hostKeyResponses).toEqual([{ sessionId: expect.any(String), accept: true }]);
    expect(connection.isConnected).toBe(true);
    connection.dispose();
  });

  test('declining the key rejects and never authenticates', async () => {
    const native = new MockNativeSecureShellBinding();
    await expect(connect({ ...password(), verifyHostKey: () => false }, native)).rejects.toThrow(
      /host key .* rejected/,
    );
    expect(native.hostKeyResponses[0]?.accept).toBe(false);
    expect(native.hasSession(native.hostKeyResponses[0]!.sessionId)).toBe(false);
  });

  test('a throwing verifier is treated as a rejection', async () => {
    const native = new MockNativeSecureShellBinding();
    await expect(
      connect(
        {
          ...password(),
          verifyHostKey: () => {
            throw new Error('known_hosts unreadable');
          },
        },
        native,
      ),
    ).rejects.toThrow(/rejected/);
  });

  test('async verifiers are awaited', async () => {
    const native = new MockNativeSecureShellBinding();
    const seen = { called: false };
    const connection = await connect(
      {
        ...password(),
        verifyHostKey: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          seen.called = true;
          return true;
        },
      },
      native,
    );
    expect(seen.called).toBe(true);
    expect(connection.isConnected).toBe(true);
    connection.dispose();
  });

  test('authentication failure surfaces as a connect rejection', async () => {
    const native = new MockNativeSecureShellBinding();
    await expect(
      connect(
        { ...password(), auth: { type: 'password', password: 'wrong' }, verifyHostKey: () => true },
        native,
      ),
    ).rejects.toThrow(/authentication failed/);
  });

  test('private key auth is passed through', async () => {
    const native = new MockNativeSecureShellBinding({ privateKey: 'KEY-PEM' });
    const connection = await connect(
      {
        ...password(),
        auth: { type: 'key', privateKey: 'KEY-PEM', passphrase: 'phrase' },
      },
      native,
    );
    expect(connection.isConnected).toBe(true);
    connection.dispose();
  });
});

describe('connect: shell', () => {
  test('openShell before connect throws', async () => {
    const native = new MockNativeSecureShellBinding();
    const connection = await connect(password(), native);
    connection.disconnect();
    await expect(connection.openShell({ cols: 80, rows: 24 })).rejects.toThrow(/not connected/);
  });

  test('openShell returns a shell that drains into a terminal', async () => {
    const native = new MockNativeSecureShellBinding();
    const connection = await connect(password(), native);
    const channel = await connection.openShell({ cols: 100, rows: 30 });
    expect(native.openedShells).toEqual([{ sessionId: channel.id, cols: 100, rows: 30 }]);

    const terminal = new FakeTerminal();
    const ssh = new SshSession({ terminal, channel, initialBudgetBytes: 4096 });
    ssh.start();
    await waitFor(() => terminal.text().includes('shenterm secure shell'));
    channel.write(encoder.encode('echo hi\r'));
    await waitFor(() => terminal.text().includes('echo hi\r\n'));
    ssh.close();
    connection.dispose();
  });

  test('disconnect notifies onClose', async () => {
    const native = new MockNativeSecureShellBinding();
    const connection = await connect(password(), native);
    const reasons: string[] = [];
    connection.onClose((reason) => reasons.push(reason.type));
    connection.disconnect();
    expect(reasons).toEqual(['closed']);
    expect(connection.isConnected).toBe(false);
  });
});

describe('openEchoShell', () => {
  test('returns a usable channel over the echo binding', async () => {
    const native = new MockNativeSecureShellBinding();
    const channel = openEchoShell(80, 24, 'lab\r\n', native);
    const terminal = new FakeTerminal();
    const ssh = new SshSession({ terminal, channel, initialBudgetBytes: 4096 });
    ssh.start();
    await waitFor(() => terminal.text().includes('lab'));
    channel.close();
    ssh.close();
  });
});
