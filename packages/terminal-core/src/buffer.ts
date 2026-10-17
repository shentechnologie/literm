/**
 * Structural (duck-typed) view of xterm-headless's buffer API.
 *
 * `@xterm/headless` does not export `IBuffer` / `IBufferCell` / `IBufferLine`
 * from its typings, but `Terminal.buffer.active` is public API. We describe
 * only what we consume and cast once at the boundary.
 */
import type { Terminal } from '@xterm/headless';
import { FLAG } from './types';

export interface XCell {
  getWidth(): number;
  getChars(): string;
  getCode(): number;
  getFgColorMode(): number;
  getBgColorMode(): number;
  getFgColor(): number;
  getBgColor(): number;
  isBold(): number;
  isItalic(): number;
  isDim(): number;
  isUnderline(): number;
  isBlink(): number;
  isInverse(): number;
  isInvisible(): number;
  isStrikethrough(): number;
  isOverline(): number;
  isFgRGB(): boolean;
  isBgRGB(): boolean;
  isFgPalette(): boolean;
  isBgPalette(): boolean;
  isFgDefault(): boolean;
  isBgDefault(): boolean;
  isAttributeDefault(): boolean;
}

export interface XLine {
  readonly isWrapped: boolean;
  readonly length: number;
  getCell(x: number, cell?: XCell): XCell | undefined;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

export interface XBuffer {
  readonly type: 'normal' | 'alternate';
  readonly cursorX: number;
  readonly cursorY: number;
  readonly viewportY: number;
  readonly baseY: number;
  readonly length: number;
  getLine(y: number): XLine | undefined;
  getNullCell(): XCell;
}

export function activeBuffer(term: Terminal): XBuffer {
  return term.buffer.active as unknown as XBuffer;
}

/** Cell attribute bit flags, resolved from the cell object. */
export function cellFlags(cell: XCell): number {
  let flags = 0;
  if (cell.isBold()) flags |= FLAG.BOLD;
  if (cell.isItalic()) flags |= FLAG.ITALIC;
  if (cell.isDim()) flags |= FLAG.DIM;
  if (cell.isUnderline()) flags |= FLAG.UNDERLINE;
  if (cell.isBlink()) flags |= FLAG.BLINK;
  if (cell.isInverse()) flags |= FLAG.INVERSE;
  if (cell.isInvisible()) flags |= FLAG.INVISIBLE;
  if (cell.isStrikethrough()) flags |= FLAG.STRIKETHROUGH;
  if (cell.isOverline()) flags |= FLAG.OVERLINE;
  return flags;
}

/** True when every code point in `s` is < 0x80. */
export function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/** FNV-1a over a 32-bit value. */
export function mix(hash: number, value: number): number {
  hash ^= value;
  return Math.imul(hash, 0x01000193) >>> 0;
}

export function mixString(hash: number, s: string): number {
  for (let i = 0; i < s.length; i++) hash = mix(hash, s.charCodeAt(i));
  return hash;
}
