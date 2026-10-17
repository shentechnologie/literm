/**
 * Keys -> bytes.
 *
 * xterm-headless ships no keyboard layer (the DOM build's Keyboard/KeyboardService
 * only exists in the browser bundle), so encoding is ours. The rules that matter
 * are all mode dependent, and every mode we need is public API:
 *
 *  - DECCKM (`applicationCursorKeysMode`) switches arrows/Home/End to SS3.
 *  - Bracketed paste (`bracketedPasteMode`) wraps pasted text in ESC[200~/ESC[201~.
 *  - Modifiers on named keys use the standard `CSI 1;<mod><final>` param, where
 *    mod = 1 + shift + 2*alt + 4*ctrl.
 *
 * Meta (Cmd) is intentionally ignored here: on iOS/Android it belongs to the app
 * (new tab, find, paste), not to the shell.
 */
import type { IModes } from '@xterm/headless';

const ESC = '\x1b';

export interface KeyEvent {
  /**
   * A single printable character, or one of: Enter, Backspace, Tab, Escape,
   * ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, Insert, Delete,
   * F1..F12.
   */
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/** mod param per ECMA-48 / xterm: 1 + shift(1) + alt(2) + ctrl(4) + meta(8). */
function modifierParam(ev: KeyEvent): number {
  let mod = 1;
  if (ev.shift) mod += 1;
  if (ev.alt) mod += 2;
  if (ev.ctrl) mod += 4;
  if (ev.meta) mod += 8;
  return mod;
}

function csi(final: string, ev: KeyEvent): string {
  const mod = modifierParam(ev);
  return mod === 1 ? `${ESC}[${final}` : `${ESC}[1;${mod}${final}`;
}

function tilde(code: number, ev: KeyEvent): string {
  const mod = modifierParam(ev);
  return mod === 1 ? `${ESC}[${code}~` : `${ESC}[${code};${mod}~`;
}

/** SS3 form (arrows/Home/End/F1-F4 in application cursor mode). */
function ss3(final: string, ev: KeyEvent): string {
  const mod = modifierParam(ev);
  return mod === 1 ? `${ESC}O${final}` : `${ESC}[1;${mod}${final}`;
}

function withAlt(alt: boolean | undefined, data: string): string {
  return alt ? ESC + data : data;
}

export function encodeKey(ev: KeyEvent, modes: IModes): string | null {
  const appCursor = modes.applicationCursorKeysMode;
  const { key } = ev;

  switch (key) {
    case 'Enter':
      return withAlt(ev.alt, '\r');
    case 'Backspace':
      return withAlt(ev.alt, '\x7f');
    case 'Tab':
      return ev.shift ? `${ESC}[Z` : withAlt(ev.alt, '\t');
    case 'Escape':
      return ESC;
    case 'ArrowUp':
      return appCursor ? ss3('A', ev) : csi('A', ev);
    case 'ArrowDown':
      return appCursor ? ss3('B', ev) : csi('B', ev);
    case 'ArrowRight':
      return appCursor ? ss3('C', ev) : csi('C', ev);
    case 'ArrowLeft':
      return appCursor ? ss3('D', ev) : csi('D', ev);
    case 'Home':
      return appCursor ? ss3('H', ev) : csi('H', ev);
    case 'End':
      return appCursor ? ss3('F', ev) : csi('F', ev);
    case 'Insert':
      return tilde(2, ev);
    case 'Delete':
      return tilde(3, ev);
    case 'PageUp':
      return tilde(5, ev);
    case 'PageDown':
      return tilde(6, ev);
    case 'F1':
      return ss3('P', ev);
    case 'F2':
      return ss3('Q', ev);
    case 'F3':
      return ss3('R', ev);
    case 'F4':
      return ss3('S', ev);
    case 'F5':
      return tilde(15, ev);
    case 'F6':
      return tilde(17, ev);
    case 'F7':
      return tilde(18, ev);
    case 'F8':
      return tilde(19, ev);
    case 'F9':
      return tilde(20, ev);
    case 'F10':
      return tilde(21, ev);
    case 'F11':
      return tilde(23, ev);
    case 'F12':
      return tilde(24, ev);
    case ' ':
      if (ev.ctrl) return withAlt(ev.alt, '\x00');
      return withAlt(ev.alt, ' ');
    default:
      break;
  }

  if (key.length !== 1) return null;

  if (ev.ctrl) {
    const code = key.charCodeAt(0);
    let out: number | null = null;
    if (key >= 'a' && key <= 'z') out = code - 96;
    else if (key >= 'A' && key <= 'Z') out = code - 64;
    else if (key >= '@' && key <= '_') out = code - 64;
    else if (key === '?') out = 0x7f;
    else if (key === '/') out = 0x1f;
    else if (key >= '2' && key <= '8') out = code === 0x32 ? 0x00 : code - 0x32 + 0x1b;
    if (out === null) return null;
    return withAlt(ev.alt, String.fromCharCode(out));
  }

  return withAlt(ev.alt, key);
}

/**
 * Paste handling. With bracketed paste enabled the application can tell real
 * pastes from typed input, which is how editors avoid auto-indent disasters;
 * without it we must at least strip ESC so pasted text cannot inject escapes.
 */
export function encodePaste(text: string, modes: IModes): string {
  if (modes.bracketedPasteMode) {
    // ESC inside a bracketed paste would terminate it early.
    const safe = text.replace(/\x1b/g, '');
    return `\x1b[200~${safe}\x1b[201~`;
  }
  return text.replace(/\x1b/g, '').replace(/\r?\n/g, '\r');
}
