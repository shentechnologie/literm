/**
 * xterm.js platform detection (module 701 in the headless bundle) assumes a
 * browser or Node:
 *
 *   const isNode = typeof process !== "undefined" && "title" in process;
 *   const userAgent = isNode ? "node" : navigator.userAgent;
 *   const platform  = isNode ? "node" : navigator.platform;
 *   isFirefox = userAgent.includes("Firefox");   // <-- throws in RN
 *
 * React Native defines `navigator.product` but NOT `userAgent` or `platform`,
 * and its `process` global has no `title`, so `isNode` is false and the
 * `.includes` call throws at import time:
 *
 *   TypeError: Cannot read property 'includes' of undefined
 *
 * This module must be evaluated BEFORE `@xterm/headless` is imported, so it is
 * the first import in session.ts (the only runtime import of xterm in this
 * package). It is idempotent and a no-op in Node/Bun/browsers.
 */

type NavigatorLike = Record<string, unknown>;

function ensure(name: 'userAgent' | 'platform', value: string): boolean {
  const globalObject = globalThis as unknown as { navigator?: NavigatorLike };
  let nav = globalObject.navigator;

  if (!nav) {
    try {
      nav = {};
      globalObject.navigator = nav;
    } catch {
      return false;
    }
  }

  if (typeof nav[name] === 'string' && nav[name] !== '') return true;

  try {
    nav[name] = value;
    if (typeof nav[name] === 'string') return true;
  } catch {
    // Navigator may be frozen or accessor-only; fall through to replacement.
  }

  try {
    Object.defineProperty(nav, name, { value, configurable: true, writable: true });
    return typeof nav[name] === 'string';
  } catch {
    return false;
  }
}

// Values only need to be strings that fail xterm's browser sniffing.
ensure('userAgent', 'ReactNative');
ensure('platform', 'ReactNative');

export {};
