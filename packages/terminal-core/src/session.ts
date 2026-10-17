/**
 * TerminalSession: xterm-headless + shadow grid + dirty notification.
 *
 * This is the seam the UI/renderer talks to. Transport is deliberately NOT
 * part of this class: in P0 there is no SSH, so `inject()` provides local
 * echo. In P1 the session gains a `Transport` and `inject()` becomes
 * `transport.write()`; the render path stays identical.
 */
// MUST be imported before @xterm/headless: xterm's platform detection throws
// under Hermes when navigator.userAgent is missing. See platform-shim.ts.
import './platform-shim';
import { Terminal } from '@xterm/headless';
import { now } from './clock';
import { CursorStyleTracker } from './cursor-style';
import { ShadowGrid } from './shadow-grid';
import { defaultTheme, Palette } from './theme';
import type { FrameData, Theme, Unsubscribe } from './types';

export interface TerminalSessionOptions {
  cols?: number;
  rows?: number;
  scrollback?: number;
  theme?: Theme;
}

export interface SessionStats {
  bytesWritten: number;
  /** Cumulative time spent inside xterm's parser, ms. */
  parseMs: number;
  /** Number of parser callbacks (one per write burst). */
  writes: number;
  /** Time of the most recent frame build, ms. */
  lastFrameMs: number;
  /** Cumulative time spent building frames, ms. */
  frameMs: number;
  frames: number;
  /** Rows rebuilt in the most recent frame. */
  lastDirtyRows: number;
}

export class TerminalSession {
  readonly term: Terminal;
  palette: Palette;
  theme: Theme;
  readonly stats: SessionStats = {
    bytesWritten: 0,
    parseMs: 0,
    writes: 0,
    lastFrameMs: 0,
    frameMs: 0,
    frames: 0,
    lastDirtyRows: 0,
  };

  private grid: ShadowGrid;
  private cursorStyle: CursorStyleTracker;
  private listeners = new Set<() => void>();
  private disposables: { dispose(): void }[] = [];
  private disposed = false;

  constructor(options: TerminalSessionOptions = {}) {
    const cols = options.cols ?? 80;
    const rows = options.rows ?? 24;
    this.theme = options.theme ?? defaultTheme;
    this.palette = new Palette(this.theme);
    this.grid = new ShadowGrid(cols, rows, this.palette);
    this.term = new Terminal({
      cols,
      rows,
      scrollback: options.scrollback ?? 5000,
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: true,
      logLevel: 'off',
    });

    // DECSCUSR is not reflected in options by the headless build; track it.
    this.cursorStyle = new CursorStyleTracker(this.term);
    this.cursorStyle.onChange = () => this.markDirty();
    this.cursorStyle.attach();
    this.grid = new ShadowGrid(cols, rows, this.palette, () => this.cursorStyle.current);

    // Anything that can change pixels wakes the renderer. The renderer decides
    // whether a frame is actually needed (it compares the resulting cursor and
    // dirty list), so over-notifying is harmless.
    this.disposables.push(
      this.term.onWriteParsed(() => this.markDirty()),
      this.term.onScroll(() => this.markDirty()),
      this.term.onCursorMove(() => this.markDirty()),
      this.term.onResize(() => this.markDirty()),
      this.term.buffer.onBufferChange(() => this.markDirty()),
    );
  }

  /** Subscribe to "something changed; consider painting a frame". */
  onDirty(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Feed bytes from the transport into the parser. */
  write(data: string | Uint8Array): void {
    const t0 = now();
    const bytes = typeof data === 'string' ? data.length : data.byteLength;
    this.stats.bytesWritten += bytes;
    this.term.write(data, () => {
      this.stats.writes++;
      this.markDirty();
    });
    // Only the synchronous slice is measured here: xterm's WriteBuffer parses
    // in batches and defers the rest to timers, and that deferred work is what
    // keeps the JS thread responsive during floods. This number is therefore
    // "how long the parser blocked this call", which is the jank-relevant one.
    this.stats.parseMs += now() - t0;
  }

  /**
   * P0 only: local echo, standing in for the SSH transport.
   * Echoes displayable text and handles CR/LF like a cooked terminal would.
   */
  inject(data: string): void {
    this.write(data);
  }

  /** Build the frame for the current viewport state. */
  frame(): FrameData {
    const frame = this.grid.sync(this.term);
    this.stats.lastFrameMs = frame.buildMs;
    this.stats.frameMs += frame.buildMs;
    this.stats.frames++;
    this.stats.lastDirtyRows = frame.dirty.length;
    return frame;
  }

  resize(cols: number, rows: number): void {
    if (cols === this.term.cols && rows === this.term.rows) return;
    this.term.resize(cols, rows);
    this.grid.resize(cols, rows);
    this.markDirty();
  }

  scrollLines(amount: number): void {
    this.term.scrollLines(amount);
    this.markDirty();
  }

  scrollToBottom(): void {
    this.term.scrollToBottom();
    this.markDirty();
  }

  /** Force a full repaint (theme change, font change, remount). */
  invalidate(): void {
    this.grid.invalidate();
    this.markDirty();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.palette = new Palette(theme);
    this.grid.setPalette(this.palette);
    this.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.cursorStyle.dispose();
    this.listeners.clear();
    this.term.dispose();
  }

  private markDirty(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }
}
