#!/usr/bin/env bun
/**
 * Release artifact gate.
 *
 * Packs both published packages, asserts the tarballs contain exactly what the
 * packages need at runtime, runs publint + are-the-types-wrong, and smoke-tests
 * the core package from the packed tarball (CJS, ESM, and nodenext types).
 *
 * Run with `bun run release:verify` after `bun run build`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const bin = (name: string) => join(root, 'node_modules', '.bin', name);

type Check = {
  dir: string;
  name: string;
  budget: number;
  required: string[];
  forbidden: string[];
};

const packages: Check[] = [
  {
    dir: 'packages/terminal-core',
    name: '@literm/terminal-core',
    budget: 500 * 1024,
    required: [
      'package/LICENSE',
      'package/README.md',
      'package/package.json',
      'package/lib/commonjs/index.js',
      'package/lib/module/index.js',
      'package/lib/typescript/commonjs/src/index.d.ts',
      'package/lib/typescript/module/src/index.d.ts',
      'package/src/index.ts',
    ],
    forbidden: ['.gradle/', 'node_modules/', 'package/test/', '.DS_Store', 'coverage/'],
  },
  {
    dir: 'packages/react-native-terminal',
    name: '@literm/react-native-terminal',
    budget: 5 * 1024 * 1024,
    required: [
      'package/LICENSE',
      'package/README.md',
      'package/package.json',
      'package/expo-module.config.json',
      'package/android/build.gradle',
      'package/android/src/main/java/expo/modules/secureshell/SecureShellModule.kt',
      'package/ios/ReactNativeSecureShell.podspec',
      'package/ios/vendor/libssh2/COPYING',
      'package/ios/vendor/libssh2/src/kex.c',
      'package/ios/vendor/mbedtls/LICENSE',
      'package/lib/commonjs/index.js',
      'package/lib/module/index.js',
      'package/lib/typescript/commonjs/src/index.d.ts',
    ],
    forbidden: ['.gradle/', 'node_modules/', 'package/test/', '.DS_Store', 'coverage/'],
  },
];

const failures: string[] = [];
const pass = (message: string) => console.log(`  ok  ${message}`);
const fail = (message: string) => {
  failures.push(message);
  console.error(`  FAIL ${message}`);
};

function run(command: string, args: string[], cwd: string) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function listTarball(tgz: string) {
  return run('tar', ['-tzf', tgz], root)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const temp = mkdtempSync(join(tmpdir(), 'literm-verify-'));

try {
  for (const pkg of packages) {
    console.log(`\n${pkg.name}`);

    const pkgDir = join(root, pkg.dir);
    const packOutput = run('npm', ['pack', '--pack-destination', temp, '--silent'], pkgDir).trim();
    const tgzName = packOutput.split('\n').filter(Boolean).pop();
    if (!tgzName) {
      fail(`${pkg.name}: npm pack produced no filename`);
      continue;
    }
    const tgz = join(temp, tgzName);
    const size = statSync(tgz).size;
    const human = `${(size / 1024).toFixed(0)} KB`;

    if (size > pkg.budget) {
      fail(`${pkg.name}: tarball is ${human} (budget ${(pkg.budget / 1024).toFixed(0)} KB)`);
    } else {
      pass(`tarball ${human}`);
    }

    const files = listTarball(tgz);
    for (const required of pkg.required) {
      if (files.includes(required)) pass(required);
      else fail(`${pkg.name}: missing ${required}`);
    }
    for (const forbidden of pkg.forbidden) {
      const hit = files.find((file) => file.includes(forbidden));
      if (hit) fail(`${pkg.name}: ships ${hit}`);
    }

    try {
      run(bin('publint'), ['--strict'], pkgDir);
      pass('publint');
    } catch (error) {
      fail(`${pkg.name}: publint\n${String(error)}`);
    }

    try {
      const output = run(bin('attw'), ['--pack', '.', '--format', 'ascii'], pkgDir);
      if (output.includes('No problems found')) pass('attw');
      else fail(`${pkg.name}: attw reported problems\n${output}`);
    } catch (error) {
      fail(`${pkg.name}: attw\n${String(error)}`);
    }
  }

  // Smoke the core tarball in a clean consumer: CJS, ESM and nodenext types.
  console.log('\n@literm/terminal-core consumer smoke');
  const coreTgz = join(
    temp,
    `literm-terminal-core-${JSON.parse(readFileSync(join(root, 'packages/terminal-core/package.json'), 'utf8')).version}.tgz`,
  );
  const consumer = join(temp, 'consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true }, null, 2),
  );
  try {
    run('npm', ['install', coreTgz, '--no-audit', '--no-fund', '--silent'], consumer);
    run(
      'node',
      [
        '-e',
        "const c=require('@literm/terminal-core'); new c.TerminalSession({cols:80,rows:24}); console.log('cjs')",
      ],
      consumer,
    );
    pass('CJS require');
    run(
      'node',
      [
        '--input-type=module',
        '-e',
        "import { TerminalSession } from '@literm/terminal-core'; new TerminalSession({cols:80,rows:24}); console.log('esm')",
      ],
      consumer,
    );
    pass('ESM import');

    writeFileSync(
      join(consumer, 'index.ts'),
      [
        "import { TerminalSession, type Theme } from '@literm/terminal-core';",
        'const terminal = new TerminalSession({ cols: 80, rows: 24 });',
        'const theme: Theme = terminal.theme;',
        'console.log(theme, terminal.term.rows);',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            module: 'nodenext',
            moduleResolution: 'nodenext',
            strict: true,
            skipLibCheck: false,
            noEmit: true,
          },
          include: ['index.ts'],
        },
        null,
        2,
      ),
    );
    run(bin('tsc'), ['-p', 'tsconfig.json'], consumer);
    pass('nodenext types');
  } catch (error) {
    fail(`consumer smoke\n${String(error)}`);
  }
} finally {
  if (process.env.KEEP_VERIFY_TMP) console.error(`\nartifacts kept at ${temp}`);
  else rmSync(temp, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nrelease verification failed (${failures.length})`);
  process.exit(1);
}
console.log('\nrelease verification passed');
