/**
 * Row picture cache: absolute buffer line index -> recorded SkPicture.
 *
 * Keyed by line index (not viewport slot) so a scroll hits the cache for every
 * row that was already on screen, and validated by the row's content hash so a
 * re-entered line is re-recorded only if its content or style actually changed.
 */
import { Skia, type SkPicture } from '@shopify/react-native-skia';
import type { RowSnapshot } from '@literm/terminal-core';
import { safeDispose } from './dispose';
import type { PaintResources } from './font';
import { paintRow } from './paint';

interface Entry {
  hash: number;
  picture: SkPicture;
  usedFrame: number;
}

export class RowPictureCache {
  private entries = new Map<number, Entry>();
  private frame = 0;
  private recorded = 0;
  private reused = 0;

  constructor(private readonly maxEntries = 512) {}

  /** Number of row pictures recorded during the last frame. */
  get lastRecorded(): number {
    return this.recorded;
  }

  get lastReused(): number {
    return this.reused;
  }

  beginFrame(): void {
    this.frame++;
    this.recorded = 0;
    this.reused = 0;
  }

  get(row: RowSnapshot, res: PaintResources): SkPicture {
    const hit = this.entries.get(row.y);
    if (hit && hit.hash === row.hash) {
      hit.usedFrame = this.frame;
      this.reused++;
      return hit.picture;
    }

    const recorder = Skia.PictureRecorder();
    const last = row.runs.length > 0 ? row.runs[row.runs.length - 1]! : null;
    const extent = last ? (last.x + last.width) * res.cellWidth : res.cellWidth;
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, extent, res.cellHeight));
    paintRow(canvas, row, res);
    const picture = recorder.finishRecordingAsPicture();
    safeDispose(recorder);
    this.recorded++;

    if (hit) {
      safeDispose(hit.picture);
      hit.hash = row.hash;
      hit.picture = picture;
      hit.usedFrame = this.frame;
    } else {
      this.entries.set(row.y, { hash: row.hash, picture, usedFrame: this.frame });
      this.evictIfNeeded();
    }
    return picture;
  }

  /** Drop every picture (font/theme change); rows re-record lazily. */
  invalidateText(): void {
    this.clear();
  }

  clear(): void {
    for (const entry of this.entries.values()) safeDispose(entry.picture);
    this.entries.clear();
  }

  dispose(): void {
    this.clear();
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) return;
    // Oldest-used first; keep a healthy margin so eviction is amortized.
    const target = Math.floor(this.maxEntries * 0.8);
    const sorted = [...this.entries.entries()].sort((a, b) => a[1].usedFrame - b[1].usedFrame);
    let removed = 0;
    for (const [y, entry] of sorted) {
      if (this.entries.size - removed <= target) break;
      safeDispose(entry.picture);
      this.entries.delete(y);
      removed++;
    }
  }
}
