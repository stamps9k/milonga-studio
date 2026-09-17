import { test } from "node:test";
import assert from "node:assert/strict";

import { applyTransform, fitTransform } from "../../src/libs/dance/floor.mts";
import type { Pose } from "../../src/libs/dance/pose.mts";
import type { FloorTransform } from "../../src/libs/dance/sequence.mts";

interface PoseOverrides {
  leadLeft?: [number, number];
  leadRight?: [number, number];
  followLeft?: [number, number];
  followRight?: [number, number];
  leadOrientation?: number;
  followOrientation?: number;
}

function makePose(overrides: PoseOverrides = {}): Pose {
  const {
    leadLeft = [-0.1, 0],
    leadRight = [0.1, 0],
    followLeft = [-0.1, 0.3],
    followRight = [0.1, 0.3],
    leadOrientation = 0,
    followOrientation = 180,
  } = overrides;

  return {
    lead: {
      left: { position: { x: leadLeft[0], y: leadLeft[1] }, weight: 0.5 },
      right: { position: { x: leadRight[0], y: leadRight[1] }, weight: 0.5 },
      orientation: leadOrientation,
      rise: 0,
    },
    follow: {
      left: {
        position: { x: followLeft[0], y: followLeft[1] },
        weight: 0.5,
      },
      right: {
        position: { x: followRight[0], y: followRight[1] },
        weight: 0.5,
      },
      orientation: followOrientation,
      rise: 0,
    },
  };
}

function assertPoseClose(actual: Pose, expected: Pose, epsilon = 1e-6) {
  for (const partner of ["lead", "follow"] as const) {
    for (const foot of ["left", "right"] as const) {
      const a = actual[partner][foot].position;
      const e = expected[partner][foot].position;
      assert.ok(
        Math.abs(a.x - e.x) < epsilon && Math.abs(a.y - e.y) < epsilon,
        `${partner}.${foot} position mismatch: got (${a.x}, ${a.y}), expected (${e.x}, ${e.y})`,
      );
    }
    const a = actual[partner].orientation;
    const e = expected[partner].orientation;
    assert.ok(
      Math.abs(a - e) < epsilon,
      `${partner} orientation mismatch: got ${a}, expected ${e}`,
    );
  }
}

test("applyTransform: identity transform leaves a pose unchanged", () => {
  const pose = makePose();
  const identity: FloorTransform = { position: { x: 0, y: 0 }, rotation: 0 };
  assertPoseClose(applyTransform(identity, pose), pose, 1e-9);
});

test("applyTransform: rotates positions and orientations, translates positions, leaves rise alone", () => {
  const pose = makePose();
  const transform: FloorTransform = {
    position: { x: 5, y: -3 },
    rotation: 90,
  };
  const result = applyTransform(transform, pose);

  // Compass-bearing rotation (0 = +Y/north, clockwise as degrees
  // increase): a 90-degree rotation sends (x, y) -> (y, -x), then
  // translate. See rotatePoint's doc comment in floor.mts.
  assert.ok(Math.abs(result.lead.left.position.x - (0 + 5)) < 1e-9);
  assert.ok(Math.abs(result.lead.left.position.y - (0.1 - 3)) < 1e-9);
  assert.ok(Math.abs(result.lead.orientation - 90) < 1e-9);
  assert.ok(Math.abs(result.follow.orientation - 270) < 1e-9);
  assert.equal(result.lead.rise, pose.lead.rise);
});

test("applyTransform: rotation convention matches Movement.direction (0 = +Y/north, 90 = +X/east, clockwise) -- pinned against the seeded Side Step figure's real values", () => {
  // Side Step: direction=90, distance=0.35 moves a foot from
  // (-0.1, 0) to (0.25, 0) -- i.e. purely +X, matching how the seeded
  // data actually behaves (see api/dances.mts figure 2 / db/seed.mts).
  const pose = makePose({ leadLeft: [0, 1] }); // (0, 1) = "north"
  const transform: FloorTransform = { position: { x: 0, y: 0 }, rotation: 90 };
  const result = applyTransform(transform, pose);

  assert.ok(Math.abs(result.lead.left.position.x - 1) < 1e-9); // -> "east"
  assert.ok(Math.abs(result.lead.left.position.y - 0) < 1e-9);
});

test("fitTransform: recovers a known transform exactly when poses are congruent", () => {
  const source = makePose();
  const knownTransform: FloorTransform = {
    position: { x: 12, y: -4 },
    rotation: 37,
  };
  const target = applyTransform(knownTransform, source);

  const fitted = fitTransform(source, target);

  assert.ok(Math.abs(fitted.rotation - knownTransform.rotation) < 1e-6);
  assert.ok(Math.abs(fitted.position.x - knownTransform.position.x) < 1e-6);
  assert.ok(Math.abs(fitted.position.y - knownTransform.position.y) < 1e-6);
  assertPoseClose(applyTransform(fitted, source), target);
});

test("fitTransform: identical source and target yield the identity transform", () => {
  const pose = makePose();
  const fitted = fitTransform(pose, pose);
  assert.ok(Math.abs(fitted.rotation) < 1e-9);
  assert.ok(Math.abs(fitted.position.x) < 1e-9);
  assert.ok(Math.abs(fitted.position.y) < 1e-9);
});

test("chaining: fitting a figure's startPose onto the previous entry's resolvedEndPose keeps the couple's position continuous", () => {
  const firstEnd = makePose({
    leadLeft: [0.4, 0.2],
    leadRight: [0.6, 0.2],
    followLeft: [0.4, 0.5],
    followRight: [0.6, 0.5],
    leadOrientation: 25,
    followOrientation: 205,
  });
  const firstResolvedEnd = applyTransform(
    { position: { x: 0, y: 0 }, rotation: 0 },
    firstEnd,
  );

  // The second figure's own local startPose happens to be firstEnd
  // shifted/rotated by some arbitrary local transform -- i.e. it's
  // authored to connect to the first figure, just not already sitting
  // at the same floor position.
  const localShift: FloorTransform = { position: { x: 3, y: 1 }, rotation: 60 };
  const secondStart = applyTransform(localShift, firstEnd);
  const secondEnd = applyTransform(
    localShift,
    makePose({
      leadLeft: [1, 1],
      leadRight: [1.2, 1],
      followLeft: [1, 1.3],
      followRight: [1.2, 1.3],
    }),
  );

  const secondTransform = fitTransform(secondStart, firstResolvedEnd);
  const secondResolvedStart = applyTransform(secondTransform, secondStart);
  const secondResolvedEnd = applyTransform(secondTransform, secondEnd);

  assertPoseClose(secondResolvedStart, firstResolvedEnd);
  // Sanity check it's a real, non-trivial transform and not a no-op.
  assert.ok(
    Math.abs(secondResolvedEnd.lead.left.position.x) > 1e-6 ||
      Math.abs(secondResolvedEnd.lead.left.position.y) > 1e-6,
  );
});
