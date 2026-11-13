import { test } from "node:test";
import assert from "node:assert/strict";

import {
  centerOfWeight,
  isStandingFoot,
} from "../../src/libs/dance/weight.mts";
import { poseAtBeat } from "../../src/libs/dance/fold.mts";
import type { PartnerPose } from "../../src/libs/dance/pose.mts";
import type { Figure } from "../../src/libs/dance/step.mts";

function partner(leftWeight: number, rightWeight: number): PartnerPose {
  return {
    left: { position: { x: -0.1, y: 0 }, weight: leftWeight },
    right: { position: { x: 0.1, y: 0.4 }, weight: rightWeight },
    orientation: 0,
    rise: 0,
  };
}

function assertPointClose(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) {
  assert.ok(
    Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-9,
    `expected (${expected.x}, ${expected.y}), got (${actual.x}, ${actual.y})`,
  );
}

test("centerOfWeight: all the weight on one foot puts it exactly on that foot", () => {
  assertPointClose(centerOfWeight(partner(1, 0)), { x: -0.1, y: 0 });
  assertPointClose(centerOfWeight(partner(0, 1)), { x: 0.1, y: 0.4 });
});

test("centerOfWeight: a split weight puts it proportionally between the feet", () => {
  assertPointClose(centerOfWeight(partner(0.5, 0.5)), { x: 0, y: 0.2 });
  // A quarter of the weight on the right foot: a quarter of the way
  // from the left foot towards the right.
  assertPointClose(centerOfWeight(partner(0.75, 0.25)), { x: -0.05, y: 0.1 });
});

test("centerOfWeight: weights that don't sum to 1 are normalised, and no weight at all falls back to the midpoint", () => {
  assertPointClose(centerOfWeight(partner(2, 2)), { x: 0, y: 0.2 });
  assertPointClose(centerOfWeight(partner(0, 0)), { x: 0, y: 0.2 });
});

test("centerOfWeight: slides steadily from the old standing foot to the new one during a step", () => {
  // Lead stands on his right foot at (0.1, 0) and steps his left foot
  // from (-0.1, 0) to (-0.1, 0.4), taking the weight onto it.
  const forward: Figure = {
    id: "forward",
    name: "Forward",
    style: "tango",
    timeSignature: { beatsPerMeasure: 4, beatUnit: 4 },
    steps: [
      {
        id: "1",
        partner: "lead",
        foot: "left",
        movement: { type: "straight", direction: 0, distance: 0.4 },
        contact: "floor",
        weight: 1,
        orientation: 0,
        rise: 0,
        beat: 1,
        duration: 1,
      },
    ],
    startPose: {
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
    },
    endPose: {} as Figure["endPose"],
  };

  assertPointClose(centerOfWeight(poseAtBeat(forward, 0).lead), {
    x: 0.1,
    y: 0,
  });
  // Halfway: the left foot is at (-0.1, 0.2) carrying half the weight,
  // so the body is halfway between it and the right foot.
  assertPointClose(centerOfWeight(poseAtBeat(forward, 0.5).lead), {
    x: 0,
    y: 0.1,
  });
  assertPointClose(centerOfWeight(poseAtBeat(forward, 1).lead), {
    x: -0.1,
    y: 0.4,
  });
});

test("isStandingFoot: the foot with at least half the weight is standing", () => {
  assert.equal(isStandingFoot(partner(1, 0), "left"), true);
  assert.equal(isStandingFoot(partner(1, 0), "right"), false);
  assert.equal(isStandingFoot(partner(0.4, 0.6), "left"), false);
  assert.equal(isStandingFoot(partner(0.4, 0.6), "right"), true);
  // An even split counts both feet as standing.
  assert.equal(isStandingFoot(partner(0.5, 0.5), "left"), true);
  assert.equal(isStandingFoot(partner(0.5, 0.5), "right"), true);
});
