import { useCallback, useEffect, useRef, useState } from "react";

/** Beats per second while playing. There's no real tempo to drive this
 *  yet -- tempo lives on a Dance (bpm), and nothing here is wired to
 *  one -- so this is a fixed placeholder until that connection exists. */
const PLACEHOLDER_BEATS_PER_SECOND = 1;

interface UsePlaybackResult {
  beat: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (beat: number) => void;
  stepBy: (delta: number) => void;
}

/**
 * Owns a scrub/playback position (in beats) over a sequence of the
 * given total length. Doesn't know anything about dance data itself --
 * Canvas2D/ActiveStep turn `beat` into an actual Pose via
 * sequencePoseAtBeat (see fold.mts).
 */
export function usePlayback(totalBeats: number): UsePlaybackResult {
  const [beat, setBeat] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  const clamp = useCallback(
    (value: number) => Math.min(Math.max(value, 0), Math.max(totalBeats, 0)),
    [totalBeats],
  );

  // Keep the scrub position valid if the sequence's length changes
  // (e.g. it's shorter than where we currently are, which can't happen
  // today since sequence-building only appends, but costs nothing to
  // guard against).
  useEffect(() => {
    setBeat((current) => clamp(current));
  }, [clamp]);

  useEffect(() => {
    if (!playing) {
      lastTimeRef.current = null;
      return;
    }

    const tick = (time: number) => {
      if (lastTimeRef.current !== null) {
        const deltaSeconds = (time - lastTimeRef.current) / 1000;
        setBeat((current) => {
          const next = current + deltaSeconds * PLACEHOLDER_BEATS_PER_SECOND;
          if (next >= totalBeats) {
            setPlaying(false);
            return clamp(totalBeats);
          }
          return next;
        });
      }
      lastTimeRef.current = time;
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [playing, totalBeats, clamp]);

  const play = useCallback(() => {
    if (totalBeats <= 0) return;
    setPlaying(true);
  }, [totalBeats]);

  const pause = useCallback(() => setPlaying(false), []);

  const toggle = useCallback(() => {
    setPlaying((current) => (current ? false : totalBeats > 0));
  }, [totalBeats]);

  const seek = useCallback((value: number) => setBeat(clamp(value)), [clamp]);

  const stepBy = useCallback(
    (delta: number) => setBeat((current) => clamp(current + delta)),
    [clamp],
  );

  return { beat, playing, play, pause, toggle, seek, stepBy };
}
