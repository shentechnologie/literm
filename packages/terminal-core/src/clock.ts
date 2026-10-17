/**
 * Clock without assuming a global `performance` declaration, so the same code
 * typechecks in Bun (tests/bench), Hermes (app) and plain Node.
 */
const perf = (globalThis as { performance?: { now?: () => number } }).performance;

export const now: () => number =
  perf && typeof perf.now === 'function' ? () => perf.now!() : () => Date.now();
