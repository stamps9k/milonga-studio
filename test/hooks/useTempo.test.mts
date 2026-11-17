import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TEMPO_BY_STYLE,
  TAP_RESET_MS,
  defaultTempo,
  tapTempo,
} from "../../src/hooks/useTempo.mts";
import { FALLBACK_TEMPO } from "../../src/libs/dance/tempo.mts";
import type { SequenceEntry } from "../../src/libs/dance/sequence.mts";

const ofStyle = (style: string) =>
  ({ figure: { style } }) as unknown as SequenceEntry;

test("defaultTempo: the first figure's dance decides", () => {
  assert.equal(defaultTempo([ofStyle("waltz")]), 87);
  assert.equal(defaultTempo([ofStyle("tango"), ofStyle("waltz")]), 64);
  assert.equal(DEFAULT_TEMPO_BY_STYLE["cha-cha"], 124);
});

test("defaultTempo: an empty sequence or an unlisted dance uses the fallback", () => {
  assert.equal(defaultTempo([]), FALLBACK_TEMPO);
  assert.equal(defaultTempo([ofStyle("argentine tango")]), FALLBACK_TEMPO);
});

test("tapTempo: needs two taps", () => {
  assert.equal(tapTempo([]), null);
  assert.equal(tapTempo([1000]), null);
});

test("tapTempo: evenly spaced taps give their tempo", () => {
  // 690 ms apart: 60000 / 690 = 86.96, rounded to 87.
  assert.equal(tapTempo([0, 690, 1380, 2070]), 87);
  // 500 ms apart: 120.
  assert.equal(tapTempo([0, 500]), 120);
});

test("tapTempo: one mistimed tap doesn't pull the tempo off (median)", () => {
  // Intervals 500, 500, 800, 500: the median is 500, so 120.
  assert.equal(tapTempo([0, 500, 1000, 1800, 2300]), 120);
});

test("tapTempo: a long pause starts a new run", () => {
  // An old run at 120, then a pause, then two taps 1000 ms apart: 60.
  const old = [0, 500, 1000];
  const later = 1000 + TAP_RESET_MS + 1;
  assert.equal(tapTempo([...old, later]), null);
  assert.equal(tapTempo([...old, later, later + 1000]), 60);
});
