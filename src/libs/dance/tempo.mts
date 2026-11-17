import type { SequenceEntry } from "./sequence.mts";
import { sequenceEntrySpans } from "./fold.mts";

/**
 * Tempo and metronome timing for playback: the tempo range and where the
 * bars fall in a sequence. Plain functions over the sequence, so the
 * playback hooks and any future renderer share one answer. Nothing here
 * is style-specific; the per-dance starting tempos live with the UI
 * state in src/hooks/useTempo.mts.
 *
 * Units: tempo in beats per minute (BPM), positions in beats from the
 * start of the sequence, the same beats the figures are written in (a
 * waltz figure's three counts are three beats; a tango slow is one beat
 * in 2/4, see db/FIGURES.md).
 */

/** Tempo used when nothing better is known: one beat a second, which is
 *  what playback ran at before tempo was adjustable. */
export const FALLBACK_TEMPO = 60;

/** Lowest and highest tempo the controls allow, in BPM. Wide enough for
 *  slow practice at half speed and for fast dances such as jive. */
export const MIN_TEMPO = 30;
export const MAX_TEMPO = 240;

/** Keeps a tempo inside MIN_TEMPO..MAX_TEMPO, rounded to a whole BPM. */
export function clampTempo(bpm: number): number {
  if (!Number.isFinite(bpm)) return FALLBACK_TEMPO;
  return Math.min(Math.max(Math.round(bpm), MIN_TEMPO), MAX_TEMPO);
}

/** One metronome click: on a whole beat, where a count lands, accented
 *  on count 1 of a bar. */
export interface MetronomeClick {
  beat: number;
  accent: boolean;
}

/**
 * The metronome's clicks for a sequence: one on each count, at the
 * moment the count's step lands, with count 1 of each bar accented.
 *
 * A step on count n occupies beats [n - 1, n) (see Timing in AGENTS.md)
 * and its foot arrives at beat n, so that is where the count is heard
 * and seen. The clicks are therefore on the whole beats after the start
 * up to and including the end: none at beat 0, where nothing has
 * landed yet, and one at the end, where the last step lands. A waltz
 * figure clicks at 1, 2 and 3; three of them at 1 to 9, accented on 1,
 * 4 and 7. (The owner, 2026-11-17: clicking at 0 and not at the end
 * sounded a beat early.)
 *
 * Bars run continuously through the sequence rather than restarting at
 * each figure, because figures don't have to fill whole bars: a tango
 * Closed Promenade (S Q Q S) is three beats, a bar and a half of 2/4,
 * so the next figure starts halfway through a bar, as it does on the
 * dance floor. The bar length is the time signature of the figure the
 * beat falls in. If the time signature changes between figures (a
 * sequence mixing dances), the count starts a new bar at that figure,
 * since there is no shared bar line to continue.
 */
export function metronomeClicks(
  entries: readonly SequenceEntry[],
): MetronomeClick[] {
  const spans = sequenceEntrySpans([...entries]);
  const clicks: MetronomeClick[] = [];
  let barStart = 0;
  let beatsPerBar: number | null = null;
  for (const [index, entry] of entries.entries()) {
    const { startBeat, endBeat } = spans[index];
    const perBar = entry.figure.timeSignature.beatsPerMeasure;
    if (beatsPerBar !== perBar) {
      // First figure, or a change of time signature: a new bar starts
      // with this figure, its count 1 landing a beat later.
      barStart = startBeat;
      beatsPerBar = perBar;
    }
    // Whole beats in (startBeat, endBeat]: each count lands at the end
    // of its beat.
    for (let beat = Math.floor(startBeat) + 1; beat <= endBeat; beat++) {
      if (clicks.length > 0 && clicks[clicks.length - 1].beat >= beat) {
        continue;
      }
      const countInBar = (beat - barStart - 1) % perBar;
      clicks.push({ beat, accent: Math.abs(countInBar) < 1e-9 });
    }
  }
  return clicks;
}

/**
 * The clicks whose beat falls in [fromBeat, toBeat), in order. The
 * metronome uses it to find the clicks coming up in the next fraction of
 * a second so it can schedule them ahead of time; the window is
 * half-open so consecutive windows never schedule a click twice.
 */
export function clicksBetween(
  clicks: readonly MetronomeClick[],
  fromBeat: number,
  toBeat: number,
): MetronomeClick[] {
  return clicks.filter(
    (click) => click.beat >= fromBeat && click.beat < toBeat,
  );
}
