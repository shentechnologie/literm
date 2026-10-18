import type { NativeSecureShellBinding } from './types';

// `require` is provided by Metro (and Bun). Declared module-locally so this
// file's typing does not depend on which @types packages are installed.
declare const require: (moduleName: string) => unknown;

let cached: NativeSecureShellBinding | null = null;

/**
 * Resolve the native module lazily.
 *
 * Importing the library (or its tests, or a web build) must not pull
 * `expo-modules-core` — which imports React Native — into a runtime that has no
 * native module.
 */
export function getSecureShell(): NativeSecureShellBinding {
  if (cached) {
    return cached;
  }
  const core = require('expo-modules-core') as {
    requireNativeModule: <T>(name: string) => T;
  };
  cached = core.requireNativeModule<NativeSecureShellBinding>('SecureShell');
  return cached;
}
