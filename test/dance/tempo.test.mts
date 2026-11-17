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

test("metronomeClicks: two waltz figures click every beat, accenting each bar of 3", () => {
  const clicks = metronomeClicks([entry(3, 3), entry(3, 3)]);
  assert.deepEqual(beats(clicks), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(accented(clicks), [0, 3]);
});

test("metronomeClicks: bars run on through figures that end mid-bar (tango, 3 beats of 2/4)", () => {
  // Three 3-beat figures in 2/4: 9 beats, bars starting on 0, 2, 4, 6, 8.
  // The second figure starts on beat 3, halfway through a bar, and isn't
  // accented.
  const clicks = metronomeClicks([entry(2, 3), entry(2, 3), entry(2, 3)]);
  assert.deepEqual(beats(clicks), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(accented(clicks), [0, 2, 4, 6, 8]);
});

test("metronomeClicks: a figure ending on a half beat leaves the next click on the next whole beat", () => {
  // 1.5 + 1.5 beats of 2/4: clicks on 0, 1, 2; the bar on 2 is accented.
  const clicks = metronomeClicks([entry(2, 1.5), entry(2, 1.5)]);
  assert.deepEqual(beats(clicks), [0, 1, 2]);
  assert.deepEqual(accented(clicks), [0, 2]);
});

test("metronomeClicks: a change of time signature starts a new bar", () => {
  // 3 beats of 2/4 (bars on 0 and 2), then 3/4 starting on beat 3.
  const clicks = metronomeClicks([entry(2, 3), entry(3, 3)]);
  assert.deepEqual(accented(clicks), [0, 2, 3]);
});

test("metronomeClicks: an empty sequence has no clicks", () => {
  assert.deepEqual(metronomeClicks([]), []);
});

test("clicksBetween: half-open, so back-to-back windows never repeat a click", () => {
  const clicks = metronomeClicks([entry(3, 3), entry(3, 3)]);
  assert.deepEqual(beats(clicksBetween(clicks, 0, 1)), [0]);
  assert.deepEqual(beats(clicksBetween(clicks, 1, 1.05)), [1]);
  assert.deepEqual(beats(clicksBetween(clicks, 1.05, 2)), []);
  assert.deepEqual(beats(clicksBetween(clicks, 2.5, 4.2)), [3, 4]);
});

test("clampTempo: keeps the tempo in range and whole", () => {
  assert.equal(clampTempo(87.4), 87);
  assert.equal(clampTempo(5), MIN_TEMPO);
  assert.equal(clampTempo(1000), MAX_TEMPO);
  assert.equal(clampTempo(Number.NaN), FALLBACK_TEMPO);
});
