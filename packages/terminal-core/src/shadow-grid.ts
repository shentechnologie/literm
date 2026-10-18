/**
 * ShadowGrid: the render-side diff engine.
 *
 * xterm-headless parses escape sequences but tells us nothing about *which*
 * rows changed, so we keep a shadow copy of the visible viewport (flat typed
 * arrays: no per-cell allocation) and compare it against the live buffer.
 *
 * Cost is O(visible cells) per dirty frame (~6k cells at 120x50) with only
 * integer compares on the hot path. Row snapshots (runs, strings) are rebuilt
 * only for rows that actually changed, and the renderer caches a SkPicture per
 * absolute line index + content hash, so a scroll frame reuses almost every
 * row picture.
 */
import type { Terminal } from '@xterm/headless';
import {
  activeBuffer,
  cellFlags,
  isAscii,
  mix,
  mixString,
  type XBuffer,
  type XCell,
  type XLine,
} from './buffer';
import { now } from './clock';
import type { Palette } from './theme';
import type { CursorStyleState } from './cursor-style';
import {
  FLAG,
  type CellRun,
  type CursorState,
  type CursorStyle,
  type FrameData,
  type RowSnapshot,
} from './types';

interface Slot {
  /** Absolute buffer line index currently occupying this viewport slot. */
  y: number;
  snap: RowSnapshot;
}

const EMPTY_ROW: RowSnapshot = {
  y: -1,
  hash: 0,
  text: '',
  isWrapped: false,
  runs: [],
  bufferLength: 0,
};

export class ShadowGrid {
  cols: number;
  rows: number;

  private palette: Palette;
  private slots: Slot[];
  private cursorStyle: (() => CursorStyleState) | undefined;

  /** Per-cell shadow state, indexed `slot * cols + x`. */
  private prevCode: Int32Array;
  private prevWidth: Int8Array;
  private prevFlags: Int32Array;
  private prevFg: Int32Array;
  private prevBg: Int32Array;
  /** Line length per slot, so shrinking lines are detected. */
  private prevLineLen: Int32Array;

  private lastViewportY = -1;
  private lastBufferLength = -1;
  private forceAll = true;

  /** Scratch cell reused for every getCell call. */
  private cell: XCell | null = null;

  constructor(cols: number, rows: number, palette: Palette, cursorStyle?: () => CursorStyleState) {
    this.cols = cols;
    this.rows = rows;
    this.palette = palette;
    this.cursorStyle = cursorStyle;
    this.slots = new Array<Slot>(rows);
    for (let i = 0; i < rows; i++) this.slots[i] = { y: -1, snap: EMPTY_ROW };
    this.prevCode = new Int32Array(cols * rows);
    this.prevWidth = new Int8Array(cols * rows);
    this.prevFlags = new Int32Array(cols * rows);
    this.prevFg = new Int32Array(cols * rows);
    this.prevBg = new Int32Array(cols * rows);
    this.prevLineLen = new Int32Array(rows).fill(-1);
  }

  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.prevCode = new Int32Array(n);
    this.prevWidth = new Int8Array(n);
    this.prevFlags = new Int32Array(n);
    this.prevFg = new Int32Array(n);
    this.prevBg = new Int32Array(n);
    this.prevLineLen = new Int32Array(rows).fill(-1);
    this.slots = new Array<Slot>(rows);
    for (let i = 0; i < rows; i++) this.slots[i] = { y: -1, snap: EMPTY_ROW };
    this.forceAll = true;
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.forceAll = true; // colors must be re-resolved
  }

  /** Force every visible row to be rebuilt on the next sync. */
  invalidate(): void {
    this.forceAll = true;
  }

  sync(term: Terminal): FrameData {
    const t0 = now();
    const buf = activeBuffer(term);
    const cols = this.cols;
    const rows = this.rows;
    const viewportY = buf.viewportY;
    const bufferLength = buf.length;
    if (!this.cell) this.cell = buf.getNullCell();
    const cell = this.cell;

    const dirty: number[] = [];
    const bufferChanged =
      this.forceAll || bufferLength !== this.lastBufferLength || viewportY !== this.lastViewportY;
    this.forceAll = false;
    this.lastBufferLength = bufferLength;
    this.lastViewportY = viewportY;

    const fgDefault = this.palette.foreground;
    const bgDefault = this.palette.background;

    for (let i = 0; i < rows; i++) {
      const abs = viewportY + i;
      const line = buf.getLine(abs);
      const length = line ? line.length : 0;
      const base = i * cols;
      const slot = this.slots[i]!;
      const lineLenChanged = this.prevLineLen[i] !== length;
      // A slot that moved to a different line has no valid shadow state. The
      // comparisons below still run (cheap) but we must rebuild regardless.
      const slotMoved = slot.y !== abs;
      let rowDirty = bufferChanged || slotMoved || lineLenChanged;

      if (!rowDirty) {
        // Fast reject using per-cell integer compares only.
        for (let x = 0; x < cols; x++) {
          const idx = base + x;
          let code = 32;
          let width = 1;
          let flags = 0;
          let fg = fgDefault;
          let bg = bgDefault;
          if (line && x < length) {
            const c = line.getCell(x, cell);
            if (c) {
              width = c.getWidth();
              code = c.getCode();
              flags = cellFlags(c);
              if (width === 2) flags |= FLAG.WIDE;
              const colors = this.palette.resolve(c, flags);
              fg = colors.fg;
              bg = colors.bg;
            }
          }
          if (
            this.prevCode[idx] !== code ||
            this.prevWidth[idx] !== width ||
            this.prevFlags[idx] !== flags ||
            this.prevFg[idx] !== fg ||
            this.prevBg[idx] !== bg
          ) {
            rowDirty = true;
            break;
          }
        }
      }

      if (rowDirty) {
        // Refresh the whole slot (and its shadow state).
        for (let x = 0; x < cols; x++) {
          const idx = base + x;
          let code = 32;
          let width = 1;
          let flags = 0;
          let fg = fgDefault;
          let bg = bgDefault;
          if (line && x < length) {
            const c = line.getCell(x, cell);
            if (c) {
              width = c.getWidth();
              code = c.getCode();
              flags = cellFlags(c);
              if (width === 2) flags |= FLAG.WIDE;
              const colors = this.palette.resolve(c, flags);
              fg = colors.fg;
              bg = colors.bg;
            }
          }
          this.prevCode[idx] = code;
          this.prevWidth[idx] = width;
          this.prevFlags[idx] = flags;
          this.prevFg[idx] = fg;
          this.prevBg[idx] = bg;
        }
        this.prevLineLen[i] = length;
        slot.y = abs;
        slot.snap = this.buildRow(i, abs, line, length, cell, bufferLength, fgDefault, bgDefault);
        dirty.push(i);
      } else {
        slot.y = abs;
      }
    }

    const cursor = this.buildCursor(term, buf, viewportY);
    const snapshots = new Array<RowSnapshot>(rows);
    for (let i = 0; i < rows; i++) snapshots[i] = this.slots[i]!.snap;

    return {
      rows: snapshots,
      dirty,
      cursor,
      viewportY,
      cols,
      rowsCount: rows,
      altBuffer: buf.type === 'alternate',
      buildMs: now() - t0,
    };
  }

  /**
   * Build a styled row from the freshly written shadow state.
   * Trailing default-styled blanks are dropped: the renderer paints the theme
   * background once, so they would be pure overhead.
   */
  private buildRow(
    slotIndex: number,
    abs: number,
    line: XLine | undefined,
    length: number,
    cell: XCell,
    bufferLength: number,
    fgDefault: number,
    bgDefault: number,
  ): RowSnapshot {
    const cols = this.cols;
    const base = slotIndex * cols;

    let end = 0;
    for (let x = 0; x < cols; x++) {
      const idx = base + x;
      const width = this.prevWidth[idx]!;
      if (width === 0) continue; // wide-char tail
      // xterm reports cells past the written content with code 0 (empty chars)
      // and real spaces as code 32, so both count as blank.
      const blank =
        this.prevCode[idx]! <= 32 &&
        this.prevFlags[idx] === 0 &&
        this.prevFg[idx] === fgDefault &&
        this.prevBg[idx] === bgDefault;
      if (!blank) end = x + (width > 1 ? width : 1);
    }

    const runs: CellRun[] = [];
    let hash = 0x811c9dc5;

    if (end > 0) {
      let x = 0;
      while (x < end) {
        const idx = base + x;
        if (this.prevWidth[idx] === 0) {
          x++;
          continue;
        }
        const flags = this.prevFlags[idx]!;
        const fg = this.prevFg[idx]!;
        const bg = this.prevBg[idx]!;
        let text = '';
        let width = 0;
        let ascii = true;
        let xx = x;
        while (xx < end) {
          const ii = base + xx;
          const w = this.prevWidth[ii]!;
          if (w === 0) {
            xx++;
            continue;
          }
          if (this.prevFlags[ii] !== flags || this.prevFg[ii] !== fg || this.prevBg[ii] !== bg) {
            break;
          }
          const c = line && xx < length ? line.getCell(xx, cell) : undefined;
          let chars = c ? c.getChars() : '';
          if (!chars) chars = ' ';
          text += chars;
          if (ascii && !isAscii(chars)) ascii = false;
          width += w > 1 ? w : 1;
          xx++;
        }
        const run: CellRun = { x, width, text, fg, bg, flags, ascii };
        runs.push(run);
        hash = mix(hash, 0x9e3779b9 ^ x);
        hash = mix(hash, flags);
        hash = mix(hash, fg);
        hash = mix(hash, bg);
        hash = mixString(hash, text);
        x = xx;
      }
    }

    return {
      y: abs,
      hash: hash >>> 0,
      text: line ? line.translateToString(true) : '',
      isWrapped: line?.isWrapped ?? false,
      runs,
      bufferLength,
    };
  }

  private buildCursor(term: Terminal, buf: XBuffer, viewportY: number): CursorState {
    // cursorY is page-relative (0 at baseY), so convert to a viewport row.
    const absY = buf.baseY + buf.cursorY;
    const screenY = absY - viewportY;
    const visible = screenY >= 0 && screenY < this.rows;
    const shape = this.cursorStyle?.() ?? {
      style: (term.options.cursorStyle ?? 'block') as CursorStyle,
      blink: term.options.cursorBlink !== false,
    };
    const style = shape.style;
    const blink = shape.blink;
    const x = buf.cursorX;
    let hash = 0x811c9dc5;
    hash = mix(hash, x);
    hash = mix(hash, screenY);
    hash = mix(hash, visible ? 1 : 0);
    hash = mixString(hash, style);
    hash = mix(hash, blink ? 1 : 0);
    return { x, y: screenY, visible, style, blink, hash: hash >>> 0 };
  }
}
