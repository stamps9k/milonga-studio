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

/** One metronome click: on a whole beat, accented on the first beat of
 *  a bar. */
export interface MetronomeClick {
  beat: number;
  accent: boolean;
}

/**
 * The metronome's clicks for a sequence: one on every whole beat from 0
 * up to (not including) the end, with the first beat of each bar
 * accented.
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
      // on this figure's first whole beat.
      barStart = Math.ceil(startBeat);
      beatsPerBar = perBar;
    }
    for (let beat = Math.ceil(startBeat); beat < endBeat; beat++) {
      if (clicks.length > 0 && clicks[clicks.length - 1].beat >= beat) {
        continue;
      }
      clicks.push({ beat, accent: (beat - barStart) % perBar === 0 });
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
