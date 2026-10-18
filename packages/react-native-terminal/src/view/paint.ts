/**
 * Row painting.
 *
 * A row is recorded into its own SkPicture (cached by absolute line index +
 * content hash in row-cache.ts), so a frame is one background fill plus N
 * drawPicture ops. Scrolling reuses nearly every row picture; a burst of
 * output only re-records the rows that actually changed.
 *
 * Text has two paths:
 *  - ASCII runs (the overwhelming majority) draw straight through our bundled
 *    Nerd Font, positioned exactly at `col * cellWidth`.
 *  - Anything else (CJK, emoji, symbols outside the font) goes through the
 *    paragraph API, which resolves font fallback via the typeface provider.
 */
import {
  Skia,
  TextAlign,
  type SkCanvas,
} from '@shopify/react-native-skia';
import { FLAG, type CellRun, type CursorState, type RowSnapshot } from '@literm/terminal-core';
import { safeDispose } from './dispose';
import type { PaintResources } from './font';

/** Rich (non-ASCII) runs are painted through a paragraph for font fallback. */
function paintComplexRun(canvas: SkCanvas, run: CellRun, res: PaintResources): void {
  const bold = (run.flags & FLAG.BOLD) !== 0;
  const italic = (run.flags & FLAG.ITALIC) !== 0;
  // No paragraph cache: row pictures are already cached, so this only runs when
  // a row is re-recorded. Caching paragraphs here would retain one per unique
  // line of CJK output (unbounded under a `cat` flood).
  const builder = Skia.ParagraphBuilder.Make(
    {
      textAlign: TextAlign.Left,
      // A strut pinned to our cell height keeps paragraph rows aligned with
      // the grid regardless of what fallback font actually renders a glyph.
      strutStyle: {
        strutEnabled: true,
        fontFamilies: [res.family],
        fontSize: res.fontSize,
        heightMultiplier: res.cellHeight / res.fontSize,
        forceStrutHeight: true,
      },
      textStyle: {
        color: res.colorOf(run.fg),
        fontFamilies: [res.family],
        fontSize: res.fontSize,
      },
    },
    res.provider,
  );
  builder.pushStyle({
    fontFamilies: [res.family],
    fontSize: res.fontSize,
    color: res.colorOf(run.fg),
    fontStyle: { weight: bold ? 700 : 400, slant: italic ? 1 : 0 },
  });
  builder.addText(run.text);
  const paragraph = builder.build();
  safeDispose(builder);
  paragraph.layout(run.width * res.cellWidth + res.cellWidth);
  const lineMetrics = paragraph.getLineMetrics();
  const firstBaseline = lineMetrics.length > 0 ? lineMetrics[0]!.baseline : res.baseline;
  paragraph.paint(canvas, run.x * res.cellWidth, res.baseline - firstBaseline);
  safeDispose(paragraph);
}

export function paintRow(canvas: SkCanvas, row: RowSnapshot, res: PaintResources): void {
  const { cellWidth, cellHeight, baseline, theme } = res;
  const runs = row.runs;

  // Pass 1: backgrounds. Drawn before all text so runs never clip each other.
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (run.bg === theme.background) continue;
    res.bgPaint.setColor(res.colorOf(run.bg));
    canvas.drawRect(
      Skia.XYWHRect(run.x * cellWidth, 0, run.width * cellWidth, cellHeight),
      res.bgPaint,
    );
  }

  // Pass 2: text + decorations.
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (run.text.trim().length === 0 && !(run.flags & (FLAG.UNDERLINE | FLAG.STRIKETHROUGH))) {
      continue; // spaces with default background: nothing to draw
    }
    const x = run.x * cellWidth;
    res.textPaint.setColor(res.colorOf(run.fg));
    if (run.ascii) {
      canvas.drawText(run.text, x, baseline, res.textPaint, res.fontFor(run.flags));
    } else {
      paintComplexRun(canvas, run, res);
    }

    const width = run.width * cellWidth;
    if (run.flags & FLAG.UNDERLINE) {
      res.linePaint.setColor(res.colorOf(run.fg));
      canvas.drawRect(
        Skia.XYWHRect(x, baseline + res.fontSize * 0.12, width, Math.max(1, res.fontSize / 14)),
        res.linePaint,
      );
    }
    if (run.flags & FLAG.STRIKETHROUGH) {
      res.linePaint.setColor(res.colorOf(run.fg));
      canvas.drawRect(
        Skia.XYWHRect(x, baseline - res.fontSize * 0.3, width, Math.max(1, res.fontSize / 14)),
        res.linePaint,
      );
    }
  }
}

/**
 * Cursor overlay. P0 draws a translucent block / bar / underline on top of the
 * row; the "invert the glyph under the cursor" variant needs the row picture to
 * be re-recorded on every cursor move, which the cache makes unattractive.
 */
export function paintCursor(
  canvas: SkCanvas,
  cursor: CursorState,
  res: PaintResources,
  visible: boolean,
): void {
  if (!cursor.visible || !visible) return;
  const { cellWidth, cellHeight, theme } = res;
  const x = cursor.x * cellWidth;
  const y = cursor.y * cellHeight;
  res.cursorPaint.setColor(res.colorOf(theme.cursor));
  if (cursor.style === 'bar') {
    canvas.drawRect(Skia.XYWHRect(x, y, Math.max(1.5, cellWidth * 0.14), cellHeight), res.cursorPaint);
  } else if (cursor.style === 'underline') {
    canvas.drawRect(
      Skia.XYWHRect(x, y + cellHeight - Math.max(2, cellHeight * 0.12), cellWidth, Math.max(2, cellHeight * 0.12)),
      res.cursorPaint,
    );
  } else {
    res.cursorPaint.setAlphaf(0.55);
    canvas.drawRect(Skia.XYWHRect(x, y, cellWidth, cellHeight), res.cursorPaint);
    res.cursorPaint.setAlphaf(1);
  }
}
