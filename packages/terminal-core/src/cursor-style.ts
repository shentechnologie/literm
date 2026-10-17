/**
 * DECSCUSR (`CSI Ps SP q`) is NOT applied to `terminal.options` by the headless
 * build (verified: options.cursorStyle stays 'block' for every Ps), so the
 * renderer needs its own tracker. We observe the sequence, let the core handle
 * it as well (return false), and reset on RIS (`ESC c`).
 *
 * Ps mapping (xterm): 0/1 blinking block, 2 steady block, 3 blinking underline,
 * 4 steady underline, 5 blinking bar, 6 steady bar.
 */
import type { Terminal } from '@xterm/headless';
import type { CursorStyle } from './types';

export interface CursorStyleState {
  style: CursorStyle;
  blink: boolean;
}

const STYLES: Record<number, CursorStyle> = {
  0: 'block',
  1: 'block',
  2: 'block',
  3: 'underline',
  4: 'underline',
  5: 'bar',
  6: 'bar',
};

export class CursorStyleTracker {
  private state: CursorStyleState;
  private readonly defaultState: CursorStyleState;
  private disposables: { dispose(): void }[] = [];
  /** Called when the shape/blink changes so the UI can repaint. */
  onChange: (() => void) | undefined;

  constructor(private readonly term: Terminal) {
    const style = (term.options.cursorStyle ?? 'block') as CursorStyle;
    const blink = term.options.cursorBlink !== false;
    this.state = { style, blink };
    this.defaultState = { style, blink };
  }

  get current(): CursorStyleState {
    return this.state;
  }

  attach(): void {
    this.disposables.push(
      this.term.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, (params) => {
        const ps = typeof params[0] === 'number' ? params[0] : 0;
        const style = STYLES[ps] ?? this.defaultState.style;
        // Ps 0 means "default", which blinks; otherwise odd = blinking.
        const blink = ps === 0 ? this.defaultState.blink : ps % 2 === 1;
        if (style !== this.state.style || blink !== this.state.blink) {
          this.state = { style, blink };
          this.onChange?.();
        }
        return false; // let the core consume it too
      }),
      // RIS resets the cursor to the configured default.
      this.term.parser.registerEscHandler({ final: 'c' }, () => {
        this.state = { ...this.defaultState };
        this.onChange?.();
        return false;
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.onChange = undefined;
  }
}
