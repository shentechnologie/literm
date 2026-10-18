/**
 * Font loading + cell metrics + cached color conversion.
 *
 * Cell geometry is derived from the font so the grid can never drift:
 * cellWidth IS the advance of the font, and every run is drawn at
 * `col * cellWidth`. Choosing a rounded cellWidth instead (the usual
 * `Math.ceil(advance)`) accumulates up to a pixel of drift per cell over a
 * 200-column line, which is very visible on long command lines.
 */
import {
  FontStyle,
  Skia,
  type DataModule,
  type SkColor,
  type SkFont,
  type SkPaint,
  type SkTypeface,
  type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';
import { FLAG, type Theme } from '@literm/terminal-core';
import { safeDispose } from './dispose';

export interface TerminalFont {
  /** Family name the sources get registered under. */
  family: string;
  /** Regular, bold, italic, bold-italic (order irrelevant; style comes from the file). */
  sources: DataModule[];
}

export interface PaintResources {
  readonly family: string;
  readonly fontSize: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** Baseline offset from the top of a cell. */
  readonly baseline: number;
  readonly theme: Theme;
  readonly provider: SkTypefaceFontProvider;
  readonly fonts: {
    regular: SkFont;
    bold: SkFont;
    italic: SkFont;
    boldItalic: SkFont;
  };
  fontFor(flags: number): SkFont;
  readonly textPaint: SkPaint;
  readonly bgPaint: SkPaint;
  readonly cursorPaint: SkPaint;
  readonly linePaint: SkPaint;
  colorOf(rgb: number): SkColor;
  dispose(): void;
}

export interface MakeResourcesOptions {
  provider: SkTypefaceFontProvider;
  family: string;
  fontSize: number;
  theme: Theme;
  /** Multiplier over the font's natural line height. */
  lineHeightFactor?: number;
}

export function makeResources(options: MakeResourcesOptions): PaintResources {
  const { provider, family, fontSize, theme } = options;
  const lineHeightFactor = options.lineHeightFactor ?? 1.12;

  const face = (style: FontStyle): SkTypeface | null => {
    try {
      const tf = provider.matchFamilyStyle(family, style);
      return tf ?? null;
    } catch {
      return null;
    }
  };

  const normal = face(FontStyle.Normal);
  const boldFace = face(FontStyle.Bold);
  const italicFace = face(FontStyle.Italic);
  const boldItalicFace = face(FontStyle.BoldItalic);

  const font = (tf: SkTypeface | null) => Skia.Font(tf ?? undefined, fontSize);
  const fonts = {
    regular: font(normal),
    bold: font(boldFace ?? normal),
    italic: font(italicFace ?? normal),
    boldItalic: font(boldItalicFace ?? boldFace ?? italicFace ?? normal),
  };

  // Average over many glyphs: single-glyph advance can be off by a fraction of
  // a pixel due to hinting, and that fraction multiplies across the row.
  const sample = 'M'.repeat(64);
  const advance = fonts.regular.measureText(sample).width / 64;
  const metrics = fonts.regular.getMetrics();
  const natural = metrics.descent - metrics.ascent + (metrics.leading ?? 0);
  const cellWidth = advance;
  const cellHeight = Math.max(Math.ceil(natural * lineHeightFactor), Math.ceil(cellWidth * 1.25));
  const baseline = -metrics.ascent + (cellHeight - natural) / 2;

  const colorCache = new Map<number, SkColor>();
  const colorOf = (rgb: number): SkColor => {
    const cached = colorCache.get(rgb);
    if (cached) return cached;
    // NOTE: Skia.Color(number) is broken on native in @shopify/react-native-skia
    // 2.14 (iOS): numeric ARGB is accepted but paints nothing. Verified on device
    // with a side-by-side card. Build the Float32Array ourselves instead.
    const color = new Float32Array([
      ((rgb >> 16) & 0xff) / 255,
      ((rgb >> 8) & 0xff) / 255,
      (rgb & 0xff) / 255,
      1,
    ]);
    colorCache.set(rgb, color);
    return color;
  };

  const textPaint = Skia.Paint();
  textPaint.setAntiAlias(true);
  const bgPaint = Skia.Paint();
  bgPaint.setAntiAlias(false);
  const cursorPaint = Skia.Paint();
  cursorPaint.setAntiAlias(true);
  const linePaint = Skia.Paint();
  linePaint.setAntiAlias(false);

  return {
    family,
    fontSize,
    cellWidth,
    cellHeight,
    baseline,
    theme,
    provider,
    fonts,
    fontFor(flags: number): SkFont {
      const bold = (flags & FLAG.BOLD) !== 0;
      const italic = (flags & FLAG.ITALIC) !== 0;
      if (bold && italic) return fonts.boldItalic;
      if (bold) return fonts.bold;
      if (italic) return fonts.italic;
      return fonts.regular;
    },
    textPaint,
    bgPaint,
    cursorPaint,
    linePaint,
    colorOf,
    dispose() {
      colorCache.clear();
      for (const f of Object.values(fonts)) safeDispose(f);
      safeDispose(textPaint);
      safeDispose(bgPaint);
      safeDispose(cursorPaint);
      safeDispose(linePaint);
    },
  };
}
