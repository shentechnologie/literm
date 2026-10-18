/**
 * RN Skia's typings extend `Disposable` for JSI objects, but not every object
 * actually exposes `dispose()` at runtime (verified on iOS: SkParagraphBuilder
 * does not, and calling it crashes the render loop). Dispose defensively.
 */
export function safeDispose(value: unknown): void {
  if (!value) return;
  const dispose = (value as { dispose?: unknown }).dispose;
  if (typeof dispose !== 'function') return;
  try {
    (dispose as () => void).call(value);
  } catch {
    // Already disposed, or the underlying object was collected.
  }
}
