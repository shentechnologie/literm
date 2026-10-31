/**
 * prepublishOnly guard.
 *
 * The root release command builds both packages in dependency order and the
 * release gate verifies the artifacts. Rebuilding inside prepublishOnly is
 * unsafe: changeset publish runs packages concurrently, and RN's type build
 * reads terminal-core's freshly cleaned lib/typescript. This check fails fast
 * if the package was not built first.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const required = [
  'lib/commonjs/index.js',
  'lib/module/index.js',
  'lib/typescript/commonjs/src/index.d.ts',
  'lib/typescript/module/src/index.d.ts',
];

const missing = required.filter((file) => !existsSync(join(root, file)));

if (missing.length > 0) {
  console.error(
    `[prepublishOnly] ${pkg.name} is not built. Run \`bun run build\` (or \`bun run release:verify\`) first. Missing:`,
  );
  for (const file of missing) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(`[prepublishOnly] ${pkg.name}@${pkg.version} is built`);
