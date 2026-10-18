/**
 * KeyBar — the soft-key bar shared by the terminal screens.
 *
 * Items are plain data (`KeyBarItem`), so a live session and a lab build the
 * same bar from the same catalog; they differ only in which items they list and
 * what `onKey` does with the resulting `KeyEvent`. The bar owns the one thing
 * every variant shares: it pins to the bottom edge and clears the home
 * indicator and the soft keyboard.
 *
 * `TERMINAL_KEYS` is the single source of truth for a key's label and event —
 * `terminalKey('ctrlC')` turns a catalog entry into a bar item, so a control
 * combo is spelled out once and reused everywhere.
 */
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { KeyEvent } from '@literm/terminal-core';
import { defaultKeyBarTheme, type KeyBarTheme } from './theme';
import { useKeyboardBottomInset } from './keyboard';

/** Every terminal key the app can send: the button label and the event to encode. */
export const TERMINAL_KEYS = {
  escape: { label: 'esc', event: { key: 'Escape' } },
  tab: { label: 'tab', event: { key: 'Tab' } },
  ctrlC: { label: '^C', event: { key: 'c', ctrl: true } },
  ctrlD: { label: '^D', event: { key: 'd', ctrl: true } },
  ctrlX: { label: '^X', event: { key: 'x', ctrl: true } },
  ctrlZ: { label: '^Z', event: { key: 'z', ctrl: true } },
  arrowLeft: { label: '←', event: { key: 'ArrowLeft' } },
  arrowUp: { label: '↑', event: { key: 'ArrowUp' } },
  arrowDown: { label: '↓', event: { key: 'ArrowDown' } },
  arrowRight: { label: '→', event: { key: 'ArrowRight' } },
  enter: { label: '⏎', event: { key: 'Enter' } },
  backspace: { label: '⌫', event: { key: 'Backspace' } },
} as const satisfies Record<string, { label: string; event: KeyEvent }>;

export type TerminalKeyId = keyof typeof TERMINAL_KEYS;

export type KeyBarItem =
  /** A catalog key: `onKey` receives the event. */
  | { kind: 'key'; label: string; event: KeyEvent }
  /** A sticky modifier such as Ctrl. */
  | { kind: 'toggle'; label: string; active: boolean; onToggle: () => void }
  /** Anything else the screen wants (scroll, load generators). */
  | { kind: 'action'; label: string; onPress: () => void; emphasis?: boolean }
  | { kind: 'divider' };

/** Turn a catalog entry into a bar item. */
export function terminalKey(id: TerminalKeyId): KeyBarItem {
  return { kind: 'key', ...TERMINAL_KEYS[id] };
}

export interface KeyBarProps {
  items: readonly KeyBarItem[];
  /** Receives the `KeyEvent` behind a `kind: 'key'` item. */
  onKey: (event: KeyEvent) => void;
  /** Extra safe-area padding for the row's leading/trailing edge. */
  contentInset?: { left?: number; right?: number };
  /** Colors. Defaults to `defaultKeyBarTheme`. */
  theme?: KeyBarTheme;
  style?: StyleProp<ViewStyle>;
}

export function KeyBar({ items, onKey, contentInset, theme = defaultKeyBarTheme, style }: KeyBarProps) {
  // The bar sits on the bottom edge, so it clears the home indicator and the
  // soft keyboard itself rather than making every caller do it.
  const bottomInset = useKeyboardBottomInset();

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: theme.panel, borderTopColor: theme.border, paddingBottom: bottomInset },
        style,
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Tapping a key must not dismiss the IME (the default, "never", does).
        keyboardShouldPersistTaps="always"
        contentContainerStyle={[
          styles.content,
          {
            paddingLeft: 8 + (contentInset?.left ?? 0),
            paddingRight: 8 + (contentInset?.right ?? 0),
          },
        ]}
      >
        {items.map((item, index) => renderItem(item, index, onKey, theme))}
      </ScrollView>
    </View>
  );
}

function renderItem(
  item: KeyBarItem,
  index: number,
  onKey: (event: KeyEvent) => void,
  theme: KeyBarTheme,
) {
  switch (item.kind) {
    case 'divider':
      return <View key={index} style={[styles.divider, { backgroundColor: theme.border }]} />;
    case 'key':
      return <KeyButton key={index} label={item.label} theme={theme} onPress={() => onKey(item.event)} />;
    case 'toggle':
      return (
        <KeyButton key={index} label={item.label} theme={theme} active={item.active} onPress={item.onToggle} />
      );
    case 'action':
      return (
        <KeyButton
          key={index}
          label={item.label}
          theme={theme}
          emphasis={item.emphasis}
          onPress={item.onPress}
        />
      );
  }
}

function KeyButton({
  label,
  theme,
  active,
  emphasis,
  onPress,
}: {
  label: string;
  theme: KeyBarTheme;
  active?: boolean;
  emphasis?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.key,
        { backgroundColor: emphasis ? theme.accentPanel : theme.panelAlt },
        active && { backgroundColor: theme.accent },
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.keyText,
          { color: emphasis ? theme.accent : theme.text },
          active && { color: theme.background, fontWeight: '600' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  content: { alignItems: 'center', paddingVertical: 8, gap: 6 },
  key: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  keyText: { fontSize: 12 },
  divider: { width: 1, height: 22, marginHorizontal: 2 },
});
