/**
 * Shared model types for the terminal core and renderer.
 *
 * Colors are packed 0xRRGGBB integers everywhere. The renderer memoizes
 * int -> SkColor conversion, so keeping the model in ints keeps the diff
 * cheap (integer compares) and the renderer allocation-free.
 */

/** Cell attribute bit flags. Fits in an Int32Array. */
export const FLAG = {
  BOLD: 1,
  ITALIC: 2,
  DIM: 4,
  UNDERLINE: 8,
  BLINK: 16,
  INVERSE: 32,
  INVISIBLE: 64,
  STRIKETHROUGH: 128,
  OVERLINE: 256,
  /** Wide (double-width) character cell. */
  WIDE: 512,
  /** Underline styles (CSI 4:x) packed in bits 10-12. */
  UNDERLINE_STYLE_SHIFT: 10,
} as const;

export interface Theme {
  name: string;
  /** 0xRRGGBB */
  background: number;
  foreground: number;
  cursor: number;
  cursorAccent: number;
  selectionBackground: number;
  /** ANSI 0-15. */
  ansi: readonly number[];
  /** Draw bold text in the bright ANSI variants. xterm default: true. */
  boldIsBright?: boolean;
}

/** A run of cells sharing one style, drawn as a single text draw call. */
export interface CellRun {
  /** First column (0-based). */
  readonly x: number;
  /** Number of columns covered. */
  readonly width: number;
  readonly text: string;
  readonly fg: number;
  readonly bg: number;
  readonly flags: number;
  /** True when every char is < 0x80 (fast path: our font covers it). */
  readonly ascii: boolean;
}

export interface RowSnapshot {
  /** Absolute buffer line index (scrollback included). */
  readonly y: number;
  /** Content hash of the styled row, used as the row-picture cache key. */
  readonly hash: number;
  /** Plain text of the row, trimmed right (links, a11y, selection). */
  readonly text: string;
  readonly isWrapped: boolean;
  readonly runs: readonly CellRun[];
  /** Number of lines in the underlying buffer when the row was built. */
  readonly bufferLength: number;
}

export type CursorStyle = 'block' | 'underline' | 'bar';

export interface CursorState {
  /** Viewport-relative column. */
  readonly x: number;
  /** Viewport-relative row. */
  readonly y: number;
  readonly visible: boolean;
  readonly style: CursorStyle;
  readonly blink: boolean;
  readonly hash: number;
}

export interface FrameData {
  /** Visible rows, top to bottom (length === rowsCount). */
  readonly rows: readonly RowSnapshot[];
  /** Viewport slots whose content changed since the last frame. */
  readonly dirty: readonly number[];
  readonly cursor: CursorState;
  readonly viewportY: number;
  readonly cols: number;
  readonly rowsCount: number;
  readonly altBuffer: boolean;
  /** Wall time spent building this frame, ms. */
  readonly buildMs: number;
}

export type Unsubscribe = () => void;
