/**
 * Themes and ANSI(256) color resolution.
 *
 * Resolution happens once per cell during the shadow-grid pass; the results are
 * 0xRRGGBB ints that the renderer memoizes into SkColor.
 */
import type { XCell } from './buffer';
import { FLAG, type Theme } from './types';

export const shentermDark: Theme = {
  name: 'shenterm-dark',
  background: 0x0b0f14,
  foreground: 0xd7dde5,
  cursor: 0x7fd1ff,
  cursorAccent: 0x0b0f14,
  selectionBackground: 0x2a3b4d,
  boldIsBright: true,
  ansi: [
    0x1b222c, 0xff6b6b, 0x7ee787, 0xf2cc60, 0x79b8ff, 0xd2a8ff, 0x6edcd9, 0xc9d1d9,
    0x5c6773, 0xff8f8f, 0xa5f2a8, 0xffe08a, 0xa3cdff, 0xe3c0ff, 0x9ef2ef, 0xf0f6fc,
  ],
};

export const shentermLight: Theme = {
  name: 'shenterm-light',
  background: 0xfbfcfd,
  foreground: 0x1f2328,
  cursor: 0x0969da,
  cursorAccent: 0xfbfcfd,
  selectionBackground: 0xcfe3ff,
  boldIsBright: true,
  ansi: [
    0x24292f, 0xcf222e, 0x1a7f37, 0x9a6700, 0x0969da, 0x8250df, 0x1b7c83, 0x6e7781,
    0x57606a, 0xa40e26, 0x2da44e, 0xbf8700, 0x218bff, 0xa475f9, 0x3192aa, 0x8c959f,
  ],
};

export const themes = { dark: shentermDark, light: shentermLight } as const;
export const defaultTheme = shentermDark;

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

/** Build the full 256-entry palette (ANSI 16 from the theme + xterm's cube). */
export function buildPalette256(theme: Theme): number[] {
  const colors = new Array<number>(256);
  for (let i = 0; i < 16; i++) colors[i] = theme.ansi[i] ?? theme.foreground;
  let i = 16;
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        colors[i++] = (CUBE_LEVELS[r]! << 16) | (CUBE_LEVELS[g]! << 8) | CUBE_LEVELS[b]!;
      }
    }
  }
  for (let step = 0; step < 24; step++) {
    const v = 8 + step * 10;
    colors[i++] = (v << 16) | (v << 8) | v;
  }
  return colors;
}

function dim(color: number): number {
  const r = ((color >> 16) & 0xff) >> 1;
  const g = ((color >> 8) & 0xff) >> 1;
  const b = (color & 0xff) >> 1;
  return (r << 16) | (g << 8) | b;
}

export interface ResolvedColors {
  fg: number;
  bg: number;
}

export class Palette {
  readonly ansi: readonly number[];
  readonly foreground: number;
  readonly background: number;
  readonly theme: Theme;

  constructor(theme: Theme) {
    this.theme = theme;
    this.foreground = theme.foreground;
    this.background = theme.background;
    this.ansi = buildPalette256(theme);
  }

  /** Resolve a cell's effective fg/bg, applying inverse/dim/invisible/bold-bright. */
  resolve(cell: XCell, flags: number): ResolvedColors {
    let fg: number;
    if (cell.isFgDefault()) {
      fg = this.theme.foreground;
    } else if (cell.isFgRGB()) {
      fg = cell.getFgColor();
    } else {
      fg = this.paletteColor(cell.getFgColor(), flags, this.theme.foreground);
    }

    let bg: number;
    if (cell.isBgDefault()) {
      bg = this.theme.background;
    } else if (cell.isBgRGB()) {
      bg = cell.getBgColor();
    } else {
      bg = this.paletteColor(cell.getBgColor(), 0, this.theme.background);
    }

    if (flags & FLAG.INVERSE) {
      const swap = fg;
      fg = bg;
      bg = swap;
    }
    if (flags & FLAG.DIM) fg = dim(fg);
    if (flags & FLAG.INVISIBLE) fg = bg;

    return { fg, bg };
  }

  private paletteColor(index: number, flags: number, fallback: number): number {
    if (index < 0 || index > 255) return fallback;
    if (this.theme.boldIsBright !== false && flags & FLAG.BOLD && index < 8) {
      index += 8;
    }
    return this.ansi[index] ?? fallback;
  }
}
