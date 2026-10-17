/**
 * End-to-end smoke test for the dev SSH server (no device required).
 *   bun run ssh-smoke
 */
import { createHash } from 'node:crypto';
import { Client } from 'ssh2';

const PORT = Number(process.env.SSH_TEST_PORT ?? 2222);
const host = process.env.SSH_TEST_HOST ?? '127.0.0.1';

let output = '';
let fingerprinted = false;
let commanded = false;

const connection = new Client();

const timeout = setTimeout(() => {
  console.error('TIMEOUT');
  process.exit(1);
}, 15_000);

connection
  .on('ready', () => {
    console.log('ready: authenticated');
    connection.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (error, stream) => {
      if (error) throw error;
      stream.on('data', (data: Buffer) => {
        output += data.toString();
        if (output.includes('$ ') && !commanded) {
          commanded = true;
          stream.write('hello world\r');
          // Second line exercises resize + a command.
          setTimeout(() => stream.write('size\r'), 150);
        }
        if (output.includes('size=120x40')) {
          clearTimeout(timeout);
          const ok = output.includes('you said: hello world') && output.includes('size=120x40');
          console.log(ok ? 'PASS' : 'FAIL');
          console.log('--- remote output ---');
          console.log(JSON.stringify(output));
          connection.end();
          process.exit(ok ? 0 : 1);
        }
      });
      stream.on('close', () => {
        if (!output.includes('size=120x40')) {
          console.error('channel closed early');
          process.exit(1);
        }
      });
      // ssh2's signature is (rows, cols, height, width).
      setTimeout(() => stream.setWindow(40, 120, 0, 0), 50);
    });
  })
  .on('error', (error) => {
    console.error('connection error:', error.message);
    process.exit(1);
  })
  .connect({
    host,
    port: PORT,
    username: 'test',
    password: 'shenterm',
    hostVerifier: (key: Buffer) => {
      const fingerprint = createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
      console.log('host key SHA256:' + fingerprint);
      fingerprinted = true;
      return true;
    },
  });

process.on('exit', (code) => {
  if (code !== 0) console.error('fingerprinted:', fingerprinted);
});
