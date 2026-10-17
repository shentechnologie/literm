import { describe, expect, test } from 'bun:test';
import { Terminal } from '@xterm/headless';
import { ShadowGrid } from '../src/shadow-grid';
import { defaultTheme, Palette } from '../src/theme';
import { FLAG } from '../src/types';

const palette = new Palette(defaultTheme);
/** ANSI 1 (red) from our default theme. */
const RED = defaultTheme.ansi[1]!;
const BLUE_BG = defaultTheme.ansi[4]!;

function setup(cols = 20, rows = 4, scrollback = 100) {
  const term = new Terminal({ cols, rows, scrollback, allowProposedApi: true, cursorBlink: true });
  const grid = new ShadowGrid(cols, rows, palette);
  const write = (data: string) =>
    new Promise<void>((resolve) => {
      term.write(data, () => resolve());
    });
  return { term, grid, write };
}

describe('ShadowGrid: rows and runs', () => {
  test('first sync reports every row dirty', () => {
    const { term, grid } = setup();
    const frame = grid.sync(term);
    expect(frame.dirty).toEqual([0, 1, 2, 3]);
    expect(frame.rowsCount).toBe(4);
    expect(frame.cols).toBe(20);
    expect(frame.altBuffer).toBe(false);
  });

  test('an unchanged viewport produces no dirty rows', () => {
    const { term, grid } = setup();
    grid.sync(term);
    const frame = grid.sync(term);
    expect(frame.dirty).toEqual([]);
  });

  test('plain text becomes a single trimmed run', async () => {
    const { term, grid, write } = setup();
    await write('hello');
    grid.sync(term);
    const row = grid.sync(term).rows[0]!;
    expect(row.text).toBe('hello');
    expect(row.runs.length).toBe(1);
    expect(row.runs[0]!.text).toBe('hello');
    expect(row.runs[0]!.x).toBe(0);
    expect(row.runs[0]!.width).toBe(5);
    expect(row.runs[0]!.ascii).toBe(true);
    expect(row.runs[0]!.fg).toBe(defaultTheme.foreground);
    expect(row.runs[0]!.bg).toBe(defaultTheme.background);
  });

  test('SGR foreground splits runs and resolves the palette', async () => {
    const { term, grid, write } = setup();
    await write('plain\x1b[31mred\x1b[0m');
    grid.sync(term);
    const row = grid.sync(term).rows[0]!;
    expect(row.text).toBe('plainred');
    expect(row.runs.length).toBe(2);
    expect(row.runs[0]!.text).toBe('plain');
    expect(row.runs[1]!.text).toBe('red');
    expect(row.runs[1]!.x).toBe(5);
    expect(row.runs[1]!.fg).toBe(RED);
  });

  test('background colors survive (trailing blanks are not trimmed away when styled)', async () => {
    const { term, grid, write } = setup();
    await write('\x1b[44m  \x1b[0m');
    grid.sync(term);
    const row = grid.sync(term).rows[0]!;
    expect(row.runs.length).toBe(1);
    expect(row.runs[0]!.bg).toBe(BLUE_BG);
    expect(row.runs[0]!.width).toBe(2);
    expect(row.runs[0]!.text).toBe('  ');
  });

  test('bold uses the bright ANSI variant', async () => {
    const { term, grid, write } = setup();
    await write('\x1b[1;31mX');
    grid.sync(term);
    const row = grid.sync(term).rows[0]!;
    expect(row.runs[0]!.flags & FLAG.BOLD).toBe(FLAG.BOLD);
    expect(row.runs[0]!.fg).toBe(defaultTheme.ansi[9]);
  });

  test('inverse swaps fg and bg', async () => {
    const { term, grid, write } = setup();
    await write('\x1b[7mX');
    grid.sync(term);
    const row = grid.sync(term).rows[0]!;
    expect(row.runs[0]!.fg).toBe(defaultTheme.background);
    expect(row.runs[0]!.bg).toBe(defaultTheme.foreground);
  });

  test('wide characters occupy two cells and are marked non-ascii', async () => {
    const { term, grid, write } = setup();
    await write('日');
    grid.sync(term);
    const row = grid.sync(term).rows[0]!;
    expect(row.runs.length).toBe(1);
    expect(row.runs[0]!.text).toBe('日');
    expect(row.runs[0]!.width).toBe(2);
    expect(row.runs[0]!.ascii).toBe(false);
  });

  test('only the changed row is dirty', async () => {
    const { term, grid, write } = setup();
    await write('one\r\ntwo\r\nthree');
    grid.sync(term);
    expect(grid.sync(term).dirty).toEqual([]);
    await write('\r\nfour');
    const frame = grid.sync(term);
    expect(frame.dirty).toEqual([3]);
    expect(frame.rows[3]!.text).toBe('four');
  });

  test('cursor is reported viewport relative', async () => {
    const { term, grid, write } = setup();
    await write('ab');
    grid.sync(term);
    const frame = grid.sync(term);
    expect(frame.cursor.visible).toBe(true);
    expect(frame.cursor.x).toBe(2);
    expect(frame.cursor.y).toBe(0);
  });

  test('row hash is stable for unchanged content and changes with styles', async () => {
    const { term, grid, write } = setup();
    await write('stable');
    grid.sync(term);
    const a = grid.sync(term).rows[0]!;
    const b = grid.sync(term).rows[0]!;
    expect(b.hash).toBe(a.hash);
    await write('\r\x1b[31mstable');
    const c = grid.sync(term).rows[0]!;
    expect(c.hash).not.toBe(a.hash);
  });
});

describe('ShadowGrid: scrolling and buffers', () => {
  test('scrolling marks the whole viewport dirty and the cursor hides', async () => {
    const { term, grid, write } = setup(20, 4, 50);
    let payload = '';
    for (let i = 0; i < 10; i++) payload += `line ${i}\r\n`;
    await write(payload);
    grid.sync(term);
    expect(grid.sync(term).dirty).toEqual([]);
    term.scrollLines(-2);
    const frame = grid.sync(term);
    expect(frame.dirty.length).toBe(4);
    expect(frame.rows[0]!.text).toBe('line 5');
  });

  test('alternate buffer is reported', async () => {
    const { term, grid, write } = setup();
    await write('\x1b[?1049h');
    expect(grid.sync(term).altBuffer).toBe(true);
  });
});
