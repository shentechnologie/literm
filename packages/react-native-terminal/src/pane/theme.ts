/**
 * Key-bar colors.
 *
 * The pane owns no application theme, so callers pass a `KeyBarTheme` (whole or
 * partial) and the defaults below match the reference app. Values are React
 * Native color strings.
 */
export interface KeyBarTheme {
  panel: string;
  panelAlt: string;
  border: string;
  text: string;
  accent: string;
  accentPanel: string;
  background: string;
}

export const defaultKeyBarTheme: KeyBarTheme = {
  panel: '#121821',
  panelAlt: '#182230',
  border: '#26303c',
  text: '#d7dde5',
  accent: '#7fd1ff',
  accentPanel: '#14313f',
  background: '#0b0f14',
};
