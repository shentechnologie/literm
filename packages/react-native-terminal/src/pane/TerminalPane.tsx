/**
 * TerminalPane — a `TerminalView`, its hidden input, and the key bar.
 *
 * This is the standard terminal body: a renderer, the off-screen `TextInput`
 * that raises the soft keyboard on tap, and the on-screen key bar beneath it.
 * The plumbing is the same wherever a terminal is shown, so screens compose this
 * instead of re-wiring it.
 *
 * Input from both the keyboard and the key bar is reported as `KeyEvent`s — the
 * same contract `encodeKey` uses — so a screen supplies one handler. `modifiers`
 * lets the screen apply sticky state (the Ctrl toggle) to everything typed
 * without the pane needing to know what Ctrl means.
 *
 * `children` render over the terminal area (stats overlays, diagnostics).
 */
import { useCallback, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputKeyPressEvent,
  type ViewStyle,
} from 'react-native';
import type { KeyEvent } from '@literm/terminal-core';
import { TerminalView, type TerminalViewProps } from '../view';
import { KeyBar, type KeyBarItem } from './KeyBar';
import { showKeyboardInput } from './keyboard';
import type { KeyBarTheme } from './theme';

export interface TerminalPaneProps extends Omit<TerminalViewProps, 'onPress' | 'style'> {
  /** Pane container style (defaults to filling its parent). */
  style?: StyleProp<ViewStyle>;
  /** Overlays drawn over the terminal area (stats, diagnostics). */
  children?: ReactNode;
  /** Key-bar items, rendered under the terminal. */
  items: readonly KeyBarItem[];
  /** One `KeyEvent` per keystroke; also receives key-bar presses. */
  onInput: (event: KeyEvent) => void;
  /** Modifiers merged into every emitted event, e.g. the sticky Ctrl toggle. */
  modifiers?: Omit<KeyEvent, 'key'>;
  /** Colors for the key bar. Defaults to `defaultKeyBarTheme`. */
  keyBarTheme?: KeyBarTheme;
  /** Safe-area padding for the terminal's horizontal edges, shared with the key bar. */
  contentInset?: { left?: number; right?: number };
}

export function TerminalPane({
  session,
  font,
  fontSize,
  lineHeightFactor,
  theme,
  onStats,
  statsIntervalMs,
  drawMode,
  scrollEnabled,
  style,
  children,
  items,
  onInput,
  modifiers,
  keyBarTheme,
  contentInset,
}: TerminalPaneProps) {
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  // Controlled purely so it can be cleared after each keystroke; never read.
  const [buffer, setBuffer] = useState('');

  const onChangeText = useCallback(
    (text: string) => {
      setBuffer('');
      for (const char of text) onInput({ key: char, ...modifiers });
    },
    [modifiers, onInput],
  );

  const onKeyPress = useCallback(
    (event: TextInputKeyPressEvent) => {
      const key = event.nativeEvent.key;
      // Printable characters arrive through onChangeText and Return through
      // onSubmitEditing. Only the named editing keys belong to this path —
      // forwarding anything else here sends the character a second time.
      if (key === 'Backspace' || key === 'Tab') {
        onInput({ key, ...modifiers });
      }
    },
    [modifiers, onInput],
  );

  const onSubmitEditing = useCallback(() => {
    onInput({ key: 'Enter', ...modifiers });
  }, [modifiers, onInput]);

  return (
    <View style={[styles.pane, style]}>
      <View
        style={[
          styles.terminal,
          {
            paddingLeft: contentInset?.left ?? 0,
            paddingRight: contentInset?.right ?? 0,
          },
        ]}
      >
        <TerminalView
          session={session}
          font={font}
          fontSize={fontSize}
          lineHeightFactor={lineHeightFactor}
          theme={theme}
          style={styles.fill}
          onStats={onStats}
          statsIntervalMs={statsIntervalMs}
          drawMode={drawMode}
          scrollEnabled={scrollEnabled}
          onPress={() => showKeyboardInput(inputRef.current)}
        />
        <TextInput
          ref={inputRef}
          value={buffer}
          onChangeText={onChangeText}
          onKeyPress={onKeyPress}
          onSubmitEditing={onSubmitEditing}
          // Keep focus (and the IME) after Return instead of blurring.
          submitBehavior="submit"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardType="ascii-capable"
          style={styles.hiddenInput}
        />
        {children}
      </View>
      <KeyBar items={items} onKey={onInput} theme={keyBarTheme} contentInset={contentInset} />
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  terminal: { flex: 1 },
  fill: { flex: 1 },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0, bottom: 0, left: 0 },
});
