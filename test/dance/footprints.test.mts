import { test } from "node:test";
import assert from "node:assert/strict";

import { defineFigure } from "../../src/libs/dance/authoring.mts";
import type { StepRow } from "../../src/libs/dance/authoring.mts";
import {
  countLabel,
  footprintsAtBeat,
  sequenceFootprints,
} from "../../src/libs/dance/footprints.mts";
import type { Footprint } from "../../src/libs/dance/footprints.mts";
import type { FloorTransform } from "../../src/libs/dance/sequence.mts";
import type { Figure } from "../../src/libs/dance/step.mts";

const IDENTITY: FloorTransform = { position: { x: 0, y: 0 }, rotation: 0 };

function figure(steps: StepRow[]): Figure {
  const authored = defineFigure({
    name: "Test",
    style: "test",
    time: "4/4",
    steps,
  });
  return {
    ...authored,
    id: "test",
    steps: authored.steps.map((step, index) => ({
      ...step,
      id: String(index),
    })),
  };
}

function pointClose(
  actual: { x: number; y: number },
  expected: [number, number],
) {
  assert.ok(
    Math.hypot(actual.x - expected[0], actual.y - expected[1]) < 1e-9,
    `expected (${expected[0]}, ${expected[1]}), got (${actual.x}, ${actual.y})`,
  );
}

// Forward 0.4 then close, both partners, one beat each. From the closed
// stance (lead's feet at (-0.1, 0) and (0.1, 0) facing north, follow's
// at (0.1, 0.4) [left] and (-0.1, 0.4) [right] facing south):
// - lead: left forward to (-0.1, 0.4), then right closes to (0.1, 0.4);
// - follow: right back to (-0.1, 0.8), then left closes to (0.1, 0.8).
const FORWARD_AND_CLOSE = figure([
  { both: "forward", by: 0.4, length: "Q" },
  { both: "close", length: "Q" },
]);

const leadPrints = <T extends { partner: Footprint["partner"] }>(
  footprints: T[],
) => footprints.filter((footprint) => footprint.partner === "lead");

test("sequenceFootprints: the starting stance, then one print per step where the foot lands, with its count", () => {
  const footprints = sequenceFootprints([
    { figure: FORWARD_AND_CLOSE, transform: IDENTITY },
  ]);
  assert.equal(footprints.length, 8);

  const [startLeft, startRight, first, second] = leadPrints(footprints);
  assert.equal(startLeft.count, "");
  pointClose(startLeft.position, [-0.1, 0]);
  pointClose(startRight.position, [0.1, 0]);
  assert.equal(startLeft.endBeat, 0);

  assert.equal(first.foot, "left");
  pointClose(first.position, [-0.1, 0.4]);
  assert.equal(first.orientation, 0);
  assert.deepEqual([first.startBeat, first.endBeat, first.count], [0, 1, "1"]);

  assert.equal(second.foot, "right");
  pointClose(second.position, [0.1, 0.4]);
  assert.deepEqual([second.startBeat, second.endBeat], [1, 2]);
  assert.equal(second.count, "2");

  const follow = footprints.filter((print) => print.partner === "follow");
  pointClose(follow[2].position, [0, 0.8]);
  pointClose(follow[3].position, [0.2, 0.8]);
  assert.equal(follow[3].orientation, 180);
});

test("sequenceFootprints: later entries are placed by their transform and timed after the earlier ones, with no second starting stance", () => {
  // Second occurrence turned a quarter right and moved 1 east: the
  // lead's left print (-0.1, 0.4) rotates to (0.4, 0.1), then moves to
  // (1.4, 0.1), pointing east.
  const turned: FloorTransform = { position: { x: 1, y: 0 }, rotation: 90 };
  const footprints = sequenceFootprints([
    { figure: FORWARD_AND_CLOSE, transform: IDENTITY },
    { figure: FORWARD_AND_CLOSE, transform: turned },
  ]);
  assert.equal(footprints.length, 12);
  const secondEntry = leadPrints(footprints).filter(
    (print) => print.entryIndex === 1,
  );
  assert.equal(secondEntry.length, 2);
  pointClose(secondEntry[0].position, [1.4, 0.1]);
  assert.equal(secondEntry[0].orientation, 90);
  assert.deepEqual(
    [secondEntry[0].startBeat, secondEntry[0].endBeat, secondEntry[0].count],
    [2, 3, "1"],
  );
});

test("sequenceFootprints: airborne steps leave no print, since the foot doesn't land", () => {
  const withKick = figure([
    { both: "forward", by: 0.3, air: true, length: "Q" },
    { both: "forward", by: 0.4, length: "Q" },
  ]);
  const prints = leadPrints(
    sequenceFootprints([{ figure: withKick, transform: IDENTITY }]),
  );
  assert.equal(prints.length, 3);
  assert.equal(prints[2].count, "2");
});

test("countLabel: whole beats as numbers, half beats with &", () => {
  assert.equal(countLabel(3), "3");
  assert.equal(countLabel(3.5), "3&");
  assert.equal(countLabel(1.25), "1.25");
});

test("footprintsAtBeat: taken, landing and next, per partner", () => {
  const footprints = sequenceFootprints([
    { figure: FORWARD_AND_CLOSE, transform: IDENTITY },
  ]);
  const phases = (beat: number, upcoming?: number) =>
    leadPrints(
      footprintsAtBeat(footprints, beat, upcoming).map((state) => ({
        ...state.footprint,
        phase: state.phase,
        age: state.age,
      })),
    ).map((print) => `${print.count || "start"}:${print.phase}:${print.age}`);

  // Halfway through count 1: the left foot is on its way, the close is
  // next, and the starting stance is behind.
  assert.deepEqual(phases(0.5), [
    "start:taken:0",
    "start:taken:1",
    "1:landing:0",
    "2:next:0",
  ]);
  // Exactly on count 2: step 1 has landed, the close has started.
  assert.deepEqual(phases(1), [
    "start:taken:1",
    "start:taken:2",
    "1:taken:0",
    "2:landing:0",
  ]);
  // At the end everything is taken, newest first by age.
  assert.deepEqual(phases(2), [
    "start:taken:2",
    "start:taken:3",
    "1:taken:1",
    "2:taken:0",
  ]);
  // Before anything starts, with no upcoming steps asked for, the first
  // step is still landing (it starts at 0) and the rest are later.
  assert.deepEqual(phases(0, 0), [
    "start:taken:0",
    "start:taken:1",
    "1:landing:0",
    "2:later:0",
  ]);
});
