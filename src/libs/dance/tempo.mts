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

/** How a click sounds: "accent" on count 1 of a bar, "beat" on the other
 *  counts, "half" on the optional half-beat clicks between counts. */
export type ClickKind = "accent" | "beat" | "half";

/** One metronome click, at a position in beats. */
export interface MetronomeClick {
  beat: number;
  kind: ClickKind;
}

/** How often the metronome clicks: on every beat the figures are
 *  written in, or on every half beat too. Half beats let a beginner hear
 *  ballroom tango, which the book writes in 2/4 (a slow is one beat), in
 *  the four-to-a-bar pulse of the music, without changing the figures
 *  (owner, 2026-11-17). */
export type ClickDivision = "beat" | "half beat";

const CLICKS_PER_BEAT: Record<ClickDivision, number> = {
  beat: 1,
  "half beat": 2,
};

/** Clicks a beat for a division: 1 or 2. */
export function clicksPerBeat(division: ClickDivision): number {
  return CLICKS_PER_BEAT[division];
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
 * With `division` "half beat", a quieter "half" click is added halfway
 * through each beat, at the same end-of-interval convention: a 2/4 tango
 * bar clicks at 0.5 (half), 1 (accent), 1.5 (half), 2 (beat). The
 * accents and beat clicks stay exactly where they are without the
 * half beats, so switching only adds clicks in between.
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
  division: ClickDivision = "beat",
): MetronomeClick[] {
  const perBeat = clicksPerBeat(division);
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
    // Click positions in (startBeat, endBeat], every 1 / perBeat of a
    // beat: each count lands at the end of its beat (half beats at the
    // end of their half). Counted in whole clicks to avoid drifting
    // through repeated fractional additions.
    const first = Math.floor(startBeat * perBeat + 1e-9) + 1;
    const last = Math.floor(endBeat * perBeat + 1e-9);
    for (let index = first; index <= last; index++) {
      const beat = index / perBeat;
      if (clicks.length > 0 && clicks[clicks.length - 1].beat >= beat) {
        continue;
      }
      const onBeat = Math.abs(beat - Math.round(beat)) < 1e-9;
      const countInBar = (beat - barStart - 1) % perBar;
      clicks.push({
        beat,
        kind: !onBeat
          ? "half"
          : Math.abs(countInBar) < 1e-9
            ? "accent"
            : "beat",
      });
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
