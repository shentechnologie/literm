// Side-effect import first: xterm's platform detection needs navigator shims
// before the parser module is evaluated (see platform-shim.ts).
import './platform-shim';

export { FLAG } from './types';
export type {
  CellRun,
  CursorState,
  CursorStyle,
  FrameData,
  RowSnapshot,
  Theme,
  Unsubscribe,
} from './types';
export {
  buildPalette256,
  defaultTheme,
  Palette,
  shentermDark,
  shentermLight,
  themes,
} from './theme';
export { ShadowGrid } from './shadow-grid';
export { CursorStyleTracker } from './cursor-style';
export type { CursorStyleState } from './cursor-style';
export { TerminalSession } from './session';
export type { SessionStats, TerminalSessionOptions } from './session';
export { activeBuffer, cellFlags, isAscii } from './buffer';
export type { XBuffer, XCell, XLine } from './buffer';
export { encodeKey, encodePaste } from './keys';
export type { KeyEvent } from './keys';
export { now } from './clock';
