/**
 * Flood benchmarks for the parse + frame pipeline.
 *
 * This runs on Bun/V8, which is NOT Hermes. Treat the numbers as a lower bound
 * and a relative comparison between cases; the Hermes numbers come from the
 * on-device stats overlay in apps/mobile.
 *
 * Model: bytes arrive in 16KB chunks and the renderer runs one frame per
 * macrotask tick while the parser drains its queue (which is how xterm's
 * WriteBuffer behaves: it parses a batch synchronously, then yields).
 *
 * Metrics:
 *   syncParse  - time the parser blocked the JS thread inside write() calls
 *   feed       - wall time from first byte to fully drained
 *   frame      - time spent in the shadow-grid diff + frame build (render side)
 *   recorded   - row pictures that would need re-recording per frame
 */
import { TerminalSession } from '../src/session';

const CHUNK_SIZE = 16 * 1024;
const enc = new TextEncoder();

interface CaseSpec {
  name: string;
  cols?: number;
  rows?: number;
  scrollback?: number;
  data: string;
}

interface CaseResult {
  name: string;
  bytes: number;
  chunks: number;
  syncParseMs: number;
  feedMs: number;
  frameMs: number;
  frames: number;
  mbPerSec: number;
  avgFrameMs: number;
  peakDirtyRows: number;
  maxTickMs: number;
  maxTickParseMs: number;
}

function toChunks(data: string): { chunks: Uint8Array[]; bytes: number } {
  const bytes = enc.encode(data);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length)));
  }
  return { chunks, bytes: bytes.length };
}

/** `yes`-style: one short line, repeated. */
function yesLike(count: number): string {
  return 'y\r\n'.repeat(count);
}

/** `cat bigfile`-ish: 100-char lines of plain ASCII. */
function catLike(bytes: number): string {
  const line = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(3);
  return `${line}\n`.repeat(Math.ceil(bytes / (line.length + 1)));
}

/** Dense SGR: many color changes per line, like `ls --color` of a big tree. */
function sgrDense(bytes: number): string {
  const words = ['src', 'dist', 'node_modules', 'index.ts', 'README.md', 'assets'];
  const parts: string[] = [];
  let i = 0;
  let size = 0;
  while (size < bytes) {
    let line = '';
    for (let w = 0; w < 8; w++) {
      const word = words[i++ % words.length]!;
      line += `\x1b[1;3${i % 8}m${word}\x1b[0m  `;
    }
    parts.push(line + '\n');
    size += line.length + 1;
  }
  return parts.join('');
}

/** Multi-byte UTF-8 (CJK) to exercise the partial-sequence decoder. */
function cjk(bytes: number): string {
  const line = '日本語のテキストがここにあります'.repeat(3);
  const lineBytes = line.length * 3 + 1;
  return `${line}\n`.repeat(Math.ceil(bytes / lineBytes));
}

/** Full-screen TUI redraw (vim/htop style): alt screen + absolute positioning. */
function tuiRedraw(frames: number, cols: number, rows: number): string {
  let out = '\x1b[?1049h';
  for (let f = 0; f < frames; f++) {
    out += '\x1b[H';
    for (let y = 0; y < rows; y++) {
      out += `\x1b[3${y % 8}m${String(y).padStart(3, '0')} `;
      out += `\x1b[0m${'~'.repeat(cols - 5)}\x1b[K`;
      if (y < rows - 1) out += '\r\n';
    }
  }
  out += '\x1b[?1049l';
  return out;
}

/** Scrollback pressure: fill scrollback hard (forces trimming + reflow). */
function scrollbackPressure(lines: number): string {
  const parts: string[] = [];
  for (let i = 0; i < lines; i++) parts.push(`\x1b[3${i % 8}mline ${i}\x1b[0m\r\n`);
  return parts.join('');
}

async function drain(session: TerminalSession, expectedWrites: number) {
  let peakDirtyRows = 0;
  let maxTickMs = 0;
  let maxTickParseMs = 0;
  let guard = 0;
  // One macrotask per iteration: let xterm's WriteBuffer parse its next batch,
  // then run the renderer's frame for that tick.
  while (session.stats.writes < expectedWrites && guard++ < expectedWrites + 1000) {
    const tickAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const parsed = performance.now() - tickAt;

    const frameAt = performance.now();
    const frame = session.frame();
    if (frame.dirty.length > peakDirtyRows) peakDirtyRows = frame.dirty.length;

    const tickMs = parsed + (performance.now() - frameAt);
    if (tickMs > maxTickMs) {
      maxTickMs = tickMs;
      maxTickParseMs = parsed;
    }
  }
  return { peakDirtyRows, maxTickMs, maxTickParseMs };
}

async function runCase(spec: CaseSpec): Promise<CaseResult> {
  const session = new TerminalSession({
    cols: spec.cols ?? 120,
    rows: spec.rows ?? 40,
    scrollback: spec.scrollback ?? 5000,
  });

  const { chunks, bytes } = toChunks(spec.data);
  const t0 = performance.now();
  for (const chunk of chunks) session.write(chunk);
  const { peakDirtyRows, maxTickMs, maxTickParseMs } = await drain(session, chunks.length);
  const feedMs = performance.now() - t0;

  const result: CaseResult = {
    name: spec.name,
    bytes,
    chunks: chunks.length,
    syncParseMs: session.stats.parseMs,
    feedMs,
    frameMs: session.stats.frameMs,
    frames: session.stats.frames,
    mbPerSec: bytes / 1024 / 1024 / (feedMs / 1000),
    avgFrameMs: session.stats.frames > 0 ? session.stats.frameMs / session.stats.frames : 0,
    peakDirtyRows,
    maxTickMs,
    maxTickParseMs,
  };
  session.dispose();
  return result;
}

function format(result: CaseResult): Record<string, string> {
  const mb = result.bytes / 1024 / 1024;
  return {
    case: result.name,
    size: `${mb.toFixed(1)} MB`,
    chunks: String(result.chunks),
    frames: `${result.frames}`,
    'frame total': `${result.frameMs.toFixed(0)} ms`,
    'avg frame': `${result.avgFrameMs.toFixed(2)} ms`,
    'max tick': `${result.maxTickMs.toFixed(0)} ms`,
    'parse in max tick': `${result.maxTickParseMs.toFixed(0)} ms`,
    feed: `${result.feedMs.toFixed(0)} ms`,
    'MB/s': result.mbPerSec.toFixed(1),
    'peak dirty': String(result.peakDirtyRows),
  };
}

const COLS = 120;
const ROWS = 40;
const MB = 1024 * 1024;

const specs: CaseSpec[] = [
  { name: 'yes (200k lines)', data: yesLike(200_000) },
  { name: 'cat 10MB ascii', data: catLike(10 * MB) },
  { name: 'cat 10MB sgr-dense', data: sgrDense(10 * MB) },
  { name: 'cat 10MB cjk', data: cjk(10 * MB) },
  { name: 'tui redraw 300x', data: tuiRedraw(300, COLS, ROWS) },
  { name: 'scrollback 200k lines', data: scrollbackPressure(200_000) },
];

const results: CaseResult[] = [];
for (const spec of specs) results.push(await runCase(spec));

console.log('\nShenterm P0 flood benchmark (Bun/V8 — Hermes will be slower)\n');
console.table(results.map(format));
console.log('Model: 16KB chunks, one shadow-grid frame per parser drain tick.\n');
