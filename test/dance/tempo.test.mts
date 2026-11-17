import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FALLBACK_TEMPO,
  MAX_TEMPO,
  MIN_TEMPO,
  clampTempo,
  clicksBetween,
  metronomeClicks,
} from "../../src/libs/dance/tempo.mts";
import type { SequenceEntry } from "../../src/libs/dance/sequence.mts";

/**
 * A sequence entry with only what the timing functions read: a time
 * signature and one step whose end sets the figure's length in beats.
 */
function entry(beatsPerMeasure: number, lengthBeats: number): SequenceEntry {
  return {
    figure: {
      timeSignature: { beatsPerMeasure, beatUnit: 4 },
      steps: [{ beat: 1, duration: lengthBeats }],
    },
  } as unknown as SequenceEntry;
}

const beats = (clicks: { beat: number }[]) => clicks.map((c) => c.beat);
const accented = (clicks: { beat: number; accent: boolean }[]) =>
  clicks.filter((c) => c.accent).map((c) => c.beat);

test("metronomeClicks: two waltz figures click as each count lands, accenting count 1", () => {
  // Counts land at the end of their beat: 1, 2, 3, then 4, 5, 6. Nothing
  // at 0, and a click at the very end.
  const clicks = metronomeClicks([entry(3, 3), entry(3, 3)]);
  assert.deepEqual(beats(clicks), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(accented(clicks), [1, 4]);
});

test("metronomeClicks: bars run on through figures that end mid-bar (tango, 3 beats of 2/4)", () => {
  // Three 3-beat figures in 2/4: counts land at 1 to 9, count 1 of each
  // bar at 1, 3, 5, 7, 9. The second figure's first count (beat 4) is
  // the second count of a bar, so it isn't accented.
  const clicks = metronomeClicks([entry(2, 3), entry(2, 3), entry(2, 3)]);
  assert.deepEqual(beats(clicks), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(accented(clicks), [1, 3, 5, 7, 9]);
});

test("metronomeClicks: a figure ending on a half beat leaves the next click on the next whole beat", () => {
  // 1.5 + 1.5 beats of 2/4: clicks on 1, 2, 3; count 1 of the second bar
  // lands on 3.
  const clicks = metronomeClicks([entry(2, 1.5), entry(2, 1.5)]);
  assert.deepEqual(beats(clicks), [1, 2, 3]);
  assert.deepEqual(accented(clicks), [1, 3]);
});

test("metronomeClicks: a change of time signature starts a new bar", () => {
  // 3 beats of 2/4 (count 1 on 1 and 3), then 3/4 starting after beat
  // 3, its count 1 landing on 4.
  const clicks = metronomeClicks([entry(2, 3), entry(3, 3)]);
  assert.deepEqual(accented(clicks), [1, 3, 4]);
});

test("metronomeClicks: an empty sequence has no clicks", () => {
  assert.deepEqual(metronomeClicks([]), []);
});

test("clicksBetween: half-open, so back-to-back windows never repeat a click", () => {
  const clicks = metronomeClicks([entry(3, 3), entry(3, 3)]);
  assert.deepEqual(beats(clicksBetween(clicks, 0, 1)), []);
  assert.deepEqual(beats(clicksBetween(clicks, 1, 1.05)), [1]);
  assert.deepEqual(beats(clicksBetween(clicks, 1.05, 2)), []);
  assert.deepEqual(beats(clicksBetween(clicks, 2.5, 4.2)), [3, 4]);
  assert.deepEqual(beats(clicksBetween(clicks, 5.9, 6.1)), [6]);
});

test("clampTempo: keeps the tempo in range and whole", () => {
  assert.equal(clampTempo(87.4), 87);
  assert.equal(clampTempo(5), MIN_TEMPO);
  assert.equal(clampTempo(1000), MAX_TEMPO);
  assert.equal(clampTempo(Number.NaN), FALLBACK_TEMPO);
});
