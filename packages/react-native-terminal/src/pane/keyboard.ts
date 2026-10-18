/**
 * Soft-keyboard helpers shared by every screen.
 *
 * With edge-to-edge enabled (Expo SDK 54+, `edgeToEdgeEnabled=true`), Android
 * no longer resizes the window for the IME, and `android:windowSoftInputMode`
 * is effectively ignored — the keyboard overlays the app. React Native still
 * reports the IME inset, and `endCoordinates.height` is the one value that means
 * the same thing on both platforms (the keyboard's height above the system
 * bars), so screens position themselves against that rather than relying on
 * `KeyboardAvoidingView`'s frame maths, which assumes a resized window.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface KeyboardMetrics {
  visible: boolean;
  /** `endCoordinates.height` while visible, else 0. */
  height: number;
}

/** Live keyboard visibility + height. iOS uses the will-events for timing. */
export function useKeyboardMetrics(): KeyboardMetrics {
  const [metrics, setMetrics] = useState<KeyboardMetrics>({ visible: false, height: 0 });

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event) => {
      setMetrics({ visible: true, height: event.endCoordinates?.height ?? 0 });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setMetrics({ visible: false, height: 0 });
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return metrics;
}

export function useKeyboardVisible(): boolean {
  return useKeyboardMetrics().visible;
}

/**
 * Bottom inset for the key bar: the home indicator while the keyboard is down,
 * or the keyboard height while it is up, so the bar rides above the IME.
 *
 * `endCoordinates.height` spans to the screen bottom on iOS (the home-indicator
 * region is included) but only to the top of the system bars on Android, so
 * just Android adds `insets.bottom`.
 */
export function useKeyboardBottomInset(): number {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardMetrics();
  if (!keyboard.visible) return insets.bottom;
  return Platform.OS === 'android' ? keyboard.height + insets.bottom : keyboard.height;
}

/** The two methods we need from a TextInput; keeps callers type-agnostic. */
export interface KeyboardFocusable {
  focus(): void;
  blur(): void;
}

/**
 * Focus a hidden input so the soft keyboard appears.
 *
 * On Android the EditText usually keeps focus when the IME is dismissed with the
 * back gesture, so a bare `focus()` is a no-op (`TextInputState.focusTextInput`
 * ignores an already-focused input) and the keyboard never returns. Blurring
 * first clears that state, then focusing on the next frame re-opens it.
 *
 * No-op while the keyboard is already up, so a tap on the terminal does not
 * blur-and-refocus — which would flicker the IME (and risk leaving it closed).
 */
export function showKeyboardInput(input: KeyboardFocusable | null): void {
  if (!input || Keyboard.isVisible()) return;
  if (Platform.OS === 'android') {
    input.blur();
    requestAnimationFrame(() => input.focus());
    return;
  }
  input.focus();
}
