/**
 * Behaviour probes for the headless terminal.
 *
 * These document what xterm-headless does and does not expose, which decides
 * what we implement ourselves. If an assertion here starts failing on a
 * dependency upgrade, our renderer/transport assumptions may have changed.
 */
import { describe, expect, test } from 'bun:test';
import { Terminal } from '@xterm/headless';
import { TerminalSession } from '../src/session';

function make(cols = 20, rows = 4, scrollback = 100) {
  const term = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
  const write = (data: string) =>
    new Promise<void>((resolve) => {
      term.write(data, () => resolve());
    });
  return { term, write };
}

function makeSession(cols = 20, rows = 4) {
  const session = new TerminalSession({ cols, rows, scrollback: 100 });
  const write = (data: string) =>
    new Promise<void>((resolve) => {
      session.term.write(data, () => resolve());
    });
  return { session, write };
}

describe('DECSCUSR (cursor shape)', () => {
  test('the headless build does NOT update options.cursorStyle', async () => {
    const { term, write } = make();
    await write('\x1b[4 q');
    // Documented headless behaviour: the sequence is parsed but not applied to
    // options, which is why TerminalSession tracks it itself.
    expect(term.options.cursorStyle).toBe('block');
  });

  test('TerminalSession tracks shape and blink from CSI Ps SP q', async () => {
    const { session, write } = makeSession();

    await write('\x1b[2 q');
    let cursor = session.frame().cursor;
    expect(cursor.style).toBe('block');
    expect(cursor.blink).toBe(false);

    await write('\x1b[4 q');
    cursor = session.frame().cursor;
    expect(cursor.style).toBe('underline');
    expect(cursor.blink).toBe(false);

    await write('\x1b[5 q');
    cursor = session.frame().cursor;
    expect(cursor.style).toBe('bar');
    expect(cursor.blink).toBe(true);

    await write('\x1b[0 q');
    cursor = session.frame().cursor;
    expect(cursor.style).toBe('block');
    expect(cursor.blink).toBe(true);
    session.dispose();
  });

  test('RIS resets the cursor shape', async () => {
    const { session, write } = makeSession();
    await write('\x1b[6 q');
    expect(session.frame().cursor.style).toBe('bar');
    await write('\x1bc');
    expect(session.frame().cursor.style).toBe('block');
    session.dispose();
  });

  test('a shape change wakes the renderer', async () => {
    const { session, write } = makeSession();
    session.frame();
    let dirty = 0;
    const unsubscribe = session.onDirty(() => {
      dirty++;
    });
    await write('\x1b[4 q');
    expect(dirty).toBeGreaterThan(0);
    unsubscribe();
    session.dispose();
  });
});

describe('OSC sequences', () => {
  test('title changes are observable', async () => {
    const { term, write } = make();
    const seen: { title: string | null } = { title: null };
    const sub = term.onTitleChange((value) => {
      seen.title = value;
    });
    await write('\x1b]0;~/dev/thing\x07');
    expect(seen.title).toBe('~/dev/thing');
    sub.dispose();
  });

  test('bell is observable', async () => {
    const { term, write } = make();
    let bells = 0;
    const sub = term.onBell(() => {
      bells++;
    });
    await write('\x07');
    expect(bells).toBe(1);
    sub.dispose();
  });

  test('OSC 8 hyperlinks are NOT exposed on cells, but the sequence is interceptable', async () => {
    const { term, write } = make();
    const observed: string[] = [];
    const sub = term.parser.registerOscHandler(8, (data) => {
      observed.push(data);
      return false; // let the core handle it as well
    });
    await write('\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\');
    expect(observed.length).toBe(2);
    expect(observed[0]).toBe(';https://example.com');
    // Nothing in the public cell API carries the link:
    const cell = term.buffer.active.getLine(0)?.getCell(0);
    expect(cell?.getChars()).toBe('l');
    expect((cell as unknown as Record<string, unknown>).hyperlink).toBeUndefined();
    sub.dispose();
  });

  test('OSC 52 clipboard payload is interceptable', async () => {
    const { term, write } = make();
    let payload = '';
    const sub = term.parser.registerOscHandler(52, (data) => {
      payload = data;
      return true; // we handle it
    });
    await write('\x1b]52;c;aGVsbG8=\x07');
    expect(payload).toBe('c;aGVsbG8=');
    sub.dispose();
  });
});

describe('buffer bounds', () => {
  test('scrollback is trimmed to options.scrollback', async () => {
    const { term, write } = make(20, 4, 10);
    let payload = '';
    for (let i = 0; i < 100; i++) payload += `line ${i}\r\n`;
    await write(payload);
    expect(term.buffer.active.length).toBeLessThanOrEqual(10 + 4);
    expect(term.buffer.active.baseY).toBe(term.buffer.active.length - 4);
  });

  test('resize reflows normal lines and emits onResize', async () => {
    const { term, write } = make(120, 20);
    let payload = '';
    for (let i = 0; i < 30; i++) payload += `${String(i).padStart(3, '0')}-${'a'.repeat(96)}\r\n`;
    await write(payload);
    let size: { cols: number; rows: number } | null = null;
    const sub = term.onResize((value) => {
      size = value;
    });
    term.resize(60, 20);
    expect(size).toMatchObject({ cols: 60, rows: 20 });

    // Reflow works: all 3000 chars survive and the lines are re-wrapped.
    let chars = 0;
    let longest = 0;
    let wrapped = 0;
    const buf = term.buffer.active;
    for (let y = 0; y < buf.length; y++) {
      const line = buf.getLine(y);
      const text = line?.translateToString(true) ?? '';
      chars += text.length;
      longest = Math.max(longest, text.length);
      if (line?.isWrapped) wrapped++;
    }
    expect(chars).toBe(30 * 100);
    expect(longest).toBeLessThanOrEqual(60);
    expect(wrapped).toBeGreaterThan(0);
    sub.dispose();
  });

  test('KNOWN LIMITATION: shrinking truncates lines that exactly fill the old width', async () => {
    // Upstream xterm.js behaviour (not headless-specific): a stream of
    // exactly-full-width lines is truncated on column shrink instead of being
    // reflowed. Affects e.g. `cat` of 120-column-formatted text on rotation.
    // Documented so a dependency upgrade that fixes it is noticed.
    const { term, write } = make(120, 20);
    await write('b'.repeat(120).repeat(30));
    const countChars = () => {
      const buf = term.buffer.active;
      let chars = 0;
      for (let y = 0; y < buf.length; y++) {
        chars += buf.getLine(y)?.translateToString(true).length ?? 0;
      }
      return chars;
    };
    expect(countChars()).toBe(3600);
    term.resize(60, 20);
    expect(countChars()).toBe(1800);
  });
});

describe('input path', () => {
  test('terminal.input() emits onData (transport seam)', () => {
    const { term } = make();
    let data = '';
    const sub = term.onData((value) => {
      data += value;
    });
    term.input('ls\r');
    expect(data).toBe('ls\r');
    sub.dispose();
  });

  test('binary mode is observable (mouse reports)', () => {
    const { term } = make();
    const binary: string[] = [];
    const sub = term.onBinary((value) => {
      binary.push(value);
    });
    // No binary events without mouse tracking, but the event exists.
    expect(binary.length).toBe(0);
    sub.dispose();
  });
});
