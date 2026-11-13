import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHAIN_ORIGIN,
  placeEntry,
  removeEntry,
} from "../../src/libs/dance/chain.mts";
import { applyTransform } from "../../src/libs/dance/floor.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";
import type { SequenceEntry } from "../../src/libs/dance/sequence.mts";

// Small figures whose end pose is their start pose moved and/or turned,
// so where each one ends up after chaining can be worked out by hand.

const STANCE: Pose = {
  lead: {
    left: { position: { x: -0.1, y: 0 }, weight: 0 },
    right: { position: { x: 0.1, y: 0 }, weight: 1 },
    orientation: 0,
    rise: 0,
  },
  follow: {
    left: { position: { x: 0.1, y: 0.4 }, weight: 1 },
    right: { position: { x: -0.1, y: 0.4 }, weight: 0 },
    orientation: 180,
    rise: 0,
  },
};

function figure(
  id: string,
  move: { x: number; y: number; rotation: number },
): Figure {
  return {
    id,
    name: id,
    style: "tango",
    timeSignature: { beatsPerMeasure: 4, beatUnit: 4 },
    steps: [],
    startPose: STANCE,
    endPose: applyTransform(
      { position: { x: move.x, y: move.y }, rotation: move.rotation },
      STANCE,
    ),
  };
}

/** Travels 1 forward (north). */
const forward = figure("forward", { x: 0, y: 1, rotation: 0 });
/** Travels 1 east. */
const east = figure("east", { x: 1, y: 0, rotation: 0 });
/** Turns a quarter clockwise on the spot. */
const quarterTurn = figure("quarter-turn", { x: 0, y: 0, rotation: 90 });

function build(figures: Figure[]): SequenceEntry[] {
  const entries: SequenceEntry[] = [];
  for (const f of figures) entries.push(placeEntry(f, entries.at(-1)));
  return entries;
}

function assertTransformClose(
  actual: SequenceEntry["transform"],
  expected: SequenceEntry["transform"],
) {
  assert.ok(
    Math.hypot(
      actual.position.x - expected.position.x,
      actual.position.y - expected.position.y,
    ) < 1e-9 && Math.abs(actual.rotation - expected.rotation) < 1e-9,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

test("placeEntry: the first entry is anchored at the origin, facing line of dance", () => {
  const entry = placeEntry(forward, undefined);
  assert.deepEqual(entry.transform, CHAIN_ORIGIN);
  assert.deepEqual(
    entry.resolvedStartPose,
    applyTransform(CHAIN_ORIGIN, STANCE),
  );
});

test("placeEntry: a later entry continues from where the previous one ended", () => {
  const [first, second] = build([forward, east]);
  assertTransformClose(second.transform, {
    position: { x: 0, y: 1 },
    rotation: 0,
  });
  assert.deepEqual(second.resolvedStartPose, first.resolvedEndPose);
});

test("removeEntry: removing a middle figure re-places the rest as if it had never been there", () => {
  // forward, quarter turn, east: after the turn, "east" travels south.
  // Without the turn it should travel east from (0, 1) again.
  const entries = build([forward, quarterTurn, east]);
  const result = removeEntry(entries, 1);

  assert.deepEqual(
    result.map((entry) => entry.figure.id),
    ["forward", "east"],
  );
  assert.deepEqual(result, build([forward, east]));
  // The entry before the removal is kept as the very same object.
  assert.equal(result[0], entries[0]);
});

test("removeEntry: removing the first figure re-anchors the new first figure at the origin", () => {
  const entries = build([forward, east, forward]);
  const result = removeEntry(entries, 0);
  assert.deepEqual(result, build([east, forward]));
  assert.deepEqual(result[0].transform, CHAIN_ORIGIN);
});

test("removeEntry: removing the last figure leaves the others untouched", () => {
  const entries = build([forward, east, quarterTurn]);
  const result = removeEntry(entries, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0], entries[0]);
  assert.equal(result[1], entries[1]);
});

test("removeEntry: removing the only figure leaves an empty sequence", () => {
  assert.deepEqual(removeEntry(build([forward]), 0), []);
});

test("removeEntry: an index outside the sequence changes nothing", () => {
  const entries = build([forward, east]);
  for (const index of [-1, 2, 1.5, Number.NaN]) {
    assert.equal(removeEntry(entries, index), entries, `index ${index}`);
  }
});
