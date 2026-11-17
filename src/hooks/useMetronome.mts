import { useCallback, useEffect, useRef } from "react";

import {
  type ClickPlayer,
  createClickPlayer,
} from "../libs/browser/metronome.mts";
import { type MetronomeClick, clicksBetween } from "../libs/dance/tempo.mts";

/** How far ahead clicks are scheduled, in seconds. Long enough that a
 *  late animation frame never makes a click late, short enough that a
 *  pause or a tempo change takes effect almost at once. */
const LOOKAHEAD_SECONDS = 0.1;

/** A jump in the playback position bigger than this many beats between
 *  frames is treated as a seek, and scheduling starts again from the
 *  new position. Normal playback moves a few hundredths of a beat a
 *  frame. */
const SEEK_THRESHOLD_BEATS = 0.5;

interface UseMetronomeOptions {
  enabled: boolean;
  playing: boolean;
  /** Playback position, in beats. */
  beat: number;
  bpm: number;
  clicks: readonly MetronomeClick[];
}

/**
 * Plays the metronome in time with playback. On every update of the
 * playback position it schedules, on the audio clock, the clicks due in
 * the next LOOKAHEAD_SECONDS that haven't been scheduled yet: a click at
 * beat b is due (b - beat) beats from now, at 60 / bpm seconds a beat.
 * Pausing, turning the metronome off or seeking cancels whatever is
 * still pending.
 *
 * Returns `prime`, which creates and starts the audio. Browsers only
 * allow audio to start in response to a user gesture, so call it from
 * the click handlers of the play button and the metronome switch.
 */
export function useMetronome({
  enabled,
  playing,
  beat,
  bpm,
  clicks,
}: UseMetronomeOptions): { prime: () => void } {
  // undefined: not created yet; null: this browser has no Web Audio.
  const playerRef = useRef<ClickPlayer | null | undefined>(undefined);
  const scheduledUntilRef = useRef<number | null>(null);
  const lastBeatRef = useRef<number | null>(null);
  const pendingRef = useRef<(() => void)[]>([]);

  const prime = useCallback(() => {
    if (playerRef.current === undefined) {
      playerRef.current = createClickPlayer();
    }
    void playerRef.current?.resume();
  }, []);

  const cancelPending = useCallback(() => {
    for (const cancel of pendingRef.current) cancel();
    pendingRef.current = [];
    scheduledUntilRef.current = null;
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!enabled || !playing || !player) {
      cancelPending();
      lastBeatRef.current = null;
      return;
    }
    const last = lastBeatRef.current;
    if (last !== null && (beat < last || beat - last > SEEK_THRESHOLD_BEATS)) {
      cancelPending();
    }
    lastBeatRef.current = beat;

    const secondsPerBeat = 60 / bpm;
    const from = scheduledUntilRef.current ?? beat;
    const to = beat + LOOKAHEAD_SECONDS / secondsPerBeat;
    if (to <= from) return;
    const now = player.now();
    for (const click of clicksBetween(clicks, from, to)) {
      pendingRef.current.push(
        player.click(now + (click.beat - beat) * secondsPerBeat, click.accent),
      );
    }
    // Only the last few can still be pending; drop the rest so the list
    // doesn't grow through a long playback.
    pendingRef.current = pendingRef.current.slice(-8);
    scheduledUntilRef.current = to;
  }, [enabled, playing, beat, bpm, clicks, cancelPending]);

  useEffect(() => cancelPending, [cancelPending]);

  return { prime };
}
