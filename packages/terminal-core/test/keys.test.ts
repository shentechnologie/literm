import { describe, expect, test } from 'bun:test';
import { Terminal } from '@xterm/headless';
import { encodeKey, encodePaste } from '../src/keys';

function modes(overrides: Record<string, boolean> = {}) {
  const term = new Terminal({ cols: 20, rows: 4 });
  const m = term.modes;
  return { ...m, ...overrides } as typeof m;
}

describe('encodeKey: printable input', () => {
  test('plain characters pass through', () => {
    const m = modes();
    expect(encodeKey({ key: 'a' }, m)).toBe('a');
    expect(encodeKey({ key: '~' }, m)).toBe('~');
    expect(encodeKey({ key: ' ' }, m)).toBe(' ');
  });

  test('alt prefixes ESC', () => {
    const m = modes();
    expect(encodeKey({ key: 'f', alt: true }, m)).toBe('\x1bf');
  });

  test('shift does not alter printable characters (already applied by the keyboard layer)', () => {
    const m = modes();
    expect(encodeKey({ key: 'A', shift: true }, m)).toBe('A');
  });

  test('meta is not sent to the shell', () => {
    const m = modes();
    expect(encodeKey({ key: 'k', meta: true }, m)).toBe('k');
  });
});

describe('encodeKey: control characters', () => {
  test('ctrl+letter maps to 0x01-0x1a', () => {
    const m = modes();
    expect(encodeKey({ key: 'c', ctrl: true }, m)).toBe('\x03');
    expect(encodeKey({ key: 'a', ctrl: true }, m)).toBe('\x01');
    expect(encodeKey({ key: 'z', ctrl: true }, m)).toBe('\x1a');
  });

  test('ctrl symbol set', () => {
    const m = modes();
    expect(encodeKey({ key: '[', ctrl: true }, m)).toBe('\x1b');
    expect(encodeKey({ key: '\\', ctrl: true }, m)).toBe('\x1c');
    expect(encodeKey({ key: ']', ctrl: true }, m)).toBe('\x1d');
    expect(encodeKey({ key: '^', ctrl: true }, m)).toBe('\x1e');
    expect(encodeKey({ key: '_', ctrl: true }, m)).toBe('\x1f');
    expect(encodeKey({ key: '?', ctrl: true }, m)).toBe('\x7f');
    expect(encodeKey({ key: '/', ctrl: true }, m)).toBe('\x1f');
    expect(encodeKey({ key: ' ', ctrl: true }, m)).toBe('\x00');
  });

  test('ctrl+alt combines', () => {
    const m = modes();
    expect(encodeKey({ key: 'c', ctrl: true, alt: true }, m)).toBe('\x1b\x03');
  });
});

describe('encodeKey: named keys', () => {
  test('enter/backspace/tab/escape', () => {
    const m = modes();
    expect(encodeKey({ key: 'Enter' }, m)).toBe('\r');
    expect(encodeKey({ key: 'Backspace' }, m)).toBe('\x7f');
    expect(encodeKey({ key: 'Tab' }, m)).toBe('\t');
    expect(encodeKey({ key: 'Tab', shift: true }, m)).toBe('\x1b[Z');
    expect(encodeKey({ key: 'Escape' }, m)).toBe('\x1b');
  });

  test('arrows honor DECCKM', () => {
    const normal = modes();
    expect(encodeKey({ key: 'ArrowUp' }, normal)).toBe('\x1b[A');
    const app = modes({ applicationCursorKeysMode: true });
    expect(encodeKey({ key: 'ArrowUp' }, app)).toBe('\x1bOA');
  });

  test('arrow with modifier uses CSI 1;<mod>', () => {
    const m = modes();
    expect(encodeKey({ key: 'ArrowLeft', ctrl: true }, m)).toBe('\x1b[1;5D');
    expect(encodeKey({ key: 'ArrowRight', ctrl: true, shift: true }, m)).toBe('\x1b[1;6C');
    expect(encodeKey({ key: 'ArrowDown', alt: true }, m)).toBe('\x1b[1;3B');
  });

  test('tilde keys', () => {
    const m = modes();
    expect(encodeKey({ key: 'Delete' }, m)).toBe('\x1b[3~');
    expect(encodeKey({ key: 'PageUp' }, m)).toBe('\x1b[5~');
    expect(encodeKey({ key: 'PageDown' }, m)).toBe('\x1b[6~');
    expect(encodeKey({ key: 'Delete', ctrl: true }, m)).toBe('\x1b[3;5~');
  });

  test('function keys', () => {
    const m = modes();
    expect(encodeKey({ key: 'F1' }, m)).toBe('\x1bOP');
    expect(encodeKey({ key: 'F4' }, m)).toBe('\x1bOS');
    expect(encodeKey({ key: 'F5' }, m)).toBe('\x1b[15~');
    expect(encodeKey({ key: 'F12' }, m)).toBe('\x1b[24~');
    expect(encodeKey({ key: 'F5', shift: true }, m)).toBe('\x1b[15;2~');
  });

  test('home/end honor DECCKM', () => {
    const normal = modes();
    expect(encodeKey({ key: 'Home' }, normal)).toBe('\x1b[H');
    expect(encodeKey({ key: 'End' }, normal)).toBe('\x1b[F');
    const app = modes({ applicationCursorKeysMode: true });
    expect(encodeKey({ key: 'Home' }, app)).toBe('\x1bOH');
    expect(encodeKey({ key: 'End' }, app)).toBe('\x1bOF');
  });

  test('unknown keys produce nothing', () => {
    const m = modes();
    expect(encodeKey({ key: 'Meta' }, m)).toBeNull();
    expect(encodeKey({ key: 'CapsLock' }, m)).toBeNull();
  });
});

describe('encodePaste', () => {
  test('bracketed paste wraps and strips ESC', () => {
    const term = new Terminal({ cols: 20, rows: 4 });
    term.write('\x1b[?2004h', () => {
      expect(encodePaste('ls\x1b[31m -la', term.modes)).toBe('\x1b[200~ls[31m -la\x1b[201~');
    });
  });

  test('plain paste normalizes newlines', () => {
    const term = new Terminal({ cols: 20, rows: 4 });
    expect(encodePaste('a\nb\r\nc', term.modes)).toBe('a\rb\rc');
  });
});
