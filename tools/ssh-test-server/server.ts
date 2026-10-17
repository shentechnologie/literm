/**
 * Local SSH target for development and integration tests.
 *
 *   bun run ssh-server            # 0.0.0.0:2222, test / shenterm
 *
 * Deliberately dependency-free of the app: the iOS simulator reaches it on
 * 127.0.0.1, the Android emulator on 10.0.2.2, and CI can use it in-process.
 *
 * The shell is a deterministic echo loop (no real pty process) so assertions
 * are stable:
 *   <line>       -> "you said: <line>"
 *   exit         -> closes the channel
 *   size         -> prints the last pty size seen
 *   clear        -> ANSI clear + home
 * PTY requests and window-change events are logged so resize wiring is visible.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Server, utils } from 'ssh2';

const PORT = Number(process.env.SSH_TEST_PORT ?? 2222);
const USER = process.env.SSH_TEST_USER ?? 'test';
const PASSWORD = process.env.SSH_TEST_PASSWORD ?? 'shenterm';

const devDir = join(import.meta.dir, '../../.dev');
mkdirSync(devDir, { recursive: true });
const keyPath = join(devDir, 'hostkey.pem');

let hostKey: Buffer;
if (existsSync(keyPath)) {
  hostKey = readFileSync(keyPath);
} else {
  // RSA keeps JSch/libssh2 compatibility boring; ed25519 can be tested with
  // SSH_TEST_KEY=ed25519 once both backends are in.
  const { private: privateKey } = utils.generateKeyPairSync('rsa', { bits: 3072 });
  hostKey = privateKey;
  writeFileSync(keyPath, privateKey, { mode: 0o600 });
}

const parsed = utils.parseKey(hostKey);
if (parsed instanceof Error) {
  console.error('could not parse host key:', parsed.message);
  process.exit(1);
}
const fingerprint = createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '');

const server = new Server({ hostKeys: [hostKey] }, (client) => {
  client.on('authentication', (ctx) => {
    if (ctx.method === 'password' && ctx.username === USER && ctx.password === PASSWORD) {
      ctx.accept();
      return;
    }
    ctx.reject(['password']);
  });

  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();
      let size = { cols: 80, rows: 24 };

      session.on('pty', (acceptPty, _reject, info) => {
        size = { cols: info.cols, rows: info.rows };
        console.log(`[pty] ${info.cols}x${info.rows} term=${info.term ?? '?'}`);
        acceptPty?.();
      });

      session.on('window-change', (_accept, _reject, info) => {
        size = { cols: info.cols, rows: info.rows };
        console.log(`[resize] ${info.cols}x${info.rows}`);
      });

      session.on('shell', (acceptShell) => {
        const stream = acceptShell();
        let line = '';
        const prompt = () => stream.write('\r\n$ ');
        stream.write(`shenterm ssh test server  ${size.cols}x${size.rows}\r\nSHA256:${fingerprint}\r\n$ `);

        stream.on('data', (data: Buffer) => {
          for (const char of data.toString('utf8')) {
            const code = char.codePointAt(0) ?? 0;
            if (char === '\r' || char === '\n') {
              const command = line.trim();
              line = '';
              if (command === 'exit') {
                stream.write('\r\nbye\r\n');
                stream.exit(0);
                stream.end();
                return;
              }
              if (command === 'size') {
                stream.write(`\r\nsize=${size.cols}x${size.rows}`);
                prompt();
                continue;
              }
              if (command === 'clear') {
                stream.write('\x1b[2J\x1b[H$ ');
                continue;
              }
              stream.write(`\r\nyou said: ${command}`);
              prompt();
            } else if (code === 127) {
              if (line.length > 0) {
                line = line.slice(0, -1);
                stream.write('\b \b');
              }
            } else if (code === 3) {
              line = '';
              stream.write('^C');
              prompt();
            } else if (code === 9 || code >= 32) {
              line += char;
              stream.write(char);
            }
          }
        });

        stream.on('close', () => {
          console.log('[shell] closed');
          client.end();
        });
      });
    });
  });

  client.on('error', (error) => console.log('[client error]', error.message));
});

server.on('error', (error) => {
  console.error('[server error]', error.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`shenterm ssh test server`);
  console.log(`  address:  0.0.0.0:${PORT}  (Android emulator: 10.0.2.2:${PORT})`);
  console.log(`  auth:     ${USER} / ${PASSWORD}`);
  console.log(`  host key: ${parsed.type}  SHA256:${fingerprint}`);
});
