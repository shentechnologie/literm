/**
 * TerminalView: the Skia renderer component.
 *
 * Frame loop (deliberately not React-driven):
 *   session.onDirty -> schedule -> requestAnimationFrame -> session.frame()
 *   (shadow-grid diff) -> update row picture cache -> compose one SkPicture
 *   (cached row pictures + cursor overlay) -> setState({picture}) so React
 *   commits a single <Picture> node.
 *
 * Notes:
 *  - The grid size is derived from the canvas size and the font metrics, and
 *    pushed into the terminal via session.resize(), which is what makes the
 *    remote pty resize (P1 wires the window-change through SSH).
 *  - Pictures are created per frame. We intentionally do not dispose the frame
 *    picture: Fabric may still be drawing it. Row pictures are cached and
 *    disposed on eviction; that boundary is where the memory churn lives.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, Picture, Skia, useFonts, type SkPicture } from '@shopify/react-native-skia';
import {
  StyleSheet,
  PanResponder,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  defaultTheme,
  TerminalSession,
  type CursorState,
  type FrameData,
  type Theme,
} from '@literm/terminal-core';
import { makeResources, type PaintResources, type TerminalFont } from './font';
import { paintCursor, paintRow } from './paint';
import { RowPictureCache } from './row-cache';

export interface ViewStats {
  fps: number;
  /** Time spent composing the last frame (cache lookups + picture record), ms. */
  composeMs: number;
  /** Time the core spent building the last frame (shadow-grid diff), ms. */
  diffMs: number;
  /** Row pictures re-recorded in the last frame. */
  recorded: number;
  /** Row pictures reused from cache in the last frame. */
  reused: number;
  dirtyRows: number;
  cols: number;
  rows: number;
  /** Cumulative parser time, ms. */
  parseMs: number;
  /** Cumulative bytes fed to the parser. */
  bytesWritten: number;
  /** Cell metrics actually in use, for on-device sanity checks. */
  cellWidth: number;
  cellHeight: number;
  baseline: number;
  /** First non-empty row of the last frame (diagnostics). */
  sampleRow: string;
}

export interface TerminalViewProps {
  session: TerminalSession;
  font: TerminalFont;
  fontSize?: number;
  lineHeightFactor?: number;
  theme?: Theme;
  style?: StyleProp<ViewStyle>;
  /** Called at most every `statsIntervalMs` (default 500ms). */
  onStats?: (stats: ViewStats) => void;
  statsIntervalMs?: number;
  /**
   * 'cached' records each row into its own cached SkPicture (fast for scrolling
   * and small updates). 'direct' paints changed rows straight into the frame
   * picture (no sub-pictures; cheap when everything changes every frame).
   */
  drawMode?: 'cached' | 'direct';
  /** Called on a tap (no drag) — use to focus a hidden input. */
  onPress?: () => void;
  /** Enable drag-to-scroll (default true). */
  scrollEnabled?: boolean;
}

interface RenderState {
  session: TerminalSession;
  resources: PaintResources | null;
  width: number;
  height: number;
  theme: Theme;
  cache: RowPictureCache;
  lastCursorHash: number;
  forceFull: boolean;
  blinkVisible: boolean;
  /** From the last painted frame. */
  cursorBlink: boolean;
  cursorVisible: boolean;
  composing: boolean;
  drawMode: 'cached' | 'direct';
  stats: ViewStats;
  statsAt: number;
  framesSinceStats: number;
}

const BLINK_INTERVAL_MS = 530;

export function TerminalView({
  session,
  font,
  fontSize = 13,
  lineHeightFactor = 1.12,
  theme = defaultTheme,
  style,
  onStats,
  statsIntervalMs = 500,
  drawMode = 'cached',
  onPress,
  scrollEnabled = true,
}: TerminalViewProps) {
  const provider = useFonts({ [font.family]: font.sources });
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [picture, setPicture] = useState<SkPicture | null>(null);

  const resources = useMemo(
    () =>
      provider
        ? makeResources({ provider, family: font.family, fontSize, theme, lineHeightFactor })
        : null,
    [provider, font.family, fontSize, theme, lineHeightFactor],
  );

  const cache = useMemo(() => new RowPictureCache(), []);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const statsIntervalRef = useRef(statsIntervalMs);
  statsIntervalRef.current = statsIntervalMs;

  const stateRef = useRef<RenderState | null>(null);
  stateRef.current = {
    session,
    resources,
    width: layout.width,
    height: layout.height,
    theme,
    cache,
    lastCursorHash: stateRef.current?.lastCursorHash ?? -1,
    forceFull: stateRef.current?.forceFull ?? true,
    blinkVisible: stateRef.current?.blinkVisible ?? true,
    cursorBlink: stateRef.current?.cursorBlink ?? true,
    cursorVisible: stateRef.current?.cursorVisible ?? false,
    composing: false,
    drawMode,
    stats:
      stateRef.current?.stats ??
      ({
        fps: 0,
        composeMs: 0,
        diffMs: 0,
        recorded: 0,
        reused: 0,
        dirtyRows: 0,
        cols: 0,
        rows: 0,
        parseMs: 0,
        bytesWritten: 0,
        cellWidth: 0,
        cellHeight: 0,
        baseline: 0,
        sampleRow: '',
      } satisfies ViewStats),
    statsAt: stateRef.current?.statsAt ?? 0,
    framesSinceStats: stateRef.current?.framesSinceStats ?? 0,
  };

  const rafRef = useRef<number | null>(null);

  // Live cell height for row-quantised scrolling, plus the latest onPress.
  const cellHeightRef = useRef(16);
  if (resources) cellHeightRef.current = resources.cellHeight;
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const dragAccum = useRef(0);
  const dragLastDy = useRef(0);
  const dragMoved = useRef(false);

  const compose = useCallback(() => {
    const state = stateRef.current;
    if (!state) return;
    const res = state.resources;
    if (!res || state.width <= 0 || state.height <= 0 || state.composing) return;
    state.composing = true;
    const t0 = Date.now();
    try {
      const data: FrameData = state.session.frame();
      const cursorChanged = data.cursor.hash !== state.lastCursorHash;
      const needsPaint = state.forceFull || data.dirty.length > 0 || cursorChanged;
      if (!needsPaint) return;

      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, state.width, state.height));

      res.bgPaint.setColor(res.colorOf(state.theme.background));
      canvas.drawRect(Skia.XYWHRect(0, 0, state.width, state.height), res.bgPaint);

      state.cache.beginFrame();
      if (state.drawMode === 'direct') {
        for (let i = 0; i < data.rows.length; i++) {
          const row = data.rows[i]!;
          if (row.runs.length === 0) continue;
          canvas.save();
          canvas.translate(0, i * res.cellHeight);
          paintRow(canvas, row, res);
          canvas.restore();
        }
      } else {
        for (let i = 0; i < data.rows.length; i++) {
          const row = data.rows[i]!;
          const rowPicture = state.cache.get(row, res);
          canvas.save();
          canvas.translate(0, i * res.cellHeight);
          canvas.drawPicture(rowPicture);
          canvas.restore();
        }
      }
      paintCursor(canvas, data.cursor as CursorState, res, state.blinkVisible);

      const next = recorder.finishRecordingAsPicture();
      recorder.dispose();
      setPicture(next);

      state.lastCursorHash = data.cursor.hash;
      state.cursorBlink = data.cursor.blink;
      state.cursorVisible = data.cursor.visible;
      state.forceFull = false;
      const stats = state.stats;
      stats.composeMs = Date.now() - t0;
      stats.diffMs = data.buildMs;
      stats.recorded = state.cache.lastRecorded;
      stats.reused = state.cache.lastReused;
      stats.dirtyRows = data.dirty.length;
      stats.cols = data.cols;
      stats.rows = data.rowsCount;
      stats.parseMs = state.session.stats.parseMs;
      stats.bytesWritten = state.session.stats.bytesWritten;
      stats.cellWidth = res.cellWidth;
      stats.cellHeight = res.cellHeight;
      stats.baseline = res.baseline;
      const sample = data.rows.find((row) => row.runs.length > 0);
      stats.sampleRow = sample
        ? `${sample.y} ${sample.runs.length}r ${JSON.stringify(sample.runs[0]!.text.slice(0, 18))}`
        : '(no rows)';
      stats.rows = data.rowsCount;
      state.framesSinceStats++;

      const nowMs = Date.now();
      if (state.statsAt === 0) state.statsAt = nowMs;
      const elapsed = nowMs - state.statsAt;
      if (elapsed >= statsIntervalRef.current) {
        stats.fps = (state.framesSinceStats * 1000) / elapsed;
        state.framesSinceStats = 0;
        state.statsAt = nowMs;
        onStatsRef.current?.({ ...stats });
      }
    } finally {
      state.composing = false;
    }
  }, []);

  const schedule = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      compose();
    });
  }, [compose]);

  // Wake on parser activity, scroll, buffer switches, cursor moves.
  useEffect(() => {
    const unsubscribe = session.onDirty(() => {
      const state = stateRef.current;
      if (state) state.blinkVisible = true; // solid cursor while data flows
      schedule();
    });
    schedule();
    return unsubscribe;
  }, [session, schedule]);

  // Grid size: derive cols/rows from the canvas size + cell metrics, push into
  // the terminal (which will become an SSH window-change in P1).
  useEffect(() => {
    if (!resources || layout.width <= 0 || layout.height <= 0) return;
    const cols = Math.max(2, Math.floor(layout.width / resources.cellWidth));
    const rows = Math.max(2, Math.floor(layout.height / resources.cellHeight));
    if (cols !== session.term.cols || rows !== session.term.rows) session.resize(cols, rows);
    const state = stateRef.current;
    if (state) state.forceFull = true;
    schedule();
  }, [resources, layout.width, layout.height, session, schedule]);

  // Font/theme change: cell metrics or colors changed, so every cached row is
  // stale (the row hash only covers content + resolved colors).
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !resources) return;
    state.cache.invalidateText();
    state.forceFull = true;
    schedule();
  }, [resources, schedule]);

  useEffect(() => {
    const timer = setInterval(() => {
      const state = stateRef.current;
      if (!state) return;
      // No blinking when DECSCUSR asked for a steady cursor or the cursor is
      // scrolled out of view; make sure it is painted solid in those cases.
      if (!state.cursorBlink || !state.cursorVisible) {
        if (!state.blinkVisible) {
          state.blinkVisible = true;
          state.forceFull = true;
          schedule();
        }
        return;
      }
      state.blinkVisible = !state.blinkVisible;
      state.forceFull = true; // recompose (rows come from cache) without new data
      schedule();
    }, BLINK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [schedule]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      cache.dispose();
    };
  }, [cache]);

  // Skia's Canvas rejects onLayout on the New Architecture, so measure a plain
  // View wrapper and let the canvas fill it.
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  // Touch surface: vertical drag scrolls the viewport a row at a time (content
  // follows the finger); a tap without movement is reported as onPress.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          scrollEnabled && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          dragAccum.current = 0;
          dragLastDy.current = 0;
          dragMoved.current = false;
        },
        onPanResponderMove: (_event, gesture) => {
          if (!scrollEnabled) return;
          const cellHeight = cellHeightRef.current || 16;
          if (Math.abs(gesture.dy) > 4) dragMoved.current = true;
          dragAccum.current += gesture.dy - dragLastDy.current;
          dragLastDy.current = gesture.dy;
          const lines = Math.trunc(dragAccum.current / cellHeight);
          if (lines !== 0) {
            dragAccum.current -= lines * cellHeight;
            // Dragging down pulls older lines into view (viewport moves up).
            session.scrollLines(-lines);
          }
        },
        onPanResponderRelease: () => {
          if (!dragMoved.current) onPressRef.current?.();
          dragAccum.current = 0;
          dragLastDy.current = 0;
          dragMoved.current = false;
        },
        onPanResponderTerminate: () => {
          dragAccum.current = 0;
          dragLastDy.current = 0;
          dragMoved.current = false;
        },
      }),
    [session, scrollEnabled],
  );

  return (
    <View style={style} onLayout={onLayout}>
      <Canvas
        style={StyleSheet.absoluteFill}
        opaque
        android={{
          // Predictable in-order compositing under React Native overlays; the
          // SurfaceView path (default when opaque) is cheaper but composites
          // behind the window, which fights our stats/overlay layers.
          surfaceType: 'TextureView',
        }}
      >
        {picture ? <Picture picture={picture} /> : null}
      </Canvas>
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />
    </View>
  );
}
