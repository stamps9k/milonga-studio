import { useCallback, useRef, useState } from "react";

import type { SequenceEntry } from "../libs/dance/sequence.mts";
import {
  type ClickDivision,
  FALLBACK_TEMPO,
  clampTempo,
  clicksPerBeat,
} from "../libs/dance/tempo.mts";

/**
 * Starting tempo per dance style, in BPM. These are the middle of the
 * competition tempos usually published for each dance, converted from
 * bars a minute to beats a minute with the time signature the figures
 * are written in. Provisional: a starting point to nudge towards a
 * particular track, not a rule, and not checked with the owner's
 * teacher.
 *
 * - waltz: 28-30 bars a minute in 3/4, so 29 x 3 = 87.
 * - tango (ballroom): 31-33 bars a minute in 2/4, so 32 x 2 = 64.
 * - cha-cha: 30-32 bars a minute in 4/4, so 31 x 4 = 124.
 *
 * Styles with no single standard tempo (Argentine tango, blues,
 * jitterbug) start at FALLBACK_TEMPO until the owner gives one. This
 * table lives here rather than in the dance model because it is about
 * music for a dance, and the model keeps nothing style-specific.
 */
export const DEFAULT_TEMPO_BY_STYLE: Readonly<Record<string, number>> = {
  waltz: 87,
  tango: 64,
  "cha-cha": 124,
};

/**
 * The tempo a sequence starts at before the user adjusts it: the default
 * for the style of its first figure, or FALLBACK_TEMPO. The first figure
 * decides because a sequence is normally one dance, and the tempo
 * shouldn't jump when a figure of another style is added later.
 */
export function defaultTempo(entries: readonly SequenceEntry[]): number {
  const style = entries[0]?.figure.style;
  return (
    (style !== undefined ? DEFAULT_TEMPO_BY_STYLE[style] : undefined) ??
    FALLBACK_TEMPO
  );
}

/** Taps further apart than this, in milliseconds, start a new tap-tempo
 *  measurement. 2 seconds is slower than the slowest tempo allowed (30
 *  BPM), so a gap that long means the user stopped and started again. */
export const TAP_RESET_MS = 2000;

/** How many of the most recent taps tap tempo uses. */
export const TAP_WINDOW = 8;

/**
 * Tap tempo: the BPM implied by the times (in milliseconds, oldest first)
 * at which the user tapped along to the music, or null until there are
 * at least two taps in the current run.
 *
 * Only the latest run of taps counts (a gap of more than TAP_RESET_MS
 * starts a new run), and only its last TAP_WINDOW taps, so the result
 * follows the user as they settle into the beat. The tempo comes from
 * the median interval rather than the mean, so one mistimed tap doesn't
 * pull it off. Example: taps at 0, 690, 1380 and 2070 ms are 690 ms
 * apart, so 60000 / 690 = 87 BPM.
 */
export function tapTempo(timesMs: readonly number[]): number | null {
  let start = timesMs.length - 1;
  while (start > 0 && timesMs[start] - timesMs[start - 1] <= TAP_RESET_MS) {
    start--;
  }
  const run = timesMs.slice(Math.max(start, timesMs.length - TAP_WINDOW));
  if (run.length < 2) return null;
  const intervals = run
    .slice(1)
    .map((time, index) => time - run[index])
    .sort((a, b) => a - b);
  const middle = Math.floor(intervals.length / 2);
  const median =
    intervals.length % 2 === 1
      ? intervals[middle]
      : (intervals[middle - 1] + intervals[middle]) / 2;
  return median > 0 ? clampTempo(60000 / median) : null;
}

interface UseTempoResult {
  /** The tempo playback runs at, in BPM. */
  bpm: number;
  /** The sequence's default tempo (see defaultTempo). */
  defaultBpm: number;
  /** True when the user has set the tempo, so it no longer follows the
   *  sequence's default. */
  adjusted: boolean;
  setBpm: (bpm: number) => void;
  /** Register a tap at the current time; sets the tempo once there are
   *  two taps in a run. Taps are taken as the metronome's clicks, so with
   *  half-beat clicks two taps make one beat. */
  tap: () => void;
  /** Go back to following the sequence's default tempo. */
  reset: () => void;
}

/**
 * The playback tempo. It starts at the sequence's default (by dance
 * style) and follows it until the user changes it with setBpm or tap;
 * from then on it stays where they put it until reset. The tempo is
 * always in the beats the figures are written in; `division` only says
 * what the user is tapping along to (see tap). Nothing is saved:
 * the tempo is a setting for this session only (owner's decision,
 * 2026-11-17), so a reload starts again from the default.
 */
export function useTempo(
  entries: readonly SequenceEntry[],
  division: ClickDivision = "beat",
): UseTempoResult {
  const defaultBpm = defaultTempo(entries);
  const [chosen, setChosen] = useState<number | null>(null);
  const tapsRef = useRef<number[]>([]);

  const setBpm = useCallback((value: number) => {
    setChosen(clampTempo(value));
  }, []);

  const tap = useCallback(() => {
    const taps = [...tapsRef.current, performance.now()].slice(-TAP_WINDOW);
    tapsRef.current = taps;
    const tapped = tapTempo(taps);
    // Someone tapping along to half-beat clicks (or to tango music's
    // four-to-a-bar pulse with them on) taps twice a beat.
    if (tapped !== null)
      setChosen(clampTempo(tapped / clicksPerBeat(division)));
  }, [division]);

  const reset = useCallback(() => {
    tapsRef.current = [];
    setChosen(null);
  }, []);

  return {
    bpm: chosen ?? defaultBpm,
    defaultBpm,
    adjusted: chosen !== null,
    setBpm,
    tap,
    reset,
  };
}
