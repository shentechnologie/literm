/**
 * `@xterm/headless` interop.
 *
 * It is a CommonJS package with no ESM default export, and it ships an ESM
 * build (`lib/xterm.mjs`) that bundlers pick up via the `module` field. That
 * makes the three consumers disagree:
 *
 *  - Metro resolves `main` (CJS): a namespace import exposes `Terminal`.
 *  - Web bundlers resolve `module` (ESM): the namespace has named `Terminal`.
 *  - Node ESM resolves `main` (CJS) and cannot statically see the named
 *    exports, so only `default` (module.exports) carries `Terminal`.
 *
 * Import the whole namespace and read `Terminal` off whichever shape is
 * present, so one build works everywhere.
 */
import * as xterm from '@xterm/headless';

export type Terminal = xterm.Terminal;

const shapes = xterm as unknown as {
  Terminal?: typeof xterm.Terminal;
  default?: { Terminal?: typeof xterm.Terminal };
};

export const Terminal: typeof xterm.Terminal =
  shapes.Terminal ?? shapes.default?.Terminal ?? (undefined as unknown as typeof xterm.Terminal);
